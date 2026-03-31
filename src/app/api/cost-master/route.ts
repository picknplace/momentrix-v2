/**
 * GET  /api/cost-master — 원가 마스터 조회
 * POST /api/cost-master — 원가 마스터 CRUD (upsert, delete)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, execute } from '@/lib/db';

export const runtime = 'edge';

export async function GET() {
  const { error } = withAuth();
  if (error) return error;

  const rows = await queryAll(
    'SELECT * FROM cost_master ORDER BY master_sku',
  );
  return NextResponse.json({ ok: true, costs: rows });
}

export async function POST(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const body = await req.json();
  const action = body.action as string;

  if (action === 'upsert') {
    const { master_sku, product_name, purchase_cost, shipping_cost, packaging_cost, tariff_cost, other_cost } = body;
    if (!master_sku) return NextResponse.json({ ok: false, message: 'master_sku 필요' }, { status: 400 });

    const total = (purchase_cost || 0) + (shipping_cost || 0) + (packaging_cost || 0) + (tariff_cost || 0) + (other_cost || 0);

    await execute(
      `INSERT OR REPLACE INTO cost_master (master_sku, product_name, purchase_cost, shipping_cost, packaging_cost, tariff_cost, other_cost, total_cost, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      master_sku, product_name || '', purchase_cost || 0, shipping_cost || 0, packaging_cost || 0, tariff_cost || 0, other_cost || 0, total,
    );

    return NextResponse.json({ ok: true, message: '원가 저장 완료' });
  }

  if (action === 'delete') {
    const { master_sku } = body;
    if (!master_sku) return NextResponse.json({ ok: false, message: 'master_sku 필요' }, { status: 400 });
    await execute('DELETE FROM cost_master WHERE master_sku = ?', master_sku);
    return NextResponse.json({ ok: true, message: '삭제 완료' });
  }

  return NextResponse.json({ ok: false, message: `알 수 없는 action: ${action}` }, { status: 400 });
}
