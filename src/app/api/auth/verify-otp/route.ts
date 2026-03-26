import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { user_id, otp_code } = body;

  if (!user_id || !otp_code) {
    return NextResponse.json({ ok: false, error: '인증번호를 입력하세요' });
  }

  // TODO Phase 1: Verify OTP, create session cookie
  return NextResponse.json({ ok: false, error: 'Phase 1에서 구현 예정' });
}
