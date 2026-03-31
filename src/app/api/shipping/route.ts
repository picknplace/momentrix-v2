/**
 * GET  /api/shipping — Shipping status (unshipped + shipped list)
 * POST /api/shipping — Update tracking numbers
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, execute, executeBatch } from '@/lib/db';
import { writeAuditLog } from '@/lib/services/audit';
import { nowKST } from '@/lib/parsers/utils';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const url = new URL(req.url);
  const filter = url.searchParams.get('filter') || 'unshipped'; // 'unshipped' | 'all'
  const marketId = url.searchParams.get('marketId');
  const limit = parseInt(url.searchParams.get('limit') || '500', 10);

  let where = "WHERE order_status = 'normal'";
  const params: unknown[] = [];

  if (filter === 'unshipped') {
    where += " AND (tracking_no IS NULL OR tracking_no = '')";
  }
  if (marketId) {
    where += ' AND market_id = ?';
    params.push(marketId);
  }

  const rows = await queryAll(
    `SELECT id, market_id, sales_date, order_id, sub_order_id, product_name_raw, qty,
            recipient_name, tracking_no, ship_date, address, postal_code, phone, mobile,
            pantos_ord_id, hawb_no, delivery_status, delivery_status_dt
     FROM order_items ${where}
     ORDER BY sales_date DESC LIMIT ?`,
    ...params, limit,
  );

  // Counts
  const unshippedCount = await queryAll<{ market_id: string; cnt: number }>(
    `SELECT market_id, COUNT(*) as cnt FROM order_items
     WHERE order_status = 'normal' AND (tracking_no IS NULL OR tracking_no = '')
     GROUP BY market_id`,
  );

  return NextResponse.json({ ok: true, orders: rows, unshippedCount });
}

export async function POST(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const body = await req.json();
  const updates = body.updates as Array<{
    order_id: string;
    sub_order_id?: string;
    tracking_no: string;
    ship_date?: string;
  }>;

  if (!updates?.length) {
    return NextResponse.json({ ok: false, message: '업데이트할 데이터가 없습니다.' }, { status: 400 });
  }

  const now = nowKST();
  let updated = 0;

  const stmts = updates.map(u => {
    const shipDate = u.ship_date || now.substring(0, 10);
    // Match by both order_id and sub_order_id if provided
    if (u.sub_order_id) {
      return {
        sql: `UPDATE order_items SET tracking_no = ?, ship_date = ?, updated_at = ?
              WHERE (order_id = ? OR sub_order_id = ?) AND order_status = 'normal'`,
        params: [u.tracking_no, shipDate, now, u.order_id, u.sub_order_id] as unknown[],
      };
    }
    return {
      sql: `UPDATE order_items SET tracking_no = ?, ship_date = ?, updated_at = ?
            WHERE order_id = ? AND order_status = 'normal'`,
      params: [u.tracking_no, shipDate, now, u.order_id] as unknown[],
    };
  });

  // Batch execute
  for (let i = 0; i < stmts.length; i += 80) {
    await executeBatch(stmts.slice(i, i + 80));
  }
  updated = updates.length;

  await writeAuditLog(user.user_id, 'tracking_update', 'order_items', '', undefined, undefined, undefined, 'success', `${updated}건 송장 업데이트`);

  return NextResponse.json({ ok: true, message: `${updated}건 송장번호 업데이트 완료` });
}
