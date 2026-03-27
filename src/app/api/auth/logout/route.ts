import { NextResponse } from 'next/server';
import { getSessionFromCookie, clearSessionCookie } from '@/lib/services/auth';
import { writeAuditLog } from '@/lib/services/audit';

export const runtime = 'edge';

export async function POST() {
  try {
    const session = await getSessionFromCookie();
    if (session) {
      await writeAuditLog(session.user_id, 'logout', '', '', null, null, '', 'success', '');
    }
    await clearSessionCookie();
  } catch {
    // ignore errors during logout
  }
  return NextResponse.json({ ok: true });
}
