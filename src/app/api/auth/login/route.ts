import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { verifyPassword, generateOtp, otpExpiresAt, maskEmail, sendOtpEmail } from '@/lib/services/auth';
import { writeAuditLog } from '@/lib/services/audit';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { user_id, password } = await req.json();
    if (!user_id || !password) {
      return NextResponse.json({ ok: false, error: '아이디와 비밀번호를 입력하세요.' });
    }

    const userId = String(user_id).trim();

    const user = await queryOne<{
      user_id: string; password_hash: string; email: string; name: string; role: string; status: string;
    }>('SELECT user_id, password_hash, email, name, role, status FROM users WHERE user_id = ?', userId);

    if (!user) {
      await writeAuditLog('unknown', 'login_fail', '', '', null, null, '', 'error', 'ID not found: ' + userId);
      return NextResponse.json({ ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    if (user.status === 'pending') {
      return NextResponse.json({ ok: false, error: '승인 대기 중인 계정입니다. 관리자 승인을 기다려주세요.' });
    }
    if (user.status !== 'active') {
      return NextResponse.json({ ok: false, error: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      await writeAuditLog(userId, 'login_fail', '', '', null, null, '', 'error', 'Wrong password');
      return NextResponse.json({ ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    if (!user.email) {
      return NextResponse.json({ ok: false, error: '이메일이 등록되지 않았습니다.' });
    }

    // OTP 생성 및 저장
    const otp = generateOtp();
    await execute(
      'INSERT INTO auth_otp (user_id, otp_code, expires_at) VALUES (?, ?, ?)',
      userId, otp, otpExpiresAt().toISOString()
    );

    // OTP 이메일 발송
    await sendOtpEmail(user.email, otp);

    return NextResponse.json({
      ok: true,
      step: 'otp',
      message: maskEmail(user.email) + '으로 인증코드를 전송했습니다.',
    });
  } catch (e) {
    console.error('Login error:', e);
    return NextResponse.json({ ok: false, error: '로그인 오류가 발생했습니다.' });
  }
}
