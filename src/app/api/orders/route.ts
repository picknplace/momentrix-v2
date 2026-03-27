/**
 * GET  /api/orders — List orders (with filters)
 * POST /api/orders — Cancel, refund, rollback operations
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, queryOne, execute } from '@/lib/db';
import { writeAuditLog } from '@/lib/services/audit';
import { nowKST } from '@/lib/parsers/utils';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const url = new URL(req.url);
  const marketId = url.searchParams.get('marketId');
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const status = url.searchParams.get('status');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];

  if (marketId) { where += ' AND market_id = ?'; params.push(marketId); }
  if (dateFrom) { where += ' AND sales_date >= ?'; params.push(dateFrom); }
  if (dateTo)   { where += ' AND sales_date <= ?'; params.push(dateTo); }
  if (status)   { where += ' AND order_status = ?'; params.push(status); }

  const countRow = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM order_items ${where}`, ...params,
  );
  const total = countRow?.cnt ?? 0;

  const rows = await queryAll(
    `SELECT * FROM order_items ${where} ORDER BY sales_date DESC, id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );

  return NextResponse.json({ ok: true, orders: rows, total, page, limit });
}

export async function POST(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const body = await req.json();
  const action = body.action as string;

  if (action === 'cancel') {
    return handleCancel(body, user.user_id);
  } else if (action === 'refund') {
    return handleRefund(body, user.user_id);
  } else if (action === 'rollback') {
    return handleRollback(body, user.user_id);
  }

  return NextResponse.json({ ok: false, message: '알 수 없는 action: ' + action }, { status: 400 });
}

async function handleCancel(body: Record<string, unknown>, userId: string) {
  const { market_id, order_id, reason, cancel_date } = body as Record<string, string>;
  const now = nowKST();
  const cancelledAt = cancel_date || now.substring(0, 10);

  const idField = market_id === 'kihya' ? 'sub_order_id' : 'order_id';

  const result = await execute(
    `UPDATE order_items SET order_status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ?
     WHERE market_id = ? AND ${idField} = ? AND order_status = 'normal'`,
    cancelledAt, reason || '', now, market_id, order_id,
  );

  if (!result.meta.changes || result.meta.changes === 0) {
    return NextResponse.json({ ok: false, message: '해당 주문을 찾을 수 없습니다.' });
  }

  const eventId = 'EVT_' + crypto.randomUUID().substring(0, 8).toUpperCase();
  await execute(
    'INSERT INTO order_events (event_id, occurred_at, event_type, market_id, order_id, reason, operator) VALUES (?, ?, ?, ?, ?, ?, ?)',
    eventId, cancelledAt, 'cancel_order', market_id, order_id, reason || '', userId,
  );

  await writeAuditLog(userId, 'cancel_order', 'order_items', order_id as string, undefined, undefined, undefined, 'success');

  return NextResponse.json({ ok: true, message: `주문 취소 완료 (${cancelledAt}).` });
}

async function handleRefund(body: Record<string, unknown>, userId: string) {
  const { market_id, order_id, refund_amount, reason } = body as Record<string, string>;
  const now = nowKST();
  const amt = parseFloat(refund_amount as string) || 0;

  const row = await queryOne<{ id: number; refund_amount: number }>(
    `SELECT id, refund_amount FROM order_items WHERE market_id = ? AND order_id = ? AND order_status != 'cancelled' AND order_status != 'rolled_back' LIMIT 1`,
    market_id, order_id,
  );

  if (!row) return NextResponse.json({ ok: false, message: '해당 주문을 찾을 수 없습니다.' });

  const newRefund = (row.refund_amount || 0) + amt;
  await execute(
    `UPDATE order_items SET refund_amount = ?, order_status = 'refunded', refund_reason = ?, updated_at = ? WHERE id = ?`,
    newRefund, reason || '', now, row.id,
  );

  const eventId = 'EVT_' + crypto.randomUUID().substring(0, 8).toUpperCase();
  await execute(
    'INSERT INTO order_events (event_id, occurred_at, event_type, market_id, order_id, amount, reason, operator) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    eventId, now, 'refund_partial', market_id, order_id, amt, reason || '', userId,
  );

  await writeAuditLog(userId, 'refund_partial', 'order_items', order_id as string, undefined, undefined, undefined, 'success');

  return NextResponse.json({ ok: true, message: '부분 환불 완료.' });
}

async function handleRollback(body: Record<string, unknown>, userId: string) {
  const { import_id, reason } = body as Record<string, string>;
  const now = nowKST();

  const result = await execute(
    `UPDATE order_items SET order_status = 'rolled_back', updated_at = ? WHERE import_id = ?`,
    now, import_id,
  );

  await execute(
    `UPDATE import_log SET upload_status = 'cancelled', cancelled_at = ?, cancel_reason = ? WHERE import_id = ?`,
    now, reason || 'rollback', import_id,
  );

  const eventId = 'EVT_' + crypto.randomUUID().substring(0, 8).toUpperCase();
  await execute(
    'INSERT INTO order_events (event_id, occurred_at, event_type, ref_import_id, reason, operator) VALUES (?, ?, ?, ?, ?, ?)',
    eventId, now, 'rollback_import', import_id, reason || 'rollback', userId,
  );

  await writeAuditLog(userId, 'rollback_import', 'import_log', import_id as string, undefined, undefined, undefined, 'success');

  return NextResponse.json({
    ok: true,
    message: `${result.meta.changes ?? 0}건 롤백 완료. 동일 파일 재업로드가 가능합니다.`,
  });
}
