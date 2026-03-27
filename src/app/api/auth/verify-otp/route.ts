import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { createSessionToken, setSessionCookie } from '@/lib/services/auth';
import { writeAuditLog } from '@/lib/services/audit';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { user_id, otp_code } = await req.json();
    if (!user_id || !otp_code) {
      return NextResponse.json({ ok: false, error: '인증코드를 입력하세요.' });
    }

    const userId = String(user_id).trim();
    const otp = String(otp_code).trim();
    const now = new Date().toISOString();

    // 최신 유효 OTP 조회
    const otpRow = await queryOne<{ id: number; otp_code: string }>(
      `SELECT id, otp_code FROM auth_otp
       WHERE user_id = ? AND verified = 0 AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      userId, now
    );

    if (!otpRow) {
      return NextResponse.json({ ok: false, error: '인증코드가 만료되었습니다. 다시 로그인하세요.' });
    }

    if (otpRow.otp_code !== otp) {
      return NextResponse.json({ ok: false, error: '인증코드가 올바르지 않습니다.' });
    }

    // OTP 사용 처리
    await execute('UPDATE auth_otp SET verified = 1 WHERE id = ?', otpRow.id);

    // 사용자 정보 조회
    const user = await queryOne<{ user_id: string; role: string; name: string }>(
      'SELECT user_id, role, name FROM users WHERE user_id = ?',
      userId
    );

    if (!user) {
      return NextResponse.json({ ok: false, error: '사용자를 찾을 수 없습니다.' });
    }

    // 세션 토큰 생성 및 쿠키 설정
    const token = await createSessionToken({
      user_id: user.user_id,
      role: user.role,
      name: user.name,
    });
    await setSessionCookie(token);

    // last_login 업데이트
    await execute("UPDATE users SET last_login = datetime('now') WHERE user_id = ?", userId);

    // 감사 로그
    await writeAuditLog(userId, 'login', '', '', null, null, '', 'success', '');

    return NextResponse.json({
      ok: true,
      user: { user_id: user.user_id, role: user.role, name: user.name },
    });
  } catch (e) {
    console.error('OTP verify error:', e);
    return NextResponse.json({ ok: false, error: 'OTP 확인 오류가 발생했습니다.' });
  }
}
