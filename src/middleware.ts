import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE = 'mx_session';

const publicPaths = ['/login', '/api/auth/login', '/api/auth/verify-otp'];

function getJwtSecret() {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  return new TextEncoder().encode(secret);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths — no auth required
  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Static files and Next.js internals
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    // API routes return JSON error
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ ok: false, authError: true, message: '세션이 만료되었습니다.' }, { status: 401 });
    }
    // Pages redirect to login
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // Attach user info to headers for downstream use
    const res = NextResponse.next();
    res.headers.set('x-user-id', payload.user_id as string);
    res.headers.set('x-user-role', payload.role as string);
    res.headers.set('x-user-name', payload.name as string);
    return res;
  } catch {
    // Invalid/expired token
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ ok: false, authError: true, message: '세션이 만료되었습니다.' }, { status: 401 });
    }
    const res = NextResponse.redirect(new URL('/login', req.url));
    res.cookies.set(SESSION_COOKIE, '', { maxAge: 0, path: '/' });
    return res;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
