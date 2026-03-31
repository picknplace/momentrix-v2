/**
 * GET  /api/ecount — Fetch order data formatted for Ecount transmission
 * POST /api/ecount — Ecount actions (mark_done)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, execute } from '@/lib/db';
import { writeAuditLog } from '@/lib/services/audit';
import { nowKST } from '@/lib/parsers/utils';

export const runtime = 'edge';

interface EcountRow {
  id: number;
  market_id: string;
  order_id: string;
  sub_order_id: string;
  master_sku: string;
  product_name_raw: string;
  qty: number;
  sales_date: string;
  recipient_name: string;
  order_status: string;
  ec_status: string | null;
}

export async function GET(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const filter = url.searchParams.get('filter') || 'pending'; // pending | all | cancelled_pending

  let where = "WHERE 1=1";
  const params: unknown[] = [];

  if (dateFrom) { where += ' AND oi.sales_date >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND oi.sales_date <= ?'; params.push(dateTo); }

  if (filter === 'pending') {
    where += " AND oi.order_status = 'normal' AND (oi.ec_status IS NULL OR oi.ec_status = '')";
  } else if (filter === 'cancelled_pending') {
    where += " AND oi.order_status = 'cancelled' AND (oi.ec_status IS NULL OR oi.ec_status = '')";
  }

  const rows = await queryAll<EcountRow>(
    `SELECT oi.id, oi.market_id, oi.order_id, oi.sub_order_id, oi.master_sku,
            oi.product_name_raw, oi.qty, oi.sales_date, oi.recipient_name,
            oi.order_status, oi.ec_status
     FROM order_items oi
     ${where}
     ORDER BY oi.sales_date DESC, oi.id DESC`,
    ...params,
  );

  // SKU name map from sku_master
  const skuRows = await queryAll<{ master_sku: string; product_name: string }>(
    'SELECT master_sku, product_name FROM sku_master',
  );
  const skuNames: Record<string, string> = {};
  for (const s of skuRows) skuNames[s.master_sku] = s.product_name;

  // Count pending cancels
  const pendingCancels = await queryAll<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM order_items WHERE order_status = 'cancelled' AND (ec_status IS NULL OR ec_status = '')",
  );

  return NextResponse.json({
    ok: true,
    rows,
    skuNames,
    pendingCancels: pendingCancels[0]?.cnt || 0,
  });
}

export async function POST(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const body = await req.json();
  const action = body.action as string;

  if (action === 'mark_done') {
    return handleMarkDone(body, user.user_id);
  }

  return NextResponse.json({ ok: false, message: '알 수 없는 action: ' + action }, { status: 400 });
}

async function handleMarkDone(body: Record<string, unknown>, userId: string) {
  const { target, order_ids } = body as { target: string; order_ids?: string[] };
  const now = nowKST();
  const ecStatus = 'done_' + now;

  let where = '';
  const params: unknown[] = [ecStatus];

  if (target === 'cancel') {
    where = "WHERE order_status = 'cancelled' AND (ec_status IS NULL OR ec_status = '')";
  } else if (target === 'order') {
    where = "WHERE order_status = 'normal' AND (ec_status IS NULL OR ec_status = '')";
  } else {
    where = "WHERE (ec_status IS NULL OR ec_status = '')";
  }

  if (order_ids && order_ids.length > 0) {
    const placeholders = order_ids.map(() => '?').join(',');
    where += ` AND (order_id IN (${placeholders}) OR sub_order_id IN (${placeholders}))`;
    params.push(...order_ids, ...order_ids);
  }

  const result = await execute(
    `UPDATE order_items SET ec_status = ? ${where}`,
    ...params,
  );

  const count = result.meta.changes ?? 0;

  await writeAuditLog(userId, 'ecount_mark_done', 'order_items', target, undefined, undefined, undefined, 'success', `${count}건`);

  return NextResponse.json({ ok: true, count });
}
