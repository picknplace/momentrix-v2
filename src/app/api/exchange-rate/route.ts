/**
 * GET /api/exchange-rate — 한국수출입은행 환율 조회
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

export async function GET() {
  const { error } = withAuth();
  if (error) return error;

  try {
    const { env } = getRequestContext();
    const apiKey = (env as Record<string, string>).EXIM_API_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, message: 'EXIM_API_KEY가 설정되지 않았습니다.' });

    const today = new Date();
    const dateStr = today.toISOString().substring(0, 10).replace(/-/g, '');
    const todayFmt = today.toISOString().substring(0, 10);

    const url = `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${encodeURIComponent(apiKey)}&searchdate=${dateStr}&data=AP01`;
    const res = await fetch(url);
    const text = await res.text();

    if (!text || text.charAt(0) !== '[') {
      return NextResponse.json({ ok: false, message: `오늘(${todayFmt})은 휴일입니다. 환율 데이터가 없습니다.` });
    }

    const json = JSON.parse(text) as Array<{ cur_unit: string; deal_bas_r: string }>;
    if (!json?.length) {
      return NextResponse.json({ ok: false, message: `오늘(${todayFmt})은 휴일입니다.` });
    }

    let usd = 0, jpy100 = 0;
    for (const r of json) {
      const rate = parseFloat((r.deal_bas_r || '0').replace(/,/g, ''));
      if (r.cur_unit === 'USD') usd = rate;
      if (r.cur_unit === 'JPY(100)') jpy100 = rate;
    }

    if (usd === 0) {
      return NextResponse.json({ ok: false, message: `오늘(${todayFmt})은 휴일입니다.` });
    }

    return NextResponse.json({ ok: true, date: todayFmt, usd, jpy100 });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
