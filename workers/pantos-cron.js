// Cloudflare Worker — Pantos Tracking Cron
// Calls the Pages cron endpoint every 2 hours.
// Required secret: CRON_SECRET (must match the Pages project value)

const TARGET_URL = 'https://momentrix-v2.pages.dev/api/pantos/cron';

export default {
  /**
   * Scheduled handler — invoked by Cloudflare Cron Trigger
   */
  async scheduled(event, env, ctx) {
    const secret = env.CRON_SECRET;
    if (!secret) {
      console.error('CRON_SECRET is not configured');
      return;
    }

    const res = await fetch(TARGET_URL, {
      method: 'GET',
      headers: {
        'x-cron-secret': secret,
      },
    });

    const body = await res.text();

    if (!res.ok) {
      console.error(`Pantos cron failed: ${res.status} — ${body}`);
      return;
    }

    console.log(`Pantos cron success: ${body}`);
  },

  /**
   * HTTP handler — allows manual trigger & health check via GET request
   */
  async fetch(request, env) {
    const secret = env.CRON_SECRET;
    if (!secret) {
      return new Response(JSON.stringify({ ok: false, message: 'CRON_SECRET not configured' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    const res = await fetch(TARGET_URL, {
      method: 'GET',
      headers: {
        'x-cron-secret': secret,
      },
    });

    const body = await res.text();

    return new Response(body, {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  },
};
