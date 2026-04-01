/**
 * GET /api/ai/usage — AI API 사용량/비용 조회 (관리자 전용)
 * Haiku 4.5 가격: Input $0.80/MTok, Output $4.00/MTok
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll } from '@/lib/db';

export const runtime = 'edge';

const HAIKU_INPUT_PRICE = 0.80;  // $/MTok
const HAIKU_OUTPUT_PRICE = 4.00; // $/MTok
const KRW_PER_USD = 1400;

export async function GET() {
  const { user, error } = withAuth();
  if (error) return error;
  if (user?.role !== 'admin') {
    return NextResponse.json({ ok: false, message: '관리자 전용' }, { status: 403 });
  }

  // Fetch last 30 days of usage
  const rows = await queryAll<{ key: string; value: string }>(
    `SELECT key, value FROM config_kv WHERE key LIKE 'ai_tokens_in_%' OR key LIKE 'ai_tokens_out_%' OR key LIKE 'ai_calls_%' ORDER BY key`,
  );

  // Parse into daily usage
  const dailyMap: Record<string, { input: number; output: number; calls: number }> = {};

  for (const row of rows) {
    const val = parseInt(row.value) || 0;
    if (row.key.startsWith('ai_tokens_in_')) {
      const date = row.key.replace('ai_tokens_in_', '');
      if (!dailyMap[date]) dailyMap[date] = { input: 0, output: 0, calls: 0 };
      dailyMap[date].input = val;
    } else if (row.key.startsWith('ai_tokens_out_')) {
      const date = row.key.replace('ai_tokens_out_', '');
      if (!dailyMap[date]) dailyMap[date] = { input: 0, output: 0, calls: 0 };
      dailyMap[date].output = val;
    } else if (row.key.startsWith('ai_calls_')) {
      const date = row.key.replace('ai_calls_', '');
      if (!dailyMap[date]) dailyMap[date] = { input: 0, output: 0, calls: 0 };
      dailyMap[date].calls = val;
    }
  }

  const daily = Object.entries(dailyMap)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, d]) => {
      const costUsd = (d.input / 1_000_000) * HAIKU_INPUT_PRICE + (d.output / 1_000_000) * HAIKU_OUTPUT_PRICE;
      return {
        date,
        inputTokens: d.input,
        outputTokens: d.output,
        calls: d.calls,
        costUsd: Math.round(costUsd * 10000) / 10000,
        costKrw: Math.round(costUsd * KRW_PER_USD),
      };
    });

  const totalCostUsd = daily.reduce((s, d) => s + d.costUsd, 0);
  const totalCalls = daily.reduce((s, d) => s + d.calls, 0);
  const totalInput = daily.reduce((s, d) => s + d.inputTokens, 0);
  const totalOutput = daily.reduce((s, d) => s + d.outputTokens, 0);

  return NextResponse.json({
    ok: true,
    summary: {
      totalCalls,
      totalInput,
      totalOutput,
      totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      totalCostKrw: Math.round(totalCostUsd * KRW_PER_USD),
    },
    daily,
  });
}
