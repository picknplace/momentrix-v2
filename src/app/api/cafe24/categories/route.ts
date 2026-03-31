/**
 * GET /api/cafe24/categories — List categories from Cafe24
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { cafe24Api } from '@/lib/services/cafe24';

export const runtime = 'edge';

interface Cafe24CategoryList {
  categories: Record<string, unknown>[];
}

export async function GET(req: NextRequest) {
  const { error } = withAuth();
  if (error) return error;

  try {
    const data = await cafe24Api<Cafe24CategoryList>('GET', '/categories');
    return NextResponse.json({ ok: true, categories: data.categories });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
