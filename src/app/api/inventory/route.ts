/**
 * GET  /api/inventory — List inventory items
 * POST /api/inventory — Inventory actions (adjust, batch_adjust)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, execute } from '@/lib/db';
import { writeAuditLog } from '@/lib/services/audit';
import { nowKST } from '@/lib/parsers/utils';

export const runtime = 'edge';

interface InventoryRow {
  master_sku: string;
  product_name: string;
  stock: number;
  allocated: number;
  available: number;
  safety_stock: number;
  search_keyword: string;
  last_sync: string;
  updated_at: string;
}

export async function GET(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const rows = await queryAll<InventoryRow>(
    'SELECT * FROM inventory ORDER BY master_sku',
  );

  // Last 7 days shipped qty per SKU
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10);
  const shipped = await queryAll<{ master_sku: string; shipped_qty: number }>(
    `SELECT master_sku, SUM(qty) as shipped_qty FROM order_items
     WHERE ship_date >= ? AND order_status = 'normal' AND master_sku IS NOT NULL AND master_sku != ''
     GROUP BY master_sku`,
    sevenDaysAgo,
  );
  const shippedMap: Record<string, number> = {};
  for (const s of shipped) shippedMap[s.master_sku] = s.shipped_qty;

  return NextResponse.json({ ok: true, rows, shippedMap });
}

export async function POST(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const body = await req.json();
  const action = body.action as string;

  if (action === 'adjust') {
    return handleAdjust(body, user.user_id);
  } else if (action === 'batch_adjust') {
    return handleBatchAdjust(body, user.user_id);
  }

  return NextResponse.json({ ok: false, message: '알 수 없는 action: ' + action }, { status: 400 });
}

async function handleAdjust(body: Record<string, unknown>, userId: string) {
  const { sku, qty, note } = body as { sku: string; qty: number; note?: string };
  const now = nowKST();

  const row = await queryAll<InventoryRow>(
    'SELECT * FROM inventory WHERE master_sku = ?', sku,
  );

  if (row.length === 0) {
    return NextResponse.json({ ok: false, message: '해당 SKU를 찾을 수 없습니다.' });
  }

  const cur = row[0];
  const newStock = cur.stock + qty;
  const newAvailable = newStock - cur.allocated;

  await execute(
    'UPDATE inventory SET stock = ?, available = ?, updated_at = ? WHERE master_sku = ?',
    newStock, newAvailable, now, sku,
  );

  await writeAuditLog(
    userId, 'inventory_adjust', 'inventory', sku,
    { stock: cur.stock, available: cur.available },
    { stock: newStock, available: newAvailable, note },
    undefined, 'success',
  );

  return NextResponse.json({ ok: true, message: `${sku} 재고 조정 완료 (${qty > 0 ? '+' : ''}${qty})` });
}

async function handleBatchAdjust(body: Record<string, unknown>, userId: string) {
  const { items } = body as { items: { sku: string; qty: number }[] };
  const now = nowKST();
  let count = 0;

  for (const item of items) {
    const row = await queryAll<InventoryRow>(
      'SELECT * FROM inventory WHERE master_sku = ?', item.sku,
    );
    if (row.length === 0) continue;

    const cur = row[0];
    const newStock = cur.stock + item.qty;
    const newAvailable = newStock - cur.allocated;

    await execute(
      'UPDATE inventory SET stock = ?, available = ?, updated_at = ? WHERE master_sku = ?',
      newStock, newAvailable, now, item.sku,
    );
    count++;
  }

  await writeAuditLog(userId, 'inventory_batch_adjust', 'inventory', '', undefined, undefined, undefined, 'success', `${count}건`);

  return NextResponse.json({ ok: true, message: `${count}건 재고 일괄 조정 완료` });
}
