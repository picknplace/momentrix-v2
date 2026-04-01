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

  let groupExpr: string;
  if (period === 'month') groupExpr = `SUBSTR(sales_date, 1, 7)`;
  else if (period === 'year') groupExpr = `SUBSTR(sales_date, 1, 4)`;
  else groupExpr = `SUBSTR(sales_date, 1, 10)`;

  const [trend, byMarket, cancelRate, shipStatus, repeatCustomers, repeatOrders, customerProfile] = await Promise.all([
    // 1. 주문 추이
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

    // 3. 취소율 추이
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

    // 5. 재주문 고객 (통관고유부호 기반)
    queryAll<{ customs_id: string; recipient_name: string; order_count: number; total_qty: number; total_settlement: number; first_date: string; last_date: string; markets: string; cancelled: number; avg_amount: number }>(`
      SELECT customs_id, MIN(recipient_name) as recipient_name,
             COUNT(CASE WHEN order_status='normal' THEN 1 END) as order_count,
             COALESCE(SUM(CASE WHEN order_status='normal' THEN qty ELSE 0 END),0) as total_qty,
             COALESCE(SUM(CASE WHEN order_status='normal' THEN settlement_amount ELSE 0 END),0) as total_settlement,
             MIN(sales_date) as first_date, MAX(sales_date) as last_date,
             GROUP_CONCAT(DISTINCT market_id) as markets,
             SUM(CASE WHEN order_status='cancelled' THEN 1 ELSE 0 END) as cancelled,
             ROUND(COALESCE(SUM(CASE WHEN order_status='normal' THEN settlement_amount ELSE 0 END),0) * 1.0
               / MAX(COUNT(CASE WHEN order_status='normal' THEN 1 END), 1)) as avg_amount
      FROM order_items
      WHERE customs_id IS NOT NULL AND customs_id != '' AND sales_date >= ?
      GROUP BY customs_id
      HAVING COUNT(CASE WHEN order_status='normal' THEN 1 END) >= 2
      ORDER BY order_count DESC LIMIT 50
    `, from),

    // 6. 재주문 고객 주문 흐름 (플랫폼 이동 추적)
    queryAll<{ customs_id: string; market_id: string; sales_date: string }>(`
      SELECT customs_id, market_id, sales_date
      FROM order_items
      WHERE order_status='normal' AND customs_id IS NOT NULL AND customs_id != '' AND sales_date >= ?
      ORDER BY customs_id, sales_date
    `, from),

    // 7. 고객 성향 프로필 (통관부호 기반)
    queryAll<{ customs_id: string; top_sku: string; top_product: string; sku_count: number; avg_qty: number; reorder_days: number }>(`
      SELECT customs_id,
             (SELECT master_sku FROM order_items oi2
              WHERE oi2.customs_id = oi.customs_id AND oi2.order_status='normal' AND oi2.sales_date >= ?
              GROUP BY master_sku ORDER BY SUM(qty) DESC LIMIT 1) as top_sku,
             (SELECT MIN(product_name_raw) FROM order_items oi3
              WHERE oi3.customs_id = oi.customs_id AND oi3.order_status='normal' AND oi3.sales_date >= ?
              AND oi3.master_sku = (
                SELECT master_sku FROM order_items oi4
                WHERE oi4.customs_id = oi.customs_id AND oi4.order_status='normal' AND oi4.sales_date >= ?
                GROUP BY master_sku ORDER BY SUM(qty) DESC LIMIT 1
              ) LIMIT 1) as top_product,
             COUNT(DISTINCT master_sku) as sku_count,
             ROUND(CAST(SUM(CASE WHEN order_status='normal' THEN qty ELSE 0 END) AS FLOAT)
               / MAX(COUNT(CASE WHEN order_status='normal' THEN 1 END), 1), 1) as avg_qty,
             CASE WHEN COUNT(CASE WHEN order_status='normal' THEN 1 END) >= 2
               THEN ROUND((JULIANDAY(MAX(sales_date)) - JULIANDAY(MIN(sales_date)))
                 / (COUNT(CASE WHEN order_status='normal' THEN 1 END) - 1), 0)
               ELSE 0 END as reorder_days
      FROM order_items oi
      WHERE customs_id IS NOT NULL AND customs_id != '' AND sales_date >= ?
      GROUP BY customs_id
      HAVING COUNT(CASE WHEN order_status='normal' THEN 1 END) >= 2
    `, from, from, from, from),
  ]);

  return NextResponse.json({ ok: true, trend, byMarket, cancelRate, shipStatus, repeatCustomers, repeatOrders, customerProfile });
}
