/**
 * GET /api/report — Sales report with cost/margin analysis
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll } from '@/lib/db';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');

  let where = "WHERE oi.order_status = 'normal'";
  const params: unknown[] = [];

  if (dateFrom) { where += ' AND oi.sales_date >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND oi.sales_date <= ?'; params.push(dateTo); }

  // Daily by market
  const daily = await queryAll<{
    sales_date: string; market_id: string;
    order_count: number; qty_total: number;
    sales_total: number; settlement_total: number;
  }>(
    `SELECT oi.sales_date, oi.market_id,
            COUNT(DISTINCT oi.order_id) as order_count,
            SUM(oi.qty) as qty_total,
            SUM(oi.sales_amount - COALESCE(oi.refund_amount, 0)) as sales_total,
            SUM(oi.settlement_amount - COALESCE(oi.refund_amount, 0)) as settlement_total
     FROM order_items oi ${where}
     GROUP BY oi.sales_date, oi.market_id
     ORDER BY oi.sales_date`,
    ...params,
  );

  // Market totals
  const markets = await queryAll<{
    market_id: string; order_count: number; qty_total: number;
    sales_total: number; settlement_total: number;
  }>(
    `SELECT oi.market_id,
            COUNT(DISTINCT oi.order_id) as order_count,
            SUM(oi.qty) as qty_total,
            SUM(oi.sales_amount - COALESCE(oi.refund_amount, 0)) as sales_total,
            SUM(oi.settlement_amount - COALESCE(oi.refund_amount, 0)) as settlement_total
     FROM order_items oi ${where}
     GROUP BY oi.market_id
     ORDER BY settlement_total DESC`,
    ...params,
  );

  // SKU breakdown with cost
  const skus = await queryAll<{
    master_sku: string; product_name_raw: string;
    order_count: number; qty_total: number;
    sales_total: number; settlement_total: number;
    total_cost: number | null;
  }>(
    `SELECT oi.master_sku,
            MAX(oi.product_name_raw) as product_name_raw,
            COUNT(DISTINCT oi.order_id) as order_count,
            SUM(oi.qty) as qty_total,
            SUM(oi.sales_amount - COALESCE(oi.refund_amount, 0)) as sales_total,
            SUM(oi.settlement_amount - COALESCE(oi.refund_amount, 0)) as settlement_total,
            cm.total_cost
     FROM order_items oi
     LEFT JOIN cost_master cm ON oi.master_sku = cm.master_sku
     ${where}
     GROUP BY oi.master_sku
     ORDER BY settlement_total DESC`,
    ...params,
  );

  // Compute margins
  const skuData = skus.map(s => {
    const unitCost = s.total_cost || 0;
    const totalCostCalc = unitCost * s.qty_total;
    const margin = s.settlement_total - totalCostCalc;
    const marginRate = s.settlement_total > 0 ? (margin / s.settlement_total) * 100 : 0;
    return {
      ...s,
      unit_cost: unitCost,
      cost_total: totalCostCalc,
      margin,
      margin_rate: Math.round(marginRate * 10) / 10,
      has_cost: unitCost > 0,
    };
  });

  // Summary
  const totalSales = markets.reduce((s, m) => s + m.sales_total, 0);
  const totalSettl = markets.reduce((s, m) => s + m.settlement_total, 0);
  const totalOrders = markets.reduce((s, m) => s + m.order_count, 0);
  const totalMargin = skuData.filter(s => s.has_cost).reduce((s, sk) => s + sk.margin, 0);
  const hasCostCount = skuData.filter(s => s.has_cost).length;

  return NextResponse.json({
    ok: true,
    daily,
    markets,
    skus: skuData,
    summary: {
      totalSales,
      totalSettl,
      totalOrders,
      totalMargin,
      hasCostCount,
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
    },
    generatedAt: new Date().toISOString(),
  });
}
