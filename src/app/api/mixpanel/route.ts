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

function parseCardResult(raw: unknown, dim: string): unknown {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (dim === 'none') {
    // Single value — first series, last value
    const series = r.series as Record<string, Record<string, number>> | undefined;
    if (series) {
      const firstKey = Object.keys(series)[0];
      if (firstKey) {
        const vals = series[firstKey];
        const dates = Object.keys(vals).sort();
        return dates.length > 0 ? vals[dates[dates.length - 1]] : 0;
      }
    }
    return 0;
  }

  if (dim === 'items') {
    // Breakdown by item
    const series = r.series as Record<string, Record<string, number>> | undefined;
    if (!series) return [];
    return Object.entries(series).map(([name, vals]) => {
      const dates = Object.keys(vals).sort();
      const total = dates.reduce((s, d) => s + (vals[d] || 0), 0);
      return { name, value: total };
    }).sort((a, b) => b.value - a.value);
  }

  if (dim === 'timeseries') {
    // Time series data
    const series = r.series as Record<string, Record<string, number>> | undefined;
    if (!series) return [];
    const firstKey = Object.keys(series)[0];
    if (!firstKey) return [];
    const vals = series[firstKey];
    return Object.entries(vals).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  }

  return raw;
}

async function fetchMixpanelData(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  for (const [cardId, meta] of Object.entries(MIXPANEL_CARDS)) {
    try {
      const res = await fetch('https://mixpanel.com/api/app/public/dashboard-cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://mixpanel.com',
          'Referer': MIXPANEL_BOARD_URL,
        },
        body: JSON.stringify({
          board_uuid: MIXPANEL_BOARD_UUID,
          bookmark_id: Number(cardId),
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

  // Save to cache (two keys: data + timestamp)
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

  return NextResponse.json({ ok: true, data, cached: false, cachedAt: now });
}
