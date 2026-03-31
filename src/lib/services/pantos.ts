/**
 * 판토스(유한익스프레스) ExpressWeb Air Inbound API 연동
 * - XML 기반 배송 추적 API
 * - tera / terasub1 두 sender 지원
 */
import { queryAll, queryOne, execute, executeBatch } from '@/lib/db';

// ── Constants ──

const PANTOS = {
  DEV_URL: 'http://testif.expressweb.co.kr',
  PROD_URL: 'http://if.expressweb.co.kr',
  SENDERS: ['tera', 'terasub1'] as const,
  RECEIVER: 'wjil',
  AGENT: 'byljp',
  TRACKING_CODES: {
    ORDA: '오더접수', PICK: '픽업', DWHI: '창고반입', DWHO: '창고반출',
    DEPT: '항공출발', ARRV: '항공도착', AWHI: '장치장반입', AWHO: '장치장반출',
    CLRI: '통관진행', CLRC: '통관완료', DELA: '택배배송중', DELC: '배송완료',
    TACC: '환적접수', TWHI: '환적입고', TWHO: '환적출고', TDEP: '환적출발', TARR: '환적도착',
    TDLA: '환적배송접수', TDLC: '환적배송도착', CLRN: '미통관', DELN: '미배송',
  } as Record<string, string>,
  STAGE_ORDER: ['ORDA', 'PICK', 'DWHI', 'DWHO', 'DEPT', 'ARRV', 'AWHI', 'AWHO', 'CLRI', 'CLRC', 'DELA', 'DELC'],
};

export { PANTOS };

// ── Config ──

interface PantosConfig {
  accessKeys: Record<string, string>;
  env: string;
  kihyaEmail: string;
}

export async function getPantosConfig(): Promise<PantosConfig> {
  const rows = await queryAll<{ key: string; value: string }>(
    "SELECT key, value FROM config_kv WHERE key LIKE 'PANTOS_%' OR key = 'KIHYA_SHIP_EMAIL'",
  );
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;

  return {
    accessKeys: {
      tera: cfg['PANTOS_ACCESS_KEY'] || '',
      terasub1: cfg['PANTOS_ACCESS_KEY_SUB1'] || cfg['PANTOS_ACCESS_KEY'] || '',
    },
    env: cfg['PANTOS_ENV'] || 'prod',
    kihyaEmail: cfg['KIHYA_SHIP_EMAIL'] || 'hg.hur@picknplace.co.kr',
  };
}

function baseUrl(env: string): string {
  return env === 'prod' ? PANTOS.PROD_URL : PANTOS.DEV_URL;
}

// ── XML helpers ──

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getTagText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function getAllBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g');
  return xml.match(re) || [];
}

// ── Tracking API ──

interface TrackingOrder {
  ordId: string;
  hblNo: string;
}

interface TrackingResult {
  ordId: string;
  hblNo: string;
  trackingCode: string;
  trackingDateTime: string;
  trackingRemark: string;
  customs?: {
    deliveryCode: string;
    multiNo: string;
    customsClearance: string;
  };
}

async function queryTracking(
  sender: string,
  orders: TrackingOrder[],
  cfg: PantosConfig,
): Promise<TrackingResult[]> {
  if (!orders.length) return [];

  const url = baseUrl(cfg.env) + '/if/order/selectAIOrderTracking';
  const accessKey = cfg.accessKeys[sender] || '';

  // Build XML
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<root>\n'
    + '<AccessIdentifier>\n'
    + `  <SenderIdentifier>${sender}</SenderIdentifier>\n`
    + `  <ReceiverIdentifier>${PANTOS.RECEIVER}</ReceiverIdentifier>\n`
    + `  <AccessKey>${xmlEsc(accessKey)}</AccessKey>\n`
    + '</AccessIdentifier>\n';

  for (const o of orders) {
    xml += '<OrderTracking>\n'
      + `  <OrdId>${xmlEsc(o.ordId)}</OrdId>\n`
      + `  <HBLNo>${xmlEsc(o.hblNo)}</HBLNo>\n`
      + '</OrderTracking>\n';
  }
  xml += '</root>';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml; charset=UTF-8' },
    body: xml,
  });

  const resText = await res.text();

  // Check ReturnCode
  const returnBlock = getAllBlocks(resText, 'Return')[0] || '';
  const returnCode = getTagText(returnBlock, 'ReturnCode');
  if (returnCode && returnCode !== 'SUCCESS') {
    const msg = getTagText(returnBlock, 'ReturnMessage');
    throw new Error(`Pantos API 오류 (${sender}): ${returnCode} ${msg}`);
  }

  // Parse OrderTracking results
  const results: TrackingResult[] = [];
  const trackBlocks = getAllBlocks(resText, 'OrderTracking');
  for (const block of trackBlocks) {
    results.push({
      ordId: getTagText(block, 'OrdId'),
      hblNo: getTagText(block, 'HBLNo'),
      trackingCode: getTagText(block, 'TrackingCode'),
      trackingDateTime: getTagText(block, 'TrackingDateTime'),
      trackingRemark: getTagText(block, 'TrackingRemark'),
    });
  }

  // Parse CustomsInfo (택배 송장번호)
  const custBlocks = getAllBlocks(resText, 'CustomsInfo');
  const custMap: Record<string, { deliveryCode: string; multiNo: string; customsClearance: string }> = {};
  for (const block of custBlocks) {
    const hbl = getTagText(block, 'HBLNo');
    custMap[hbl] = {
      deliveryCode: getTagText(block, 'DeliveryCode'),
      multiNo: getTagText(block, 'MultiNo'),
      customsClearance: getTagText(block, 'CustomsClearance'),
    };
  }

  // Keep only latest status per HBL
  const latestMap: Record<string, TrackingResult> = {};
  for (const item of results) {
    const key = item.hblNo;
    const stageIdx = PANTOS.STAGE_ORDER.indexOf(item.trackingCode);
    const existing = latestMap[key];
    if (!existing || stageIdx > PANTOS.STAGE_ORDER.indexOf(existing.trackingCode)) {
      latestMap[key] = item;
    }
    if (custMap[key]) {
      latestMap[key].customs = custMap[key];
    }
  }

  return Object.values(latestMap);
}

// ── Refresh tracking (main business logic) ──

export interface RefreshResult {
  ok: boolean;
  updated: number;
  total: number;
  message: string;
  apiErrors?: string[];
}

export async function refreshTracking(): Promise<RefreshResult> {
  const cfg = await getPantosConfig();
  if (!cfg.accessKeys.tera) {
    return { ok: false, updated: 0, total: 0, message: 'PANTOS_ACCESS_KEY가 설정되지 않았습니다.' };
  }

  // tracking_no 있고 delivery_status != DELC이고 pantos_ord_id 있는 건 조회
  const targets = await queryAll<{
    id: number;
    pantos_ord_id: string;
    hawb_no: string;
    tracking_no: string;
    delivery_status: string;
  }>(
    `SELECT id, pantos_ord_id, hawb_no, tracking_no, delivery_status
     FROM order_items
     WHERE tracking_no IS NOT NULL AND tracking_no != ''
       AND pantos_ord_id IS NOT NULL AND pantos_ord_id != ''
       AND (delivery_status IS NULL OR delivery_status != 'DELC')
       AND order_status = 'normal'`,
  );

  if (!targets.length) {
    return { ok: true, updated: 0, total: 0, message: '추적 대상 없음' };
  }

  // Build order list
  const orderList: (TrackingOrder & { id: number })[] = targets.map(t => ({
    id: t.id,
    ordId: t.pantos_ord_id,
    hblNo: t.hawb_no || t.tracking_no,
  }));

  // Query all senders in batches of 200
  const allResults: Record<string, TrackingResult> = {};
  const apiErrors: string[] = [];
  const BATCH_SIZE = 200;

  for (const sender of PANTOS.SENDERS) {
    for (let i = 0; i < orderList.length; i += BATCH_SIZE) {
      const batch = orderList.slice(i, i + BATCH_SIZE);
      try {
        const trackResults = await queryTracking(sender, batch, cfg);
        for (const r of trackResults) {
          allResults[r.hblNo] = r;
        }
      } catch (e) {
        apiErrors.push(`${sender}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Update D1
  const stmts: { sql: string; params: unknown[] }[] = [];
  let updated = 0;

  for (const t of orderList) {
    const result = allResults[t.hblNo];
    if (!result) continue;

    // Only update if status changed
    const target = targets.find(x => x.id === t.id);
    if (target && target.delivery_status !== result.trackingCode) {
      stmts.push({
        sql: `UPDATE order_items SET delivery_status = ?, delivery_status_dt = ?, updated_at = datetime('now')
              WHERE id = ?`,
        params: [result.trackingCode, result.trackingDateTime, t.id],
      });
      updated++;
    }
  }

  // Batch execute (D1 max 100 statements per batch)
  for (let i = 0; i < stmts.length; i += 80) {
    await executeBatch(stmts.slice(i, i + 80));
  }

  return {
    ok: true,
    updated,
    total: targets.length,
    message: `${updated}건 상태 업데이트됨`,
    apiErrors: apiErrors.length ? apiErrors : undefined,
  };
}

// ── Tracking status summary ──

export async function getTrackingStatus() {
  const summary = await queryAll<{ delivery_status: string; cnt: number }>(
    `SELECT COALESCE(delivery_status, 'UNKNOWN') as delivery_status, COUNT(*) as cnt
     FROM order_items
     WHERE tracking_no IS NOT NULL AND tracking_no != ''
       AND pantos_ord_id IS NOT NULL AND pantos_ord_id != ''
       AND order_status = 'normal'
     GROUP BY delivery_status
     ORDER BY cnt DESC`,
  );

  return summary.map(s => ({
    ...s,
    label: PANTOS.TRACKING_CODES[s.delivery_status] || s.delivery_status,
  }));
}
