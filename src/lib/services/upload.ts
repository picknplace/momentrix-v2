/**
 * Upload service — orchestrates file parsing, duplicate check, DB insert
 * Replaces GAS uploadAndImport()
 */
import { queryAll, queryOne, execute, executeBatch } from '../db';
import {
  parseDailyshot,
  parseKihya,
  parseDmonkey,
  parseDateFromFileName,
  generateImportId,
  nowKST,
} from '../parsers';
import type { ParsedOrderItem } from '../parsers';

// ── Config ──

async function getMarketFeeRate(marketId: string): Promise<number> {
  const row = await queryOne<{ fee_rate: number }>(
    'SELECT fee_rate FROM config WHERE market_id = ?',
    marketId,
  );
  return row?.fee_rate ?? 0;
}

// ── SKU Resolution ──

async function resolveSkus(items: ParsedOrderItem[], marketId: string): Promise<void> {
  if (marketId === 'kihya') return; // kihya uses productKey directly

  // Load sku_map
  const skuMapRows = await queryAll<{ dailyshot_product_key: string; master_sku: string }>(
    'SELECT dailyshot_product_key, master_sku FROM sku_map',
  );
  const skuMap: Record<string, string> = {};
  for (const r of skuMapRows) {
    skuMap[r.dailyshot_product_key] = r.master_sku;
  }

  // For dmonkey: load product map
  let dmonkeyMap: Record<string, string> = {};
  if (marketId === 'dmonkey') {
    const dmRows = await queryAll<{ order_product_name: string; goods_id: string }>(
      'SELECT order_product_name, goods_id FROM dmonkey_product_map WHERE goods_id IS NOT NULL AND goods_id != ""',
    );
    for (const r of dmRows) {
      dmonkeyMap[r.order_product_name] = r.goods_id;
    }
  }

  for (const item of items) {
    if (item.master_sku) continue;

    if (marketId === 'dmonkey' && dmonkeyMap[item.product_name_raw]) {
      item.master_sku = dmonkeyMap[item.product_name_raw];
    } else if (item.market_product_key && skuMap[item.market_product_key]) {
      item.master_sku = skuMap[item.market_product_key];
    } else {
      // Auto-issue internal SKU
      item.master_sku = await issueInternalSku(
        item.market_product_key,
        item.product_name_raw,
        marketId,
      );
    }
  }
}

async function issueInternalSku(
  productKey: string,
  productName: string,
  marketId: string,
): Promise<string> {
  // Check existing by product_name + market_id
  const existing = await queryOne<{ master_sku: string }>(
    'SELECT master_sku FROM sku_master WHERE product_name = ? AND market_id = ?',
    productName,
    marketId,
  );
  if (existing) return existing.master_sku;

  // Generate new
  const count = await queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM sku_master');
  const seq = (count?.cnt ?? 0) + 1;
  const internalSku = 'I' + String(seq).padStart(6, '0');
  const now = nowKST();

  await execute(
    'INSERT INTO sku_master (master_sku, internal_sku, product_name, market_id, created_at) VALUES (?, ?, ?, ?, ?)',
    internalSku, internalSku, productName, marketId, now,
  );

  if (productKey) {
    await execute(
      'INSERT OR IGNORE INTO sku_map (dailyshot_product_key, product_name_raw, master_sku) VALUES (?, ?, ?)',
      productKey, productName, internalSku,
    );
  }

  return internalSku;
}

// ── Duplicate Check ──

async function checkDuplicateImport(marketId: string, salesDate: string): Promise<boolean> {
  const row = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM import_log WHERE market_id = ? AND sales_date = ? AND upload_status = ?',
    marketId, salesDate, 'success',
  );
  return (row?.cnt ?? 0) > 0;
}

async function findDuplicateOrders(
  marketId: string,
  items: ParsedOrderItem[],
): Promise<string[]> {
  const idField = marketId === 'kihya' ? 'sub_order_id' : 'order_id';
  const ids = items.map(it => it[idField as keyof ParsedOrderItem] as string).filter(Boolean);
  if (ids.length === 0) return [];

  // Batch check in groups of 100
  const duplicates: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await queryAll<{ id_val: string }>(
      `SELECT DISTINCT ${idField} as id_val FROM order_items WHERE market_id = ? AND ${idField} IN (${placeholders})`,
      marketId, ...batch,
    );
    for (const r of rows) duplicates.push(r.id_val);

    // Also check archive
    const archiveRows = await queryAll<{ id_val: string }>(
      `SELECT DISTINCT ${idField} as id_val FROM order_items_archive WHERE market_id = ? AND ${idField} IN (${placeholders})`,
      marketId, ...batch,
    );
    for (const r of archiveRows) {
      if (!duplicates.includes(r.id_val)) duplicates.push(r.id_val);
    }
  }
  return duplicates;
}

// ── Write to DB ──

async function writeImportLog(
  importId: string,
  marketId: string,
  fileName: string,
  salesDate: string,
  status: string,
): Promise<void> {
  await execute(
    'INSERT INTO import_log (import_id, market_id, file_name, sales_date, upload_status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    importId, marketId, fileName, salesDate, status, nowKST(),
  );
}

async function writeOrderItems(items: ParsedOrderItem[]): Promise<void> {
  if (items.length === 0) return;
  const now = nowKST();

  const stmts = items.map(it => ({
    sql: `INSERT INTO order_items (
      import_id, market_id, sales_date, order_id, sub_order_id,
      market_product_key, product_name_raw, option_name_raw,
      qty, sales_amount, settlement_amount,
      master_sku, internal_sku, order_status, refund_amount,
      tracking_no, recipient_name,
      customs_id, phone, mobile, postal_code, address, order_note, remark, supplier_name,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      it.import_id, it.market_id, it.sales_date, it.order_id, it.sub_order_id,
      it.market_product_key, it.product_name_raw, it.option_name_raw,
      it.qty, it.sales_amount, it.settlement_amount,
      it.master_sku, it.internal_sku, it.order_status, it.refund_amount,
      it.tracking_no, it.recipient_name,
      it.customs_id, it.phone, it.mobile, it.postal_code, it.address,
      it.order_note, it.remark, it.supplier_name,
      now, now,
    ] as unknown[],
  }));

  // D1 batch limit: ~100 statements per batch
  for (let i = 0; i < stmts.length; i += 80) {
    await executeBatch(stmts.slice(i, i + 80));
  }
}

// ── Main Upload Pipeline ──

export interface UploadResult {
  ok: boolean;
  message: string;
  importId?: string;
  count?: number;
  duplicate?: boolean;
  duplicateOrders?: string[];
}

export async function uploadAndImport(
  marketId: string,
  fileName: string,
  sheetData: unknown[][],
): Promise<UploadResult> {
  // 1. Parse date from filename
  const salesDate = parseDateFromFileName(fileName);
  if (!salesDate) {
    return { ok: false, message: '파일명에서 날짜를 찾을 수 없습니다. 예: dailyshot_2026-02-26.xlsx' };
  }

  // 2. Duplicate import check
  if (await checkDuplicateImport(marketId, salesDate)) {
    return {
      ok: false,
      message: '이미 처리된 파일입니다. 롤백 후 재업로드하거나 담당자에게 문의하세요.',
      duplicate: true,
    };
  }

  const importId = generateImportId();

  // 3. Write import log (uploaded status)
  await writeImportLog(importId, marketId, fileName, salesDate, 'uploaded');

  // 4. Parse
  let items: ParsedOrderItem[];
  if (marketId === 'dailyshot') {
    const feeRate = await getMarketFeeRate('dailyshot');
    items = parseDailyshot(sheetData, salesDate, importId, feeRate);
  } else if (marketId === 'kihya') {
    items = parseKihya(sheetData, salesDate, importId);
  } else if (marketId === 'dmonkey') {
    items = parseDmonkey(sheetData, salesDate, importId);
  } else {
    return { ok: false, message: '지원하지 않는 마켓입니다: ' + marketId };
  }

  if (items.length === 0) {
    await execute('UPDATE import_log SET upload_status = ? WHERE import_id = ?', 'error', importId);
    return { ok: false, message: '파싱된 주문이 없습니다. 파일 형식을 확인하세요.' };
  }

  // 5. Order-level duplicate check
  const dupOrders = await findDuplicateOrders(marketId, items);
  if (dupOrders.length > 0) {
    await execute('DELETE FROM import_log WHERE import_id = ?', importId);
    const preview = dupOrders.slice(0, 20).join(', ');
    const extra = dupOrders.length > 20 ? ` 외 ${dupOrders.length - 20}건` : '';
    return {
      ok: false,
      duplicate: true,
      message: `이미 등록된 주문번호가 ${dupOrders.length}건 있습니다.\n중복: ${preview}${extra}`,
      duplicateOrders: dupOrders,
    };
  }

  // 6. Resolve SKUs
  await resolveSkus(items, marketId);

  // 7. Write order items
  await writeOrderItems(items);

  // 8. Update import log status
  await execute('UPDATE import_log SET upload_status = ? WHERE import_id = ?', 'success', importId);

  return {
    ok: true,
    message: `${importId} | ${items.length}건 처리 완료 (${salesDate})`,
    importId,
    count: items.length,
  };
}
