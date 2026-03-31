/**
 * GET /api/pantos/cron — Cron trigger 배송 상태 자동 갱신
 *
 * Cloudflare Cron Trigger 또는 외부 cron에서 호출.
 * 인증: Cron-Secret 헤더 또는 쿼리 파라미터로 검증.
 * (내부 JWT 인증 없이 동작 — cron은 사용자 세션이 없음)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { refreshTracking } from '@/lib/services/pantos';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  // Cron 인증: 환경변수 CRON_SECRET과 비교
  const { env } = getRequestContext();
  const cronSecret = (env as Record<string, string>).CRON_SECRET;

  if (cronSecret) {
    const url = new URL(req.url);
    const provided = req.headers.get('x-cron-secret') || url.searchParams.get('secret');
    if (provided !== cronSecret) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await refreshTracking();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
