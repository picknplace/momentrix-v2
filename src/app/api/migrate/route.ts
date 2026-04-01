/**
 * POST /api/migrate — Bulk data import from GAS
 * Protected by CRON_SECRET header
 * Accepts { table, rows } and inserts into D1
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

// Column mappings for each table
const TABLE_COLUMNS: Record<string, string[]> = {
  order_items: [
    'import_id', 'market_id', 'sales_date', 'order_id', 'market_product_key',
    'product_name_raw', 'option_name_raw', 'qty', 'sales_amount', 'settlement_amount',
    'master_sku', 'internal_sku', 'order_status', 'refund_amount', 'cancelled_at',
    'cancel_reason', 'refund_reason', 'sub_order_id', 'tracking_no', 'recipient_name',
    'ship_date', 'created_at', 'updated_at', 'customs_id', 'phone', 'mobile',
    'postal_code', 'address', 'order_note', 'remark', 'supplier_name', 'ec_status',
  ],
  import_log: [
    'import_id', 'market_id', 'file_name', 'sales_date', 'upload_status',
    'created_at', 'cancelled_at', 'cancel_reason',
  ],
  order_events: [
    'event_id', 'occurred_at', 'event_type', 'market_id', 'order_id',
    'market_product_key', 'amount', 'reason', 'ref_import_id', 'operator',
  ],
  sku_map: ['dailyshot_product_key', 'product_name_raw', 'master_sku'],
  sku_master: ['master_sku', 'internal_sku', 'product_name', 'market_id', 'created_at', 'search_keyword_ja'],
  cost_master: [
    'master_sku', 'product_name', 'purchase_cost', 'shipping_cost',
    'packaging_cost', 'tariff_cost', 'other_cost', 'total_cost', 'updated_at',
  ],
  users: ['user_id', 'password_hash', 'email', 'name', 'role', 'status', 'created_at', 'last_login'],
  audit_log: [
    'log_id', 'timestamp', 'user_id', 'action_type', 'target_sheet',
    'target_id', 'before_data', 'after_data', 'session_id', 'result', 'detail',
  ],
  daily_summary: [
    'sales_date', 'order_count', 'qty_total', 'sales_amount_total',
    'settlement_amount_total', 'generated_at',
  ],
  market_summary: [
    'market_id', 'order_count', 'qty_total', 'sales_amount_total',
    'settlement_amount_total', 'generated_at',
  ],
  sku_summary: [
    'master_sku', 'product_name_raw', 'order_count', 'qty_total',
    'sales_amount_total', 'settlement_amount_total', 'generated_at',
  ],
  inventory: [
    'master_sku', 'product_name', 'stock', 'allocated', 'available',
    'safety_stock', 'search_keyword', 'last_sync', 'updated_at',
  ],
  suppliers: [
    'supplier_id', 'name', 'type', 'url', 'category', 'contact',
    'shipping_threshold', 'shipping_cost', 'notes', 'created_at',
  ],
  supplier_products: [
    'supplier_id', 'master_sku', 'product_name', 'product_name_kr',
    'category', 'category_kr', 'purchase_price', 'currency',
    'min_order_qty', 'max_order_qty', 'unit', 'price_date', 'product_url', 'notes',
  ],
  purchase_orders: [
    'po_id', 'status', 'supplier_id', 'supplier_name', 'requested_by',
    'requested_at', 'ordered_at', 'order_memo', 'expected_arrival',
    'received_at', 'received_by', 'receive_memo', 'total_amount',
  ],
  po_items: ['po_id', 'master_sku', 'product_name', 'qty', 'unit_price', 'subtotal'],
  price_history: [
    'supplier_id', 'master_sku', 'product_name', 'original_name', 'qty',
    'unit_price', 'total_price', 'currency', 'purchase_date', 'source', 'source_ref', 'notes', 'created_at',
  ],
};

export async function POST(req: NextRequest) {
  const { env } = getRequestContext();
  const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '');

  if (secret !== (env as Record<string, string>).CRON_SECRET) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as { table: string; rows: Record<string, unknown>[]; clear?: boolean };
  const { table, rows, clear } = body;

  if (!table || !rows?.length) {
    return NextResponse.json({ ok: false, message: 'table and rows required' }, { status: 400 });
  }

  const columns = TABLE_COLUMNS[table];
  if (!columns) {
    return NextResponse.json({ ok: false, message: `Unknown table: ${table}` }, { status: 400 });
  }

  const db = (env as Record<string, unknown>).DB as D1Database;

  try {
    // Optionally clear existing data
    if (clear) {
      await db.prepare(`DELETE FROM ${table}`).run();
    }

    // Insert in batches of 50 (D1 limit-friendly)
    const BATCH_SIZE = 50;
    let inserted = 0;

    // Required (NOT NULL) key columns per table — skip rows missing these
    const requiredKeys: Record<string, string[]> = {
      import_log: ['import_id', 'market_id'],
      order_items: ['import_id', 'market_id', 'order_id'],
      order_events: ['event_id', 'event_type'],
      sku_map: ['dailyshot_product_key'],
      sku_master: ['master_sku'],
      cost_master: ['master_sku'],
      users: ['user_id'],
      audit_log: ['log_id', 'user_id'],
      daily_summary: ['sales_date'],
      market_summary: ['market_id'],
      sku_summary: ['master_sku'],
      inventory: ['master_sku'],
      suppliers: ['supplier_id'],
      supplier_products: ['supplier_id'],
      purchase_orders: ['po_id'],
      po_items: ['po_id'],
      price_history: ['supplier_id'],
    };
    const reqCols = requiredKeys[table] || [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const stmts: D1PreparedStatement[] = [];

      for (const row of batch) {
        // Skip rows where required columns are empty/null
        const missing = reqCols.some(c => {
          const v = row[c];
          return v === undefined || v === null || v === '';
        });
        if (missing) continue;

        const vals = columns.map(col => {
          const v = row[col];
          if (v === undefined || v === null || v === '') return null;
          return v;
        });
        const placeholders = columns.map(() => '?').join(',');
        stmts.push(
          db.prepare(
            `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`
          ).bind(...vals)
        );
      }

      if (stmts.length > 0) {
        await db.batch(stmts);
      }
      inserted += stmts.length;
    }

    return NextResponse.json({ ok: true, table, inserted });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
