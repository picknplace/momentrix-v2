import { NextResponse } from 'next/server';
import { getSessionFromCookie } from '@/lib/services/auth';

export const runtime = 'edge';

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json({ ok: false, authError: true });
  }
  return NextResponse.json({ ok: true, user: session });
}
