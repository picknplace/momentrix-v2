/**
 * GET /api/dashboard — Dashboard KPIs and aggregations
 * Replaces GAS getDashboardData() — uses SQL GROUP BY instead of full-table scan
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, queryOne } from '@/lib/db';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');

  let where = "WHERE order_status = 'normal'";
  const params: unknown[] = [];
  if (dateFrom) { where += ' AND sales_date >= ?'; params.push(dateFrom); }
  if (dateTo)   { where += ' AND sales_date <= ?'; params.push(dateTo); }

  // KPI totals
  const kpi = await queryOne<{
    total_orders: number;
    total_qty: number;
    total_sales: number;
    total_settlement: number;
  }>(
    `SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(qty), 0) as total_qty,
      COALESCE(SUM(sales_amount), 0) as total_sales,
      COALESCE(SUM(settlement_amount), 0) as total_settlement
    FROM order_items ${where}`,
    ...params,
  );

  // Daily trend
  const daily = await queryAll<{
    sales_date: string;
    order_count: number;
    qty_total: number;
    sales_total: number;
    settlement_total: number;
  }>(
    `SELECT
      sales_date,
      COUNT(*) as order_count,
      SUM(qty) as qty_total,
      SUM(sales_amount) as sales_total,
      SUM(settlement_amount) as settlement_total
    FROM order_items ${where}
    GROUP BY sales_date ORDER BY sales_date`,
    ...params,
  );

  // By market
  const byMarket = await queryAll<{
    market_id: string;
    order_count: number;
    qty_total: number;
    sales_total: number;
    settlement_total: number;
  }>(
    `SELECT
      market_id,
      COUNT(*) as order_count,
      SUM(qty) as qty_total,
      SUM(sales_amount) as sales_total,
      SUM(settlement_amount) as settlement_total
    FROM order_items ${where}
    GROUP BY market_id`,
    ...params,
  );

  // Top SKUs
  const topSkus = await queryAll<{
    master_sku: string;
    product_name_raw: string;
    qty_total: number;
    settlement_total: number;
  }>(
    `SELECT
      master_sku,
      MIN(product_name_raw) as product_name_raw,
      SUM(qty) as qty_total,
      SUM(settlement_amount) as settlement_total
    FROM order_items ${where}
    GROUP BY master_sku ORDER BY qty_total DESC LIMIT 20`,
    ...params,
  );

  // Unshipped count
  const unshipped = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM order_items WHERE order_status = 'normal' AND (tracking_no IS NULL OR tracking_no = '')`,
  );

  return NextResponse.json({
    ok: true,
    kpi: {
      totalOrders: kpi?.total_orders ?? 0,
      totalQty: kpi?.total_qty ?? 0,
      totalSales: kpi?.total_sales ?? 0,
      totalSettlement: kpi?.total_settlement ?? 0,
      unshippedCount: unshipped?.cnt ?? 0,
    },
    daily,
    byMarket,
    topSkus,
  });
}
