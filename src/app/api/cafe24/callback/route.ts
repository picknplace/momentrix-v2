/**
 * GET /api/cafe24/callback — OAuth callback from Cafe24
 *
 * Cafe24 redirects here after user authorizes the app.
 * Exchanges authorization code for access/refresh tokens.
 * This endpoint is PUBLIC (no JWT required) — Cafe24 심사 requires automatic completion.
 */
import { NextRequest, NextResponse } from 'next/server';
import { exchangeToken } from '@/lib/services/cafe24';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');  // mall_id passed via state

  if (error) {
    return new NextResponse(renderHtml(false, `인증 거부: ${error}`), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!code) {
    return new NextResponse(renderHtml(false, 'Authorization code가 없습니다.'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const result = await exchangeToken(code, state || undefined);
    return new NextResponse(
      renderHtml(true, `Cafe24 연동 완료! (scopes: ${Array.isArray(result.scopes) ? result.scopes.join(', ') : result.scopes})`),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(renderHtml(false, msg), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

function renderHtml(success: boolean, message: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>Cafe24 OAuth</title>
<style>
body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
.card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
.icon { font-size: 48px; margin-bottom: 16px; }
h2 { margin: 0 0 12px; }
p { color: #666; margin: 0; word-break: break-all; }
</style></head>
<body>
<div class="card">
  <div class="icon">${success ? '✅' : '❌'}</div>
  <h2>${success ? '연동 성공' : '연동 실패'}</h2>
  <p>${message}</p>
</div>
<script>
// Notify opener (Momentrix dashboard) if opened as popup
if (window.opener) {
  window.opener.postMessage({ type: 'cafe24_oauth_complete', success: ${success} }, '*');
  setTimeout(() => window.close(), 2000);
}
</script>
</body></html>`;
}
