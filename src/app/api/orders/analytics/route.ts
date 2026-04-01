/**
 * GET /api/orders/analytics — 주문 분석 데이터
 * ?period=day|month|year (default: day)
 * ?days=30 (default: 30)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll } from '@/lib/db';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { error } = withAuth();
  if (error) return error;

  const url = new URL(req.url);
  const period = url.searchParams.get('period') || 'day';
  const days = parseInt(url.searchParams.get('days') || '30', 10);

  const now = new Date();
  const from = new Date(now.getTime() - days * 86400000).toISOString().substring(0, 10);

  // Period grouping expression
  let groupExpr: string;
  if (period === 'month') groupExpr = `SUBSTR(sales_date, 1, 7)`;
  else if (period === 'year') groupExpr = `SUBSTR(sales_date, 1, 4)`;
  else groupExpr = `sales_date`;

  const [trend, byMarket, cancelRate, shipStatus, repeatCustomers] = await Promise.all([
    // 1. 주문 추이 (period별)
    queryAll<{ period: string; orders: number; qty: number; settlement: number }>(`
      SELECT ${groupExpr} as period, COUNT(*) as orders, COALESCE(SUM(qty),0) as qty,
             COALESCE(SUM(settlement_amount),0) as settlement
      FROM order_items WHERE order_status='normal' AND sales_date >= ?
      GROUP BY ${groupExpr} ORDER BY period
    `, from),

    // 2. 마켓별 현황
    queryAll<{ market_id: string; orders: number; qty: number; settlement: number; cancelled: number }>(`
      SELECT market_id,
             COUNT(*) as orders,
             COALESCE(SUM(CASE WHEN order_status='normal' THEN qty ELSE 0 END),0) as qty,
             COALESCE(SUM(CASE WHEN order_status='normal' THEN settlement_amount ELSE 0 END),0) as settlement,
             SUM(CASE WHEN order_status='cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM order_items WHERE sales_date >= ?
      GROUP BY market_id
    `, from),

    // 3. 취소율 추이 (일별)
    queryAll<{ period: string; total: number; cancelled: number }>(`
      SELECT ${groupExpr} as period,
             COUNT(*) as total,
             SUM(CASE WHEN order_status='cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM order_items WHERE sales_date >= ?
      GROUP BY ${groupExpr} ORDER BY period
    `, from),

    // 4. 출고현황
    queryAll<{ market_id: string; shipped: number; unshipped: number }>(`
      SELECT market_id,
             SUM(CASE WHEN tracking_no IS NOT NULL AND tracking_no != '' THEN 1 ELSE 0 END) as shipped,
             SUM(CASE WHEN tracking_no IS NULL OR tracking_no = '' THEN 1 ELSE 0 END) as unshipped
      FROM order_items WHERE order_status='normal' AND sales_date >= ?
      GROUP BY market_id
    `, from),

    // 5. 재주문 고객 (recipient_name 또는 customs_id 동일)
    queryAll<{ key_val: string; key_type: string; order_count: number; total_qty: number; total_settlement: number; first_date: string; last_date: string }>(`
      SELECT key_val, key_type, order_count, total_qty, total_settlement, first_date, last_date FROM (
        SELECT recipient_name as key_val, 'name' as key_type,
               COUNT(*) as order_count, SUM(qty) as total_qty, SUM(settlement_amount) as total_settlement,
               MIN(sales_date) as first_date, MAX(sales_date) as last_date
        FROM order_items
        WHERE order_status='normal' AND recipient_name IS NOT NULL AND recipient_name != ''
          AND sales_date >= ?
        GROUP BY recipient_name
        HAVING COUNT(*) >= 2
        UNION ALL
        SELECT customs_id as key_val, 'customs' as key_type,
               COUNT(*) as order_count, SUM(qty) as total_qty, SUM(settlement_amount) as total_settlement,
               MIN(sales_date) as first_date, MAX(sales_date) as last_date
        FROM order_items
        WHERE order_status='normal' AND customs_id IS NOT NULL AND customs_id != ''
          AND recipient_name IS NULL OR recipient_name = ''
          AND sales_date >= ?
        GROUP BY customs_id
        HAVING COUNT(*) >= 2
      ) ORDER BY order_count DESC LIMIT 50
    `, from, from),
  ]);

  return NextResponse.json({ ok: true, trend, byMarket, cancelRate, shipStatus, repeatCustomers });
}
