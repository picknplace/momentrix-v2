/**
 * GET  /api/shipping — Shipping status list + counts
 * POST /api/shipping — Update tracking numbers
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, queryOne, executeBatch } from '@/lib/db';
import { writeAuditLog } from '@/lib/services/audit';
import { nowKST } from '@/lib/parsers/utils';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { error } = withAuth();
  if (error) return error;

  const url = new URL(req.url);
  const shipFilter = url.searchParams.get('shipFilter') || 'all'; // all | unshipped | shipped
  const marketId = url.searchParams.get('marketId');
  const deliveryStatus = url.searchParams.get('deliveryStatus');
  const search = url.searchParams.get('search');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '500', 10);
  const offset = (page - 1) * limit;

  let where = "WHERE order_status = 'normal'";
  const params: unknown[] = [];

  if (shipFilter === 'unshipped') {
    where += " AND (tracking_no IS NULL OR tracking_no = '')";
  } else if (shipFilter === 'shipped') {
    where += " AND tracking_no IS NOT NULL AND tracking_no != ''";
  }
  if (marketId) { where += ' AND market_id = ?'; params.push(marketId); }
  if (deliveryStatus) { where += ' AND delivery_status = ?'; params.push(deliveryStatus); }
  if (search) {
    where += " AND (order_id LIKE ? OR sub_order_id LIKE ? OR product_name_raw LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const [rows, countRow, unshippedCount, shippedCount, deliveryCounts] = await Promise.all([
    queryAll(
      `SELECT id, market_id, SUBSTR(sales_date, 1, 10) as sales_date, order_id, sub_order_id,
              master_sku, product_name_raw, qty, settlement_amount,
              recipient_name, customs_id, tracking_no, SUBSTR(ship_date, 1, 10) as ship_date,
              delivery_status, delivery_status_dt
       FROM order_items ${where}
       ORDER BY sales_date DESC, id DESC LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    ),
    queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM order_items ${where}`, ...params),
    queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM order_items WHERE order_status='normal' AND (tracking_no IS NULL OR tracking_no = '')`,
    ),
    queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM order_items WHERE order_status='normal' AND tracking_no IS NOT NULL AND tracking_no != ''`,
    ),
    // Delivery status counts
    queryAll<{ delivery_status: string; cnt: number }>(
      `SELECT COALESCE(delivery_status, '') as delivery_status, COUNT(*) as cnt
       FROM order_items WHERE order_status='normal' AND tracking_no IS NOT NULL AND tracking_no != ''
       GROUP BY delivery_status`,
    ),
  ]);

  return NextResponse.json({
    ok: true,
    orders: rows,
    total: countRow?.cnt || 0,
    unshipped: unshippedCount?.cnt || 0,
    shipped: shippedCount?.cnt || 0,
    deliveryCounts,
  });
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

  const stmts = updates.map(u => {
    const shipDate = u.ship_date || now.substring(0, 10);
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

  for (let i = 0; i < stmts.length; i += 80) {
    await executeBatch(stmts.slice(i, i + 80));
  }

  await writeAuditLog(user.user_id, 'tracking_update', 'order_items', '', undefined, undefined, undefined, 'success', `${updates.length}건 송장 업데이트`);

  return NextResponse.json({ ok: true, message: `${updates.length}건 송장번호 업데이트 완료` });
}
