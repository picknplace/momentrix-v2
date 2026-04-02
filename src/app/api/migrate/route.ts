/**
 * POST /api/migrate — Bulk data import from GAS
 * Protected by CRON_SECRET header
 * Accepts { table, rows, clear } and inserts into D1
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
    'pantos_ord_id', 'hawb_no', 'delivery_status', 'delivery_status_dt',
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

// Primary key columns only — rows missing PK are truly empty rows to skip
const PK_COLUMNS: Record<string, string[]> = {
  import_log: ['import_id'],
  order_items: ['order_id'],
  order_events: ['event_id'],
  sku_map: ['dailyshot_product_key'],
  sku_master: ['master_sku'],
  cost_master: ['master_sku'],
  users: ['user_id'],
  audit_log: ['log_id'],
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

// NOT NULL columns and their default values (when GAS sends empty/null)
const NOT_NULL_DEFAULTS: Record<string, Record<string, unknown>> = {
  import_log: { market_id: '기타', file_name: '', sales_date: '1970-01-01', upload_status: 'success' },
  order_items: { import_id: 'UNKNOWN', market_id: '기타', sales_date: '1970-01-01', order_id: '' },
  order_events: { event_type: 'unknown', market_id: '', order_id: '' },
  sku_master: { product_name: '(미등록)' },
  users: { password_hash: '', email: '', name: '', role: 'operator', status: 'active' },
  audit_log: { user_id: 'system', action_type: 'unknown' },
  suppliers: { name: '' },
};

// Child tables to clear when clearing a parent table (FK dependencies)
const CASCADE_CLEAR: Record<string, string[]> = {
  import_log: ['order_items'],
  users: ['auth_otp'],
  suppliers: ['supplier_products'],
  purchase_orders: ['po_items'],
};

export async function POST(req: NextRequest) {
  const { env } = getRequestContext();
  const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '');

  if (secret !== (env as Record<string, string>).CRON_SECRET) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await req.json() as any;

  // action: 'update_pantos' → pantos_ord_id/hawb_no 일괄 업데이트 (PATCH 대체)
  if (body.action === 'update_pantos' && body.updates?.length) {
    const db = (env as Record<string, unknown>).DB as D1Database;
    try {
      const BATCH = 50;
      let updated = 0;
      for (let i = 0; i < body.updates.length; i += BATCH) {
        const chunk = body.updates.slice(i, i + BATCH);
        const stmts: D1PreparedStatement[] = [];
        for (const u of chunk) {
          const sets: string[] = [];
          const params: unknown[] = [];
          if (u.pantos_ord_id !== undefined) { sets.push('pantos_ord_id = ?'); params.push(u.pantos_ord_id); }
          if (u.hawb_no !== undefined) { sets.push('hawb_no = ?'); params.push(u.hawb_no); }
          if (u.delivery_status !== undefined) { sets.push('delivery_status = ?'); params.push(u.delivery_status); }
          if (!sets.length) continue;
          if (u.sub_order_id) {
            stmts.push(db.prepare(`UPDATE order_items SET ${sets.join(', ')} WHERE order_id = ? OR sub_order_id = ?`).bind(...params, u.order_id, u.sub_order_id));
          } else {
            stmts.push(db.prepare(`UPDATE order_items SET ${sets.join(', ')} WHERE order_id = ?`).bind(...params, u.order_id));
          }
        }
        if (stmts.length) {
          await db.batch(stmts);
          updated += stmts.length;
        }
      }
      return NextResponse.json({ ok: true, updated });
    } catch (err) {
      return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  const { table, rows, clear } = body as { table: string; rows: Record<string, unknown>[]; clear?: boolean };

  if (!table || !rows?.length) {
    return NextResponse.json({ ok: false, message: 'table and rows required' }, { status: 400 });
  }

  const columns = TABLE_COLUMNS[table];
  if (!columns) {
    return NextResponse.json({ ok: false, message: `Unknown table: ${table}` }, { status: 400 });
  }

  const db = (env as Record<string, unknown>).DB as D1Database;

  try {
    // Clear: delete child tables first (FK cascade), then parent
    if (clear) {
      const children = CASCADE_CLEAR[table] || [];
      for (const child of children) {
        await db.prepare(`DELETE FROM ${child}`).run();
      }
      await db.prepare(`DELETE FROM ${table}`).run();
    }

    const BATCH_SIZE = 50;
    let inserted = 0;
    let skipped = 0;
    const pkCols = PK_COLUMNS[table] || [];
    const defaults = NOT_NULL_DEFAULTS[table] || {};
    let autoIdx = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const stmts: D1PreparedStatement[] = [];

      // Disable FK checks within this batch
      stmts.push(db.prepare('PRAGMA foreign_keys = OFF'));

      for (const row of batch) {
        // Check if ALL values are empty (truly empty row)
        const allEmpty = columns.every(c => {
          const v = row[c];
          return v === undefined || v === null || v === '';
        });
        if (allEmpty) { skipped++; continue; }

        const vals = columns.map(col => {
          let v = row[col];
          // If value is empty/null, check for NOT NULL default or auto-generate
          if (v === undefined || v === null || v === '') {
            // Auto-generate PK if missing
            if (pkCols.includes(col)) {
              autoIdx++;
              return `MIGRATE_${table}_${Date.now()}_${autoIdx}`;
            }
            if (col in defaults) return defaults[col];
            return null;
          }
          return v;
        });

        const placeholders = columns.map(() => '?').join(',');
        stmts.push(
          db.prepare(
            `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`
          ).bind(...vals)
        );
      }

      if (stmts.length > 1) { // > 1 because first is PRAGMA
        await db.batch(stmts);
      }
      inserted += stmts.length - 1; // subtract PRAGMA statement
    }

    return NextResponse.json({ ok: true, table, inserted, skipped });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

/**
 * PATCH /api/migrate — Bulk UPDATE specific columns by matching key
 * Body: { table, key, keyColumn, updates: [{ keyValue, col1, col2, ... }] }
 * Used for backfilling pantos_ord_id, hawb_no, delivery_status etc.
 */
export async function PATCH(req: NextRequest) {
  const { env } = getRequestContext();
  const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '');

  if (secret !== (env as Record<string, string>).CRON_SECRET) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as {
    updates: { order_id: string; sub_order_id?: string; pantos_ord_id?: string; hawb_no?: string; delivery_status?: string }[];
  };

  if (!body.updates?.length) {
    return NextResponse.json({ ok: false, message: 'updates required' }, { status: 400 });
  }

  const db = (env as Record<string, unknown>).DB as D1Database;

  try {
    const BATCH = 50;
    let updated = 0;

    for (let i = 0; i < body.updates.length; i += BATCH) {
      const chunk = body.updates.slice(i, i + BATCH);
      const stmts: D1PreparedStatement[] = [];

      for (const u of chunk) {
        const sets: string[] = [];
        const params: unknown[] = [];

        if (u.pantos_ord_id !== undefined) { sets.push('pantos_ord_id = ?'); params.push(u.pantos_ord_id); }
        if (u.hawb_no !== undefined) { sets.push('hawb_no = ?'); params.push(u.hawb_no); }
        if (u.delivery_status !== undefined) { sets.push('delivery_status = ?'); params.push(u.delivery_status); }

        if (!sets.length) continue;

        if (u.sub_order_id) {
          stmts.push(
            db.prepare(`UPDATE order_items SET ${sets.join(', ')} WHERE order_id = ? OR sub_order_id = ?`)
              .bind(...params, u.order_id, u.sub_order_id)
          );
        } else {
          stmts.push(
            db.prepare(`UPDATE order_items SET ${sets.join(', ')} WHERE order_id = ?`)
              .bind(...params, u.order_id)
          );
        }
      }

      if (stmts.length) {
        await db.batch(stmts);
        updated += stmts.length;
      }
    }

    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
