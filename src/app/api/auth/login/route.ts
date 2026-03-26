import { NextRequest, NextResponse } from 'next/server';

// Phase 1: Full implementation with Supabase Auth + OTP
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { user_id, password } = body;

  if (!user_id || !password) {
    return NextResponse.json({ ok: false, error: '아이디와 비밀번호를 입력하세요' });
  }

  // TODO Phase 1: Verify password against users table, send OTP via Resend
  return NextResponse.json({ ok: false, error: 'Phase 1에서 구현 예정' });
}
