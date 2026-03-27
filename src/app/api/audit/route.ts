import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { queryAll, queryCount } from '@/lib/db';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { error } = withAuth('admin');
  if (error) return error;

  const url = req.nextUrl;
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    queryAll(
      'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ? OFFSET ?',
      limit, offset
    ),
    queryCount('SELECT COUNT(*) as cnt FROM audit_log'),
  ]);

  return NextResponse.json({
    ok: true,
    logs,
    total,
    page,
    pageSize: limit,
  });
}
