import { NextResponse } from 'next/server';

export async function POST() {
  // TODO Phase 1: Clear session cookie
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('session');
  return res;
}
