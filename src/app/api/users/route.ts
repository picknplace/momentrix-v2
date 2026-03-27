import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { getAllUsers, updateUserStatus, updateUserRole, resetUserPassword, createUser } from '@/lib/services/users';
import { writeAuditLog } from '@/lib/services/audit';

export const runtime = 'edge';

export async function GET() {
  const { user, error } = withAuth('admin');
  if (error) return error;

  const users = await getAllUsers();
  return NextResponse.json({ ok: true, users });
}

export async function POST(req: NextRequest) {
  const { user, error } = withAuth('admin');
  if (error) return error;

  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'invite') {
      const { user_id, password, email, name, role } = body;
      if (!user_id || !password || !email || !name) {
        return NextResponse.json({ ok: false, error: '필수 항목을 입력하세요.' });
      }
      await createUser(user_id, password, email, name, role || 'operator', 'active');
      await writeAuditLog(user.user_id, 'invite_user', 'users', user_id, null, { user_id, email, name, role });
      return NextResponse.json({ ok: true });
    }

    if (action === 'update_status') {
      const { target_user_id, status } = body;
      await updateUserStatus(target_user_id, status);
      await writeAuditLog(user.user_id, 'update_user_status', 'users', target_user_id, null, { status });
      return NextResponse.json({ ok: true });
    }

    if (action === 'update_role') {
      const { target_user_id, role } = body;
      await updateUserRole(target_user_id, role);
      await writeAuditLog(user.user_id, 'update_user_role', 'users', target_user_id, null, { role });
      return NextResponse.json({ ok: true });
    }

    if (action === 'reset_password') {
      const { target_user_id, new_password } = body;
      await resetUserPassword(target_user_id, new_password);
      await writeAuditLog(user.user_id, 'reset_password', 'users', target_user_id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: '알 수 없는 액션입니다.' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : '오류 발생' });
  }
}
