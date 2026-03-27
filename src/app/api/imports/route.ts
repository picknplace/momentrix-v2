/**
 * GET /api/imports — List import history
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll } from '@/lib/db';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);

  const rows = await queryAll(
    'SELECT * FROM import_log ORDER BY created_at DESC LIMIT ?',
    limit,
  );

  return NextResponse.json({ ok: true, imports: rows });
}
