/**
 * Server-side auth helper for API routes.
 * Reads user info from middleware-set headers.
 * Replaces GAS withAuth() pattern.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export interface AuthUser {
  user_id: string;
  role: string;
  name: string;
}

export function getAuthUser(): AuthUser | null {
  const h = headers();
  const userId = h.get('x-user-id');
  if (!userId) return null;
  return {
    user_id: userId,
    role: h.get('x-user-role') || 'operator',
    name: h.get('x-user-name') || userId,
  };
}

export function withAuth(requiredRole?: string) {
  const user = getAuthUser();
  if (!user) {
    return {
      user: null as never,
      error: NextResponse.json(
        { ok: false, authError: true, message: '세션이 만료되었습니다.' },
        { status: 401 }
      ),
    };
  }
  if (requiredRole && user.role !== requiredRole && user.role !== 'admin') {
    return {
      user: null as never,
      error: NextResponse.json(
        { ok: false, message: '권한이 없습니다.' },
        { status: 403 }
      ),
    };
  }
  return { user, error: null };
}
