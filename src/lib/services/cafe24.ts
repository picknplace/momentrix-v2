/**
 * Cafe24 Open API integration service
 * - OAuth 2.0 (authorize → callback → token exchange → refresh)
 * - Product CRUD
 * - Category listing
 */
import { getRequestContext } from '@cloudflare/next-on-pages';
import { queryOne, execute } from '@/lib/db';

// ── Env helpers ──

function getCafe24Env() {
  const { env } = getRequestContext();
  const e = env as Record<string, string>;
  return {
    mallId: e.CAFE24_MALL_ID || '',
    clientId: e.CAFE24_CLIENT_ID || '',
    clientSecret: e.CAFE24_CLIENT_SECRET || '',
    redirectUri: e.CAFE24_REDIRECT_URI || '',
  };
}

// ── OAuth ──

const SCOPES = [
  'mall.read_product',
  'mall.write_product',
  'mall.read_category',
  'mall.write_category',
  'mall.read_store',
].join(',');

export function buildAuthUrl(): string {
  const { mallId, clientId, redirectUri } = getCafe24Env();
  const base = `https://${mallId}.cafe24api.com/api/v2/oauth/authorize`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state: crypto.randomUUID().substring(0, 8),
  });
  return `${base}?${params.toString()}`;
}

export async function exchangeToken(code: string) {
  const { mallId, clientId, clientSecret, redirectUri } = getCafe24Env();
  const tokenUrl = `https://${mallId}.cafe24api.com/api/v2/oauth/token`;

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const data = await res.json() as Record<string, unknown>;
  if (!res.ok || data.error) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }

  // Save tokens
  const expiresAt = new Date(Date.now() + (data.expires_in as number) * 1000).toISOString();
  await execute(
    `INSERT OR REPLACE INTO cafe24_tokens (mall_id, access_token, refresh_token, expires_at, scopes, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    mallId,
    data.access_token as string,
    data.refresh_token as string,
    expiresAt,
    (data.scopes as string[])?.join(',') || SCOPES,
  );

  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
    scopes: data.scopes,
  };
}

async function refreshToken(): Promise<string> {
  const { mallId, clientId, clientSecret } = getCafe24Env();

  const row = await queryOne<{ refresh_token: string }>(
    'SELECT refresh_token FROM cafe24_tokens WHERE mall_id = ?',
    mallId,
  );
  if (!row) throw new Error('No stored tokens. Please re-authenticate with Cafe24.');

  const tokenUrl = `https://${mallId}.cafe24api.com/api/v2/oauth/token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    }).toString(),
  });

  const data = await res.json() as Record<string, unknown>;
  if (!res.ok || data.error) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }

  const expiresAt = new Date(Date.now() + (data.expires_in as number) * 1000).toISOString();
  await execute(
    `UPDATE cafe24_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
     WHERE mall_id = ?`,
    data.access_token as string,
    data.refresh_token as string,
    expiresAt,
    mallId,
  );

  return data.access_token as string;
}

export async function getValidToken(): Promise<string> {
  const { mallId } = getCafe24Env();

  const row = await queryOne<{ access_token: string; expires_at: string }>(
    'SELECT access_token, expires_at FROM cafe24_tokens WHERE mall_id = ?',
    mallId,
  );

  if (!row) throw new Error('No stored tokens. Please authenticate with Cafe24 first.');

  // Check if token expires within 5 minutes
  const expiresAt = new Date(row.expires_at).getTime();
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    return refreshToken();
  }

  return row.access_token;
}

// ── API helper ──

export async function cafe24Api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const { mallId } = getCafe24Env();
  const token = await getValidToken();
  const url = `https://${mallId}.cafe24api.com/api/v2/admin${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Cafe24-Api-Version': '2024-06-01',
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    // Token expired during request, refresh and retry once
    await refreshToken();
    return cafe24Api(method, path, body, false);
  }

  const data = await res.json() as T;
  if (!res.ok) {
    throw new Error(`Cafe24 API ${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// ── Connection status ──

export async function getConnectionStatus() {
  const { mallId } = getCafe24Env();
  if (!mallId) return { connected: false, reason: 'CAFE24_MALL_ID not configured' };

  const row = await queryOne<{ access_token: string; expires_at: string }>(
    'SELECT access_token, expires_at FROM cafe24_tokens WHERE mall_id = ?',
    mallId,
  );

  if (!row) return { connected: false, reason: 'Not authenticated' };

  const expired = Date.now() > new Date(row.expires_at).getTime();
  return {
    connected: !expired,
    mallId,
    expiresAt: row.expires_at,
    reason: expired ? 'Token expired — will auto-refresh on next API call' : undefined,
  };
}
