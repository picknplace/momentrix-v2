import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SESSION_COOKIE = 'mx_session';
const SESSION_TTL = 6 * 60 * 60; // 6 hours in seconds

function getJwtSecret() {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  return new TextEncoder().encode(secret);
}

// ── Password hashing (compatible with GAS format: salt:hex) ──
// Uses Web Crypto API (works in Edge/Workers runtime)

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(plain: string, salt?: string): Promise<string> {
  if (!salt) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    salt = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const hex = await sha256hex(salt + plain);
  return salt + ':' + hex;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const salt = stored.split(':')[0];
  const rehashed = await hashPassword(plain, salt);
  return rehashed === stored;
}

// ── OTP ──

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function otpExpiresAt(): Date {
  return new Date(Date.now() + 5 * 60 * 1000);
}

// ── Session (JWT in httpOnly cookie) ──

export interface SessionPayload {
  user_id: string;
  role: string;
  name: string;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return {
      user_id: payload.user_id as string,
      role: payload.role as string,
      name: payload.name as string,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL,
    path: '/',
  });
}

export async function getSessionFromCookie(): Promise<SessionPayload | null> {
  const cookieStore = cookies();
  const cookie = cookieStore.get(SESSION_COOKIE);
  if (!cookie?.value) return null;
  return verifySessionToken(cookie.value);
}

export async function clearSessionCookie() {
  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE, '', { maxAge: 0, path: '/' });
}

// ── Email masking ──

export function maskEmail(email: string): string {
  return email.replace(/(.{2}).*(@.*)/, '$1***$2');
}

// ── Send OTP email via Resend REST API (no SDK, edge-compatible) ──

export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.startsWith('re_your')) {
    console.log(`[DEV] OTP for ${to}: ${otp}`);
    return;
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Momentrix <noreply@momentrix.kr>',
      to,
      subject: '[Momentrix] 인증코드',
      text: `인증코드: ${otp}\n\n5분 이내에 입력해주세요.\n요청하지 않은 경우 무시하세요.`,
    }),
  });
}
