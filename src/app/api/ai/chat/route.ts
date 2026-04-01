/**
 * POST /api/ai/chat — AI 챗봇 (자연어로 데이터 질의)
 * Body: { question: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

async function callClaude(system: string, userMsg: string): Promise<string> {
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
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return `(AI 오류: ${res.status})`;
  }

  const data = await res.json() as { content: { text: string }[]; usage?: { input_tokens: number; output_tokens: number } };

  // Log usage for cost tracking
  if (data.usage) {
    try {
      const now = new Date().toISOString();
      const today = now.substring(0, 10);
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

async function getContext(question: string) {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString().substring(0, 10);
  const d7 = new Date(now.getTime() - 7 * 86400000).toISOString().substring(0, 10);

  // Determine what data to fetch based on question keywords
  const q = question.toLowerCase();
  const parts: string[] = [];

  // Always include basic KPIs
  const kpi = await queryOne<{ orders: number; settlement: number; skus: number }>(
    `SELECT COUNT(*) as orders, COALESCE(SUM(settlement_amount),0) as settlement, COUNT(DISTINCT master_sku) as skus
     FROM order_items WHERE order_status='normal' AND sales_date >= ?`, d30,
  );
  parts.push(`[30일 KPI] 주문 ${kpi?.orders}건, 정산 ${kpi?.settlement?.toLocaleString()}원, SKU ${kpi?.skus}개`);

  if (q.includes('취소') || q.includes('환불') || q.includes('cancel')) {
    const cancels = await queryAll<{ sales_date: string; cnt: number }>(
      `SELECT sales_date, COUNT(*) as cnt FROM order_items WHERE order_status='cancelled' AND sales_date >= ? GROUP BY sales_date ORDER BY sales_date`, d7,
    );
    parts.push(`[취소 7일] ${cancels.map(c => `${c.sales_date}: ${c.cnt}건`).join(', ')}`);
  }

  if (q.includes('마켓') || q.includes('데일리') || q.includes('키햐') || q.includes('시장')) {
    const markets = await queryAll<{ market_id: string; orders: number; settlement: number }>(
      `SELECT market_id, COUNT(*) as orders, SUM(settlement_amount) as settlement FROM order_items WHERE order_status='normal' AND sales_date >= ? GROUP BY market_id`, d30,
    );
    parts.push(`[마켓별 30일] ${markets.map(m => `${m.market_id}: ${m.orders}건/${Math.round(m.settlement/10000)}만원`).join(', ')}`);
  }

  if (q.includes('sku') || q.includes('상품') || q.includes('품목') || q.includes('사케') || q.includes('맥주') || q.includes('위스키')) {
    const skus = await queryAll<{ product_name_raw: string; qty: number; settlement: number }>(
      `SELECT MIN(product_name_raw) as product_name_raw, SUM(qty) as qty, SUM(settlement_amount) as settlement
       FROM order_items WHERE order_status='normal' AND sales_date >= ? GROUP BY master_sku ORDER BY settlement DESC LIMIT 10`, d30,
    );
    parts.push(`[TOP10 SKU 30일] ${skus.map((s,i) => `${i+1}.${s.product_name_raw}: ${s.qty}개/${Math.round(s.settlement/10000)}만원`).join(', ')}`);
  }

  if (q.includes('재고') || q.includes('발주') || q.includes('stock')) {
    const inv = await queryAll<{ product_name: string; available: number; safety_stock: number }>(
      `SELECT product_name, available, safety_stock FROM inventory ORDER BY available ASC LIMIT 10`,
    );
    parts.push(`[재고] ${inv.map(i => `${i.product_name}: 가용${i.available}/안전${i.safety_stock}`).join(', ')}`);
  }

  if (q.includes('출고') || q.includes('배송') || q.includes('리드')) {
    const lead = await queryAll<{ product_name_raw: string; avg_days: number }>(
      `SELECT MIN(product_name_raw) as product_name_raw, ROUND(AVG(JULIANDAY(ship_date)-JULIANDAY(sales_date)),1) as avg_days
       FROM order_items WHERE order_status='normal' AND ship_date IS NOT NULL AND ship_date!='' AND sales_date >= ?
       GROUP BY master_sku HAVING COUNT(*)>=3 ORDER BY avg_days DESC LIMIT 10`, d30,
    );
    parts.push(`[리드타임] ${lead.map(l => `${l.product_name_raw}: ${l.avg_days}일`).join(', ')}`);
  }

  // Daily trend always useful
  const daily = await queryAll<{ sales_date: string; orders: number; settlement: number }>(
    `SELECT sales_date, COUNT(*) as orders, SUM(settlement_amount) as settlement
     FROM order_items WHERE order_status='normal' AND sales_date >= ? GROUP BY sales_date ORDER BY sales_date`, d7,
  );
  parts.push(`[7일 추이] ${daily.map(d => `${d.sales_date}: ${d.orders}건/${Math.round(d.settlement/10000)}만원`).join(', ')}`);

  return parts.join('\n');
}

export async function POST(req: NextRequest) {
  const { error } = withAuth();
  if (error) return error;

  const body = await req.json() as { question: string };
  if (!body.question?.trim()) {
    return NextResponse.json({ ok: false, message: '질문을 입력해주세요' }, { status: 400 });
  }

  const context = await getContext(body.question);

  const system = `당신은 일본 주류 수입 이커머스(Momentrix) 데이터 분석 어시스턴트입니다.
마켓: 데일리샷(dailyshot), 키햐(kihya), 드렁큰몽키(dmonkey)
한국어로 간결하게 답변하세요. 숫자는 만원 단위로.
아래 실제 DB 데이터를 기반으로만 답변하고, 모르는 건 모른다고 하세요.`;

  const userMsg = `데이터:\n${context}\n\n질문: ${body.question}`;
  const answer = await callClaude(system, userMsg);

  return NextResponse.json({ ok: true, answer });
}
