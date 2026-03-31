/**
 * Client-side API wrapper — replaces google.script.run.serverXxx()
 * Automatically includes auth headers and handles auth errors.
 */

type ApiResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; message?: string; authError?: boolean };

export async function api<T = unknown>(
  endpoint: string,
  body?: unknown
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });

    const data = await res.json();

    if (data.authError) {
      window.location.href = '/login';
      return { ok: false, error: '세션 만료', authError: true };
    }

    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '네트워크 오류' };
  }
}
