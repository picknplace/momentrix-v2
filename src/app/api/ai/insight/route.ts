/**
 * GET /api/ai/insight — AI 인사이트 (1일 1회 캐싱, 오후 1시 KST 갱신)
 * POST /api/ai/insight — 강제 갱신
 *
 * 대시보드 데이터를 Claude Haiku에 보내 자동 분석:
 * - 매출 트렌드 요약
 * - 이상 탐지 (취소율 급등, 매출 급변)
 * - 수요 예측 (최근 7일 기반 다음 주 예상)
 * - 재고 추천 (리드타임 + 판매속도 기반 발주 타이밍)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

const CACHE_KEY = 'ai_insight_cache';
const CACHE_TS_KEY = 'ai_insight_cache_at';

async function callClaude(prompt: string, system: string): Promise<string> {
  const { env } = getRequestContext();
  const apiKey = (env as Record<string, string>).ANTHROPIC_API_KEY;
  if (!apiKey) return '(ANTHROPIC_API_KEY 미설정)';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return `(AI 오류: ${res.status} ${err.substring(0, 200)})`;
  }

  const data = await res.json() as { content: { text: string }[]; usage?: { input_tokens: number; output_tokens: number } };

  // Log usage for cost tracking
  if (data.usage) {
    try {
      const today = new Date().toISOString().substring(0, 10);
      await execute(
        `INSERT INTO config_kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT)`,
        `ai_tokens_in_${today}`, String(data.usage.input_tokens), data.usage.input_tokens,
      );
      await execute(
        `INSERT INTO config_kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT)`,
        `ai_tokens_out_${today}`, String(data.usage.output_tokens), data.usage.output_tokens,
      );
      await execute(
        `INSERT INTO config_kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
        `ai_calls_${today}`, '1', 1,
      );
    } catch { /* non-fatal */ }
  }

  return data.content?.[0]?.text ?? '';
}

async function gatherData() {
  // Last 30 days
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString().substring(0, 10);
  const d7 = new Date(now.getTime() - 7 * 86400000).toISOString().substring(0, 10);
  const today = now.toISOString().substring(0, 10);

  const [kpi30, daily7, byMarket, topSkus, cancelTrend, leadTime, lowStock] = await Promise.all([
    // 30-day KPIs
    queryOne<{ orders: number; qty: number; sales: number; settlement: number; skus: number }>(
      `SELECT COUNT(*) as orders, COALESCE(SUM(qty),0) as qty,
              COALESCE(SUM(sales_amount),0) as sales, COALESCE(SUM(settlement_amount),0) as settlement,
              COUNT(DISTINCT master_sku) as skus
       FROM order_items WHERE order_status='normal' AND sales_date >= ?`, d30,
    ),

    // Daily trend last 7 days
    queryAll<{ sales_date: string; orders: number; settlement: number }>(
      `SELECT sales_date, COUNT(*) as orders, SUM(settlement_amount) as settlement
       FROM order_items WHERE order_status='normal' AND sales_date >= ?
       GROUP BY sales_date ORDER BY sales_date`, d7,
    ),

    // Market breakdown
    queryAll<{ market_id: string; orders: number; settlement: number }>(
      `SELECT market_id, COUNT(*) as orders, SUM(settlement_amount) as settlement
       FROM order_items WHERE order_status='normal' AND sales_date >= ?
       GROUP BY market_id`, d30,
    ),

    // Top 5 SKUs
    queryAll<{ master_sku: string; product_name_raw: string; qty: number; settlement: number }>(
      `SELECT master_sku, MIN(product_name_raw) as product_name_raw, SUM(qty) as qty, SUM(settlement_amount) as settlement
       FROM order_items WHERE order_status='normal' AND sales_date >= ?
       GROUP BY master_sku ORDER BY settlement DESC LIMIT 5`, d30,
    ),

    // Cancel trend (last 7 days)
    queryAll<{ sales_date: string; cancel_count: number; total_count: number }>(
      `SELECT sales_date,
              SUM(CASE WHEN order_status='cancelled' THEN 1 ELSE 0 END) as cancel_count,
              COUNT(*) as total_count
       FROM order_items WHERE sales_date >= ?
       GROUP BY sales_date ORDER BY sales_date`, d7,
    ),

    // Lead time by SKU (for restock recommendation)
    queryAll<{ master_sku: string; product_name_raw: string; avg_days: number; avg_daily_qty: number }>(
      `SELECT master_sku, MIN(product_name_raw) as product_name_raw,
              ROUND(AVG(JULIANDAY(ship_date) - JULIANDAY(sales_date)), 1) as avg_days,
              ROUND(CAST(SUM(qty) AS FLOAT) / 30, 1) as avg_daily_qty
       FROM order_items
       WHERE order_status='normal' AND ship_date IS NOT NULL AND ship_date != ''
         AND sales_date >= ?
       GROUP BY master_sku HAVING COUNT(*) >= 3
       ORDER BY avg_daily_qty DESC LIMIT 10`, d30,
    ),

    // Low stock items
    queryAll<{ master_sku: string; product_name: string; available: number; safety_stock: number }>(
      `SELECT master_sku, product_name, available, safety_stock
       FROM inventory WHERE available <= safety_stock AND safety_stock > 0
       ORDER BY (available - safety_stock) ASC LIMIT 5`,
    ),
  ]);

  return { kpi30, daily7, byMarket, topSkus, cancelTrend, leadTime, lowStock, today };
}

async function generateInsight() {
  const data = await gatherData();

  const system = `당신은 일본 주류 수입 이커머스(데일리샷, 키햐 마켓 판매) 전문 비즈니스 분석가입니다.
한국어로 간결하게 답변하세요. 이모지를 적절히 사용하세요.
응답은 반드시 아래 5개 섹션으로 구분:
1. 📊 핵심 요약 (2-3줄)
2. 🔥 주요 트렌드 (3-5개 bullet)
3. ⚠️ 이상 탐지 / 주의사항 (취소율 급등, 매출 급변 등)
4. 📈 수요 예측 (최근 7일 기반, 다음 주 예상 매출/건수)
5. 📦 재고/발주 추천 (리드타임+판매속도 기반)`;

  const prompt = `아래 데이터를 분석해주세요:

## 30일 KPI
주문: ${data.kpi30?.orders}건, 수량: ${data.kpi30?.qty}, 매출: ${data.kpi30?.sales?.toLocaleString()}원, 정산: ${data.kpi30?.settlement?.toLocaleString()}원, SKU수: ${data.kpi30?.skus}

## 최근 7일 일별 추이
${data.daily7.map(d => `${d.sales_date}: ${d.orders}건, ${Math.round(d.settlement/10000)}만원`).join('\n')}

## 마켓별 (30일)
${data.byMarket.map(m => `${m.market_id}: ${m.orders}건, ${Math.round(m.settlement/10000)}만원`).join('\n')}

## TOP 5 SKU (30일 정산순)
${data.topSkus.map((s,i) => `${i+1}. ${s.product_name_raw} (${s.master_sku}): ${s.qty}개, ${Math.round(s.settlement/10000)}만원`).join('\n')}

## 취소 추이 (7일)
${data.cancelTrend.map(c => `${c.sales_date}: ${c.cancel_count}/${c.total_count}건 (${c.total_count > 0 ? Math.round(c.cancel_count/c.total_count*100) : 0}%)`).join('\n')}

## SKU별 리드타임 & 일평균 판매량
${data.leadTime.map(l => `${l.product_name_raw}: 리드타임 ${l.avg_days}일, 일평균 ${l.avg_daily_qty}개`).join('\n')}

## 재고 부족 품목
${data.lowStock.length > 0 ? data.lowStock.map(s => `${s.product_name} (${s.master_sku}): 가용 ${s.available}, 안전재고 ${s.safety_stock}`).join('\n') : '없음'}

오늘 날짜: ${data.today}`;

  return await callClaude(prompt, system);
}

function shouldRefresh(cachedAt: string): boolean {
  const now = new Date();
  // KST = UTC+9
  const kstHour = (now.getUTCHours() + 9) % 24;
  const cachedDate = cachedAt.substring(0, 10);
  const todayKST = new Date(now.getTime() + 9 * 3600000).toISOString().substring(0, 10);

  // Refresh if: cached date < today AND current KST hour >= 13
  if (cachedDate < todayKST && kstHour >= 13) return true;
  // Also refresh if no cache
  if (!cachedAt) return true;
  return false;
}

export async function GET() {
  const { error } = withAuth();
  if (error) return error;

  // Check cache
  try {
    const cached = await queryOne<{ value: string }>(`SELECT value FROM config_kv WHERE key = ?`, CACHE_KEY);
    const cachedAt = await queryOne<{ value: string }>(`SELECT value FROM config_kv WHERE key = ?`, CACHE_TS_KEY);

    if (cached && cachedAt && !shouldRefresh(cachedAt.value)) {
      return NextResponse.json({ ok: true, insight: cached.value, cachedAt: cachedAt.value, cached: true });
    }
  } catch { /* continue */ }

  // Generate new insight
  const insight = await generateInsight();
  const now = new Date().toISOString();

  try {
    await execute(`INSERT OR REPLACE INTO config_kv (key, value) VALUES (?, ?)`, CACHE_KEY, insight);
    await execute(`INSERT OR REPLACE INTO config_kv (key, value) VALUES (?, ?)`, CACHE_TS_KEY, now);
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, insight, cachedAt: now, cached: false });
}

export async function POST() {
  const { error } = withAuth();
  if (error) return error;

  const insight = await generateInsight();
  const now = new Date().toISOString();

  try {
    await execute(`INSERT OR REPLACE INTO config_kv (key, value) VALUES (?, ?)`, CACHE_KEY, insight);
    await execute(`INSERT OR REPLACE INTO config_kv (key, value) VALUES (?, ?)`, CACHE_TS_KEY, now);
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, insight, cachedAt: now, cached: false });
}
