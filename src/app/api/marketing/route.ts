/**
 * POST /api/marketing — Marketing AI operations
 *
 * Actions: trend_scan, match, dm_draft, suggest_themes, supplier_recommend,
 *          price_check, save_products, get_inventory, get_history, load_run
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { writeAuditLog } from '@/lib/services/audit';
import {
  trendScan, matchTrends, dmDraft, suggestThemes, supplierRecommend,
  priceCheck, getHistory, loadRun, getInventory, saveProductList,
} from '@/lib/services/marketing';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const body = await req.json();
  const action = body.action as string;

  try {
    switch (action) {
      case 'trend_scan': {
        const result = await trendScan(body.filters || {}, user.user_id);
        await writeAuditLog(user.user_id, 'mkt_trend_scan', 'mkt_trends', result.runId || '', undefined, undefined, undefined, 'success');
        return NextResponse.json(result);
      }

      case 'match': {
        const result = await matchTrends(body.run_id, user.user_id);
        await writeAuditLog(user.user_id, 'mkt_match', 'mkt_matches', body.run_id, undefined, undefined, undefined, 'success');
        return NextResponse.json(result);
      }

      case 'dm_draft': {
        const result = await dmDraft(body.run_id, body.filters || {}, user.user_id);
        await writeAuditLog(user.user_id, 'mkt_dm_draft', 'mkt_dm_drafts', body.run_id, undefined, undefined, undefined, 'success');
        return NextResponse.json(result);
      }

      case 'suggest_themes': {
        const result = await suggestThemes(user.user_id);
        return NextResponse.json(result);
      }

      case 'supplier_recommend': {
        const result = await supplierRecommend(
          body.brief, body.maxResults || 10, body.supplierFilter || '', user.user_id,
        );
        return NextResponse.json(result);
      }

      case 'price_check': {
        const result = await priceCheck(body.run_id || 'MKT_PRICE', body.products || [], user.user_id);
        return NextResponse.json(result);
      }

      case 'save_products': {
        const count = await saveProductList(body.items || [], user.user_id);
        return NextResponse.json({ ok: true, saved: count });
      }

      case 'get_inventory': {
        const inv = await getInventory();
        return NextResponse.json({ ok: true, items: inv.all, ownCount: inv.own.length, platformCount: inv.platform.length });
      }

      case 'get_history': {
        const runs = await getHistory(body.limit || 20);
        return NextResponse.json({ ok: true, runs });
      }

      case 'load_run': {
        if (!body.run_id) return NextResponse.json({ ok: false, message: 'run_id 필요' }, { status: 400 });
        const data = await loadRun(body.run_id);
        return NextResponse.json({ ok: true, ...data });
      }

      default:
        return NextResponse.json({ ok: false, message: `알 수 없는 action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
