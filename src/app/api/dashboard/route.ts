/**
 * GET /api/dashboard — Dashboard KPIs, charts, and aggregations
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

  // Run all queries in parallel
  const [kpi, daily, dailyByMarket, byMarket, topSkus, unshipped, cancelStats, shippedDaily] = await Promise.all([
    // KPI totals
    queryOne<{
      total_orders: number; total_qty: number;
      total_sales: number; total_settlement: number;
      total_skus: number;
    }>(
      `SELECT COUNT(*) as total_orders, COALESCE(SUM(qty),0) as total_qty,
              COALESCE(SUM(sales_amount),0) as total_sales,
              COALESCE(SUM(settlement_amount),0) as total_settlement,
              COUNT(DISTINCT master_sku) as total_skus
       FROM order_items ${where}`,
      ...params,
    ),

    // Daily trend (total)
    queryAll<{
      sales_date: string; order_count: number; qty_total: number;
      sales_total: number; settlement_total: number;
    }>(
      `SELECT sales_date, COUNT(*) as order_count, SUM(qty) as qty_total,
              SUM(sales_amount) as sales_total, SUM(settlement_amount) as settlement_total
       FROM order_items ${where}
       GROUP BY sales_date ORDER BY sales_date`,
      ...params,
    ),

    // Daily trend by market (for line chart)
    queryAll<{
      sales_date: string; market_id: string; settlement_total: number;
    }>(
      `SELECT sales_date, market_id, SUM(settlement_amount) as settlement_total
       FROM order_items ${where}
       GROUP BY sales_date, market_id ORDER BY sales_date`,
      ...params,
    ),

    // By market
    queryAll<{
      market_id: string; order_count: number; qty_total: number;
      sales_total: number; settlement_total: number;
    }>(
      `SELECT market_id, COUNT(*) as order_count, SUM(qty) as qty_total,
              SUM(sales_amount) as sales_total, SUM(settlement_amount) as settlement_total
       FROM order_items ${where}
       GROUP BY market_id`,
      ...params,
    ),

    // Top 10 SKUs by settlement
    queryAll<{
      master_sku: string; product_name_raw: string;
      qty_total: number; settlement_total: number; order_count: number;
    }>(
      `SELECT master_sku, MIN(product_name_raw) as product_name_raw,
              SUM(qty) as qty_total, SUM(settlement_amount) as settlement_total,
              COUNT(*) as order_count
       FROM order_items ${where}
       GROUP BY master_sku ORDER BY settlement_total DESC LIMIT 10`,
      ...params,
    ),

    // Unshipped count
    queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM order_items WHERE order_status = 'normal' AND (tracking_no IS NULL OR tracking_no = '')`,
    ),

    // Cancel stats
    queryOne<{
      cancel_count: number; cancel_amount: number;
      total_for_rate: number;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM order_items WHERE order_status = 'cancelled' ${dateFrom ? "AND sales_date >= '" + dateFrom + "'" : ''} ${dateTo ? "AND sales_date <= '" + dateTo + "'" : ''}) as cancel_count,
        (SELECT COALESCE(SUM(settlement_amount),0) FROM order_items WHERE order_status = 'cancelled' ${dateFrom ? "AND sales_date >= '" + dateFrom + "'" : ''} ${dateTo ? "AND sales_date <= '" + dateTo + "'" : ''}) as cancel_amount,
        (SELECT COUNT(*) FROM order_items WHERE 1=1 ${dateFrom ? "AND sales_date >= '" + dateFrom + "'" : ''} ${dateTo ? "AND sales_date <= '" + dateTo + "'" : ''}) as total_for_rate`,
    ),

    // Daily shipment volume
    queryAll<{ ship_date: string; shipped_qty: number; shipped_count: number }>(
      `SELECT ship_date, SUM(qty) as shipped_qty, COUNT(*) as shipped_count
       FROM order_items
       WHERE order_status = 'normal' AND ship_date IS NOT NULL AND ship_date != ''
       ${dateFrom ? "AND ship_date >= '" + dateFrom + "'" : ''}
       ${dateTo ? "AND ship_date <= '" + dateTo + "'" : ''}
       GROUP BY ship_date ORDER BY ship_date`,
    ),
  ]);

  // Compute derived KPIs
  const totalOrders = kpi?.total_orders ?? 0;
  const totalSettlement = kpi?.total_settlement ?? 0;
  const numDays = daily.length || 1;
  const avgDailySettlement = Math.round(totalSettlement / numDays);
  const topMarket = byMarket.length > 0
    ? byMarket.reduce((a, b) => a.settlement_total > b.settlement_total ? a : b)
    : null;

  const shippedCount = totalOrders - (unshipped?.cnt ?? 0);
  const cancelCount = cancelStats?.cancel_count ?? 0;
  const cancelAmount = cancelStats?.cancel_amount ?? 0;
  const totalForRate = cancelStats?.total_for_rate ?? 1;
  const cancelRate = totalForRate > 0 ? Math.round((cancelCount / totalForRate) * 1000) / 10 : 0;

  return NextResponse.json({
    ok: true,
    kpi: {
      totalOrders,
      totalQty: kpi?.total_qty ?? 0,
      totalSales: kpi?.total_sales ?? 0,
      totalSettlement,
      totalSkus: kpi?.total_skus ?? 0,
      unshippedCount: unshipped?.cnt ?? 0,
      shippedCount,
      avgDailySettlement,
      topMarket: topMarket ? topMarket.market_id : '',
      topMarketSettlement: topMarket ? topMarket.settlement_total : 0,
      cancelCount,
      cancelAmount,
      cancelRate,
    },
    daily,
    dailyByMarket,
    byMarket,
    topSkus,
    shippedDaily,
  });
}
