/**
 * POST /api/email/send — Gmail API로 메일 발송 (첨부파일 포함)
 *
 * Body: { to, cc?, subject, htmlBody, attachment?: { base64, filename, mimeType } }
 *
 * 환경변수: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

async function getAccessToken(env: Record<string, string>): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error('Gmail token refresh failed: ' + (data.error || 'unknown'));
  return data.access_token;
}

function buildMimeMessage(opts: {
  from: string; fromName: string; to: string; cc?: string;
  subject: string; htmlBody: string;
  attachment?: { base64: string; filename: string; mimeType: string };
}): string {
  const boundary = '----=_Part_' + Date.now();
  const lines: string[] = [];

  lines.push(`From: "${opts.fromName}" <${opts.from}>`);
  lines.push(`To: ${opts.to}`);
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  lines.push(`Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(opts.subject)))}?=`);
  lines.push('MIME-Version: 1.0');

  if (opts.attachment) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(btoa(unescape(encodeURIComponent(opts.htmlBody))));
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${opts.attachment.mimeType}; name="${opts.attachment.filename}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-Disposition: attachment; filename="${opts.attachment.filename}"`);
    lines.push('');
    lines.push(opts.attachment.base64);
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(btoa(unescape(encodeURIComponent(opts.htmlBody))));
  }

  return lines.join('\r\n');
}

export async function POST(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const { env } = getRequestContext();
  const e = env as Record<string, string>;

  if (!e.GMAIL_CLIENT_ID || !e.GMAIL_CLIENT_SECRET || !e.GMAIL_REFRESH_TOKEN) {
    return NextResponse.json({ ok: false, message: 'Gmail API 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  }

  const body = await req.json();
  const { to, cc, subject, htmlBody, attachment } = body as {
    to: string; cc?: string; subject: string; htmlBody: string;
    attachment?: { base64: string; filename: string; mimeType: string };
  };

  if (!to || !subject || !htmlBody) {
    return NextResponse.json({ ok: false, message: '필수 항목 누락 (to, subject, htmlBody)' }, { status: 400 });
  }

  try {
    const accessToken = await getAccessToken(e);

    const fromEmail = e.GMAIL_FROM_EMAIL || 'cs@picknplace.co.kr';
    const fromName = e.GMAIL_FROM_NAME || 'TERA CORPORATION';

    const mimeMessage = buildMimeMessage({ from: fromEmail, fromName, to, cc, subject, htmlBody, attachment });

    // URL-safe base64 encode
    const raw = btoa(unescape(encodeURIComponent(mimeMessage)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ ok: false, message: `Gmail 발송 실패: ${res.status} ${err.substring(0, 300)}` });
    }

    const result = await res.json() as { id: string };
    return NextResponse.json({ ok: true, message: `메일 발송 완료 (${to})`, messageId: result.id });
  } catch (err) {
    return NextResponse.json({ ok: false, message: `오류: ${(err as Error).message}` });
  }
}
