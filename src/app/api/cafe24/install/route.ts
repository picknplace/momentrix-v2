/**
 * GET /api/cafe24/install — Public app install entry point for Cafe24 App Store
 *
 * When a merchant installs the app from https://store.cafe24.com,
 * Cafe24 redirects to this URL with ?mall_id=<their_mall_id>.
 * This endpoint builds the OAuth authorize URL and redirects (302).
 *
 * NO authentication required — this is the first touchpoint from Cafe24.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/services/cafe24';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mallId = url.searchParams.get('mall_id');

  if (!mallId) {
    return NextResponse.json(
      { ok: false, message: 'mall_id 파라미터가 필요합니다.' },
      { status: 400 },
    );
  }

  const authUrl = buildAuthUrl(mallId);
  return NextResponse.redirect(authUrl, 302);
}
