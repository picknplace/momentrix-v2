/**
 * POST /api/summary — Regenerate summary tables (daily, market, sku)
 * Equivalent to GAS runSummariesNow()
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, execute, getDB } from '@/lib/db';
import { writeAuditLog } from '@/lib/services/audit';
import { nowKST } from '@/lib/parsers/utils';

export const runtime = 'edge';

export async function POST() {
  const { user, error } = withAuth();
  if (error) return error;

  const now = nowKST();
  const db = getDB();

  // Daily summary
  const dailyRows = await queryAll<{
    sales_date: string; order_count: number; qty_total: number;
    sales_amount_total: number; settlement_amount_total: number;
  }>(
    `SELECT sales_date,
            COUNT(DISTINCT order_id) as order_count,
            SUM(qty) as qty_total,
            SUM(sales_amount - COALESCE(refund_amount, 0)) as sales_amount_total,
            SUM(settlement_amount - COALESCE(refund_amount, 0)) as settlement_amount_total
     FROM order_items
     WHERE order_status IN ('normal', 'refunded')
     GROUP BY sales_date`,
  );

  // Market summary
  const marketRows = await queryAll<{
    market_id: string; order_count: number; qty_total: number;
    sales_amount_total: number; settlement_amount_total: number;
  }>(
    `SELECT market_id,
            COUNT(DISTINCT order_id) as order_count,
            SUM(qty) as qty_total,
            SUM(sales_amount - COALESCE(refund_amount, 0)) as sales_amount_total,
            SUM(settlement_amount - COALESCE(refund_amount, 0)) as settlement_amount_total
     FROM order_items
     WHERE order_status IN ('normal', 'refunded')
     GROUP BY market_id`,
  );

  // SKU summary
  const skuRows = await queryAll<{
    master_sku: string; product_name_raw: string; order_count: number;
    qty_total: number; sales_amount_total: number; settlement_amount_total: number;
  }>(
    `SELECT master_sku, MAX(product_name_raw) as product_name_raw,
            COUNT(DISTINCT order_id) as order_count,
            SUM(qty) as qty_total,
            SUM(sales_amount - COALESCE(refund_amount, 0)) as sales_amount_total,
            SUM(settlement_amount - COALESCE(refund_amount, 0)) as settlement_amount_total
     FROM order_items
     WHERE order_status IN ('normal', 'refunded')
     GROUP BY master_sku`,
  );

  // Clear and rewrite summaries using batch
  await execute('DELETE FROM daily_summary');
  await execute('DELETE FROM market_summary');
  await execute('DELETE FROM sku_summary');

  // Insert daily
  if (dailyRows.length > 0) {
    const stmts = dailyRows.map(r =>
      db.prepare(
        'INSERT INTO daily_summary (sales_date, order_count, qty_total, sales_amount_total, settlement_amount_total, generated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(r.sales_date, r.order_count, r.qty_total, r.sales_amount_total, r.settlement_amount_total, now)
    );
    for (let i = 0; i < stmts.length; i += 50) {
      await db.batch(stmts.slice(i, i + 50));
    }
  }

  // Insert market
  if (marketRows.length > 0) {
    const stmts = marketRows.map(r =>
      db.prepare(
        'INSERT INTO market_summary (market_id, order_count, qty_total, sales_amount_total, settlement_amount_total, generated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(r.market_id, r.order_count, r.qty_total, r.sales_amount_total, r.settlement_amount_total, now)
    );
    await db.batch(stmts);
  }

  // Insert sku
  if (skuRows.length > 0) {
    const stmts = skuRows.map(r =>
      db.prepare(
        'INSERT INTO sku_summary (master_sku, product_name_raw, order_count, qty_total, sales_amount_total, settlement_amount_total, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(r.master_sku, r.product_name_raw, r.order_count, r.qty_total, r.sales_amount_total, r.settlement_amount_total, now)
    );
    for (let i = 0; i < stmts.length; i += 50) {
      await db.batch(stmts.slice(i, i + 50));
    }
  }

  await writeAuditLog(user.user_id, 'run_summaries', 'summary', '', undefined, undefined, undefined, 'success',
    `daily:${dailyRows.length} market:${marketRows.length} sku:${skuRows.length}`);

  return NextResponse.json({
    ok: true,
    message: `요약 생성 완료 (${now})`,
    daily: dailyRows.length,
    market: marketRows.length,
    sku: skuRows.length,
  });
}
