/**
 * GET  /api/cafe24/auth — Get auth URL + connection status
 * POST /api/cafe24/auth — Manual token exchange (code)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { buildAuthUrl, exchangeToken, getConnectionStatus } from '@/lib/services/cafe24';

export const runtime = 'edge';

export async function GET() {
  const { error } = withAuth();
  if (error) return error;

  try {
    const status = await getConnectionStatus();
    const authUrl = buildAuthUrl();
    return NextResponse.json({ ok: true, authUrl, ...status });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { error } = withAuth();
  if (error) return error;

  const body = await req.json();
  const code = body.code as string;

  if (!code) {
    return NextResponse.json({ ok: false, message: 'code가 필요합니다.' }, { status: 400 });
  }

  try {
    const result = await exchangeToken(code);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
