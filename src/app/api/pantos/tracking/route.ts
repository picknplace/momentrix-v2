/**
 * GET  /api/pantos/tracking — 배송추적 현황 (상태별 요약)
 * POST /api/pantos/tracking — 수동 배송추적 갱신
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { refreshTracking, getTrackingStatus } from '@/lib/services/pantos';
import { writeAuditLog } from '@/lib/services/audit';

export const runtime = 'edge';

export async function GET() {
  const { error } = withAuth();
  if (error) return error;

  try {
    const status = await getTrackingStatus();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

export async function POST() {
  const { user, error } = withAuth();
  if (error) return error;

  try {
    const result = await refreshTracking();
    await writeAuditLog(
      user.user_id, 'pantos_tracking', 'order_items', '',
      undefined, JSON.stringify({ updated: result.updated, total: result.total }),
      undefined, result.ok ? 'success' : 'error', result.message,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
