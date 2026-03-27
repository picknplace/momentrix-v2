import { NextRequest, NextResponse } from 'next/server';
import { createUser } from '@/lib/services/users';
import { writeAuditLog } from '@/lib/services/audit';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { user_id, password, email, name } = await req.json();
    if (!user_id || !password || !email || !name) {
      return NextResponse.json({ ok: false, error: '모든 항목을 입력하세요.' });
    }

    await createUser(user_id, password, email, name, 'operator', 'pending');
    await writeAuditLog(user_id, 'signup', 'users', user_id, null, { email, name });

    return NextResponse.json({ ok: true, message: '가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '오류 발생';
    if (msg.includes('UNIQUE') || msg.includes('duplicate')) {
      return NextResponse.json({ ok: false, error: '이미 존재하는 아이디입니다.' });
    }
    return NextResponse.json({ ok: false, error: msg });
  }
}
