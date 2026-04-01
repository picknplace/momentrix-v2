/**
 * GET /api/mixpanel — Fetch Mixpanel public dashboard data with D1 caching (1 day)
 * Replicates GAS serverGetMixpanelStats()
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryOne, execute } from '@/lib/db';

export const runtime = 'edge';

const MIXPANEL_BOARD_URL = 'https://mixpanel.com/public/4JpATqU6VGAku8dPbst2p7';
const MIXPANEL_BOARD_UUID = '1ac82019-ccf6-44a1-950f-006bf25870a8';

const MIXPANEL_CARDS: Record<number, { name: string; dim: string }> = {
  66838196: { name: '어제_결제건수', dim: 'none' },
  66838180: { name: '어제_결제금액', dim: 'none' },
  66838192: { name: '이번달_결제건수', dim: 'none' },
  66838184: { name: '이번달_결제금액', dim: 'none' },
  66838172: { name: '어제_품목별_금액', dim: 'items' },
  66838176: { name: '어제_품목별_판매량', dim: 'items' },
  66838168: { name: '이번달_품목별_금액', dim: 'items' },
  66838164: { name: '이번달_품목별_판매량', dim: 'items' },
  66838160: { name: '어제_주종별_판매량', dim: 'items' },
  66838156: { name: '이번달_주종별_판매량', dim: 'items' },
  66838152: { name: '요일별_판매량', dim: 'items' },
  66838148: { name: '재입고_3개월', dim: 'items' },
  66838144: { name: '추이_건수', dim: 'timeseries' },
  66838188: { name: '추이_금액', dim: 'timeseries' },
};

// GAS-identical parsing: response is { results: { series: {...}, date_range: {...} } }
function parseCardResult(raw: unknown, dim: string): unknown {
  if (!raw || typeof raw !== 'object') return null;
  const wrapper = raw as Record<string, unknown>;
  const results = wrapper.results as Record<string, unknown> | undefined;
  if (!results) return null;
  const series = results.series as Record<string, Record<string, number>> | undefined;
  if (!series) return null;

  if (dim === 'none') {
    // Scalar — series[key]['all']
    const firstKey = Object.keys(series)[0];
    if (!firstKey) return 0;
    return series[firstKey]['all'] ?? 0;
  }

  if (dim === 'timeseries') {
    // Time series — series[key] without 'all', sorted by date
    const firstKey = Object.keys(series)[0];
    if (!firstKey) return [];
    const vals = series[firstKey];
    return Object.entries(vals)
      .filter(([k]) => k !== 'all')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  }

  // dim === 'items' (default) — all keys except '$overall'/'Formula', sorted desc, top 15
  return Object.entries(series)
    .filter(([name]) => name !== '$overall' && name !== 'Formula')
    .map(([name, vals]) => ({ name, value: vals['all'] ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);
}

async function fetchMixpanelData(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  for (const [cardId, meta] of Object.entries(MIXPANEL_CARDS)) {
    try {
      const res = await fetch('https://mixpanel.com/api/app/public/dashboard-cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'Origin': 'https://mixpanel.com',
          'Referer': MIXPANEL_BOARD_URL,
        },
        body: JSON.stringify({
          uuid: MIXPANEL_BOARD_UUID,
          bookmark_id: Number(cardId),
          endpoint: 'insights',
          query_origin: 'dashboard_public',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        results[meta.name] = parseCardResult(data, meta.dim);
      } else {
        results[meta.name] = null;
      }
    } catch {
      results[meta.name] = null;
    }
  }

  return results;
}

export async function GET(req: NextRequest) {
  const { error } = withAuth();
  if (error) return error;

  const forceRefresh = new URL(req.url).searchParams.get('refresh') === '1';

  // Check cache — we store JSON as value, and timestamp in a separate key
  if (!forceRefresh) {
    try {
      const cached = await queryOne<{ value: string }>(
        `SELECT value FROM config_kv WHERE key = 'mixpanel_cache'`
      );
      const cachedAt = await queryOne<{ value: string }>(
        `SELECT value FROM config_kv WHERE key = 'mixpanel_cache_at'`
      );
      if (cached && cachedAt) {
        const cacheAge = Date.now() - new Date(cachedAt.value).getTime();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        if (cacheAge < ONE_DAY) {
          return NextResponse.json({
            ok: true,
            data: JSON.parse(cached.value),
            cached: true,
            cachedAt: cachedAt.value,
          });
        }
      }
    } catch {
      // config_kv might not exist yet — continue to fetch
    }
  }

  // Fetch fresh data from Mixpanel
  const data = await fetchMixpanelData();
  const now = new Date().toISOString();

  // Only cache if we got actual data (not all null)
  const hasData = Object.values(data).some(v => v !== null);
  if (hasData) {
    try {
      await execute(
        `INSERT OR REPLACE INTO config_kv (key, value) VALUES ('mixpanel_cache', ?)`,
        JSON.stringify(data),
      );
      await execute(
        `INSERT OR REPLACE INTO config_kv (key, value) VALUES ('mixpanel_cache_at', ?)`,
        now,
      );
    } catch {
      // Cache write failure is non-fatal
    }
  }

  return NextResponse.json({ ok: true, data, cached: false, cachedAt: now });
}
