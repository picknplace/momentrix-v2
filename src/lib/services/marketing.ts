/**
 * Marketing service — AI 트렌드 분석, 매칭, DM 드래프트, 기획전 추천, 가격 체크
 * Migrated from GAS serverMkt* functions
 */
import { queryAll, execute, executeBatch } from '@/lib/db';
import { callClaude, extractJson } from '@/lib/services/claude';

function generateRunId(): string {
  return 'MKT_' + crypto.randomUUID().replace(/-/g, '').substring(0, 12);
}

// ── Product list helpers ──

export async function getInventory(): Promise<{ own: string[]; platform: string[]; all: string[] }> {
  const own: string[] = [];
  const platform: string[] = [];

  // MKT_PRODUCTS (자사몰 상품)
  const mktRows = await queryAll<{ product_name: string }>('SELECT product_name FROM mkt_products');
  for (const r of mktRows) if (r.product_name) own.push(r.product_name);

  // SKU_MASTER (플랫폼 상품)
  const seen = new Set(own.map(n => n.toLowerCase()));
  const skuRows = await queryAll<{ product_name: string }>('SELECT product_name FROM sku_master');
  for (const r of skuRows) {
    if (r.product_name && !seen.has(r.product_name.toLowerCase())) {
      platform.push(r.product_name);
      seen.add(r.product_name.toLowerCase());
    }
  }

  return { own, platform, all: [...own, ...platform] };
}

export async function saveProductList(items: Array<{ name: string; category?: string }>, userId: string) {
  const stmts = items.map(item => ({
    sql: `INSERT OR IGNORE INTO mkt_products (product_name, source, category, updated_at, created_by) VALUES (?, 'manual', ?, datetime('now'), ?)`,
    params: [item.name, item.category || '', userId] as unknown[],
  }));
  for (let i = 0; i < stmts.length; i += 80) {
    await executeBatch(stmts.slice(i, i + 80));
  }
  return stmts.length;
}

// ── Trend Scan ──

interface TrendItem {
  keyword: string;
  keyword_ja?: string;
  category: string;
  reason: string;
  searchVolume: string;
  targetAudience: string;
  season: string;
  sources: string[];
}

export async function trendScan(filters: Record<string, unknown>, userId: string) {
  const runId = generateRunId();
  const f = filters;

  const system = '당신은 일본 주류·식품 시장과 한국 소비 트렌드를 분석하는 전문가입니다.\n드렁큰몽키는 일본 주류(위스키, 사케, 소주, 매실주, 리큐르, 맥주 등)와 관련 식품을 한국에 수입·판매하는 쇼핑몰입니다.\nweb_search 툴을 사용하여 최신 정보를 검색하세요.';

  let filterCtx = '';
  if (f.age) filterCtx += `타겟 연령: ${f.age}세\n`;
  if (f.gender) filterCtx += `타겟 성별: ${f.gender}\n`;
  if (f.region) filterCtx += `타겟 지역: ${f.region}\n`;
  if (f.liquor) filterCtx += `집중 주종: ${f.liquor} (이 주종 위주로 트렌드 조사)\n`;
  const channels = (Array.isArray(f.channels) && f.channels.length) ? f.channels as string[] : ['유튜브', '인스타그램', 'X(트위터)', '네이버카페', '라쿠텐/아마존JP'];
  filterCtx += `조사 채널: ${channels.join(', ')}\n`;

  const prompt = `최근 3개월 내 한국·일본에서 화제인 일본 주류 및 관련 트렌드를 조사하세요.\n\n`
    + `⚠️ 중요: 키워드는 반드시 아래 카테고리 범위 안에서만 선정하세요.\n\n`
    + (filterCtx ? `## 타겟팅 조건\n${filterCtx}\n` : '')
    + `## 허용 카테고리\n`
    + `- 위스키, 사케, 소주, 매실주/리큐르, 맥주, 와인, RTD, 안주·식품, 콘텐츠아이디어\n\n`
    + `⚠️ JSON만 출력:\n\`\`\`json\n{"trends":[{"keyword":"구체적 상품명(한국어)","keyword_ja":"日本語","category":"카테고리","reason":"화제이유","searchVolume":"급등|상승|보통","targetAudience":"타겟","season":"시즌성","sources":["URL"]}],"summary":"요약2문장"}\n\`\`\`\n`
    + `8~12개.`;

  const raw = await callClaude(system, prompt, { useWebSearch: true, maxSearchUses: 5 });
  const data = extractJson<{ trends: TrendItem[]; summary: string }>(raw);

  // Save to DB
  const now = new Date().toISOString();
  const stmts = (data.trends || []).map(t => ({
    sql: `INSERT INTO mkt_trends (run_id, scanned_at, keyword, category, reason, search_volume, target_audience, season, sources, summary, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [runId, now, t.keyword, t.category, t.reason, t.searchVolume, t.targetAudience, t.season, (t.sources || []).join('\n'), data.summary || '', userId] as unknown[],
  }));
  for (let i = 0; i < stmts.length; i += 80) {
    await executeBatch(stmts.slice(i, i + 80));
  }

  return { ok: true, runId, trends: data.trends || [], summary: data.summary || '' };
}

// ── Match ──

export async function matchTrends(runId: string, userId: string) {
  const trends = await queryAll<{ keyword: string; category: string; reason: string }>(
    'SELECT keyword, category, reason FROM mkt_trends WHERE run_id = ?', runId,
  );
  if (!trends.length) return { ok: false, message: '해당 run_id의 트렌드가 없습니다.' };

  const inv = await getInventory();
  if (!inv.all.length) return { ok: false, message: '등록된 상품이 없습니다.' };

  const inventory = inv.all.slice(0, 300);

  const system = '당신은 드렁큰몽키의 상품 기획자입니다.\n드렁큰몽키는 일본 주류와 관련 식품을 한국에 수입·판매합니다.';

  const prompt = `## 트렌드\n`
    + trends.map((t, i) => `${i + 1}. ${t.keyword} (${t.category}) — ${t.reason}`).join('\n')
    + `\n\n## 드렁큰몽키 상품 리스트 (${inv.own.length}개 자사몰 + ${inv.platform.length}개 플랫폼)\n`
    + inventory.map((p, i) => `${i + 1}. ${p}`).join('\n')
    + `\n\nJSON만:\n\`\`\`json\n{"matched":[{"trend":"","product":"","matchScore":0.9,"dmAngle":""}],"notMatched":[{"trend":"","category":"","suggestedProduct":"","reason":"","urgency":"high|medium|low"}]}\n\`\`\``;

  const raw = await callClaude(system, prompt);
  const data = extractJson<{ matched: unknown[]; notMatched: unknown[] }>(raw);

  // Save
  const now = new Date().toISOString();
  const stmts: { sql: string; params: unknown[] }[] = [];
  for (const m of (data.matched || []) as Array<Record<string, unknown>>) {
    stmts.push({
      sql: `INSERT INTO mkt_matches (run_id, matched_at, type, trend, product, match_score, dm_angle, category, reason, urgency, created_by)
            VALUES (?, ?, 'matched', ?, ?, ?, ?, '', '', '', ?)`,
      params: [runId, now, m.trend, m.product, m.matchScore, m.dmAngle, userId],
    });
  }
  for (const n of (data.notMatched || []) as Array<Record<string, unknown>>) {
    stmts.push({
      sql: `INSERT INTO mkt_matches (run_id, matched_at, type, trend, product, match_score, dm_angle, category, reason, urgency, created_by)
            VALUES (?, ?, 'not_matched', ?, '', 0, '', ?, ?, ?, ?)`,
      params: [runId, now, n.trend, n.category, n.reason, n.urgency, userId],
    });
  }
  for (let i = 0; i < stmts.length; i += 80) {
    await executeBatch(stmts.slice(i, i + 80));
  }

  return {
    ok: true,
    matched: data.matched || [],
    notMatched: data.notMatched || [],
    inventoryInfo: { ownCount: inv.own.length, platformCount: inv.platform.length, totalCount: inv.all.length },
  };
}

// ── DM Draft ──

export async function dmDraft(runId: string, filters: Record<string, unknown>, userId: string) {
  // Load matches + trends
  const matched = await queryAll<{ trend: string; product: string; match_score: number; dm_angle: string }>(
    "SELECT trend, product, match_score, dm_angle FROM mkt_matches WHERE run_id = ? AND type = 'matched'", runId,
  );
  const notMatched = await queryAll<{ trend: string; category: string }>(
    "SELECT trend, category FROM mkt_matches WHERE run_id = ? AND type = 'not_matched'", runId,
  );
  const trends = await queryAll<{ keyword: string; category: string; reason: string }>(
    'SELECT keyword, category, reason FROM mkt_trends WHERE run_id = ?', runId,
  );

  if (!matched.length && !trends.length) return { ok: true, emails: [], instagram: [], message: '데이터 없음' };

  const f = filters;
  const distCh = (Array.isArray(f.distChannels) && f.distChannels.length) ? f.distChannels as string[] : ['인스타 포스팅', '이메일 뉴스레터'];

  const system = `당신은 드렁큰몽키의 마케팅 카피라이터입니다.\n브랜드: DRUNKN MONKEY — 일본 주류 전문 수입 쇼핑몰\n톤: 프리미엄하지만 친근`;

  let promptParts: string[] = [];
  if (matched.length) {
    promptParts.push('## A. 재고 보유 상품\n' + matched.map((m, i) => `${i + 1}. ${m.trend} → ${m.product} (${m.match_score}) — ${m.dm_angle}`).join('\n'));
  }
  if (notMatched.length) {
    promptParts.push('## B. 미보유 트렌드\n' + notMatched.map((n, i) => `${i + 1}. ${n.trend} [${n.category}]`).join('\n'));
  }
  if (!matched.length && trends.length) {
    promptParts.push('## 트렌드 (매칭 없음)\n' + trends.map((t, i) => `${i + 1}. ${t.keyword} — ${t.reason}`).join('\n'));
  }

  const hasInsta = distCh.some(c => c.includes('인스타'));
  const hasEmail = distCh.some(c => c.includes('이메일'));

  let jsonSpec = '{\n';
  if (hasInsta) jsonSpec += '  "instagram": [{"caption":"","story_text":"","dm_text":"","hashtags":[],"targetTrend":""}],\n';
  if (hasEmail) jsonSpec += '  "emails": [{"subject":"","preview":"","headline":"","body":"","cta":"","targetTrend":""}],\n';
  jsonSpec = jsonSpec.replace(/,\n$/, '\n') + '}';

  const prompt = `배포 채널: ${distCh.join(', ')}\n\n${promptParts.join('\n\n')}\n\n`
    + `채널당 최대 3개 콘텐츠. JSON만:\n\`\`\`json\n${jsonSpec}\n\`\`\``;

  const raw = await callClaude(system, prompt, { maxTokens: 16000 });
  const data = extractJson<Record<string, unknown[]>>(raw);

  // Save to DB
  const now = new Date().toISOString();
  const stmts: { sql: string; params: unknown[] }[] = [];
  for (const e of (data.emails || []) as Array<Record<string, string>>) {
    stmts.push({
      sql: `INSERT INTO mkt_dm_drafts (run_id, generated_at, channel, subject, preview, body, cta, target_trend, persona, status, created_by)
            VALUES (?, ?, 'email', ?, ?, ?, ?, ?, '', 'draft', ?)`,
      params: [runId, now, e.subject, e.preview || '', e.body || '', e.cta, e.targetTrend || '', userId],
    });
  }
  for (let i = 0; i < stmts.length; i += 80) {
    await executeBatch(stmts.slice(i, i + 80));
  }

  return { ok: true, ...data };
}

// ── Suggest Themes (기획전 추천) ──

export async function suggestThemes(userId: string) {
  // Load supplier product stats
  const catStats = await queryAll<{ category: string; cnt: number }>(
    `SELECT COALESCE(category_kr, category, '기타') as category, COUNT(*) as cnt
     FROM supplier_products GROUP BY category ORDER BY cnt DESC LIMIT 20`,
  );
  const supStats = await queryAll<{ name: string; cnt: number }>(
    `SELECT s.name, COUNT(*) as cnt FROM supplier_products sp
     JOIN suppliers s ON sp.supplier_id = s.supplier_id
     GROUP BY sp.supplier_id ORDER BY cnt DESC LIMIT 10`,
  );
  const totalRow = await queryAll<{ cnt: number }>('SELECT COUNT(*) as cnt FROM supplier_products');
  const total = totalRow[0]?.cnt || 0;

  const catSummary = catStats.map(c => `${c.category}: ${c.cnt}개`).join(', ');
  const supSummary = supStats.map(s => `${s.name}(${s.cnt}개)`).join(', ');

  const now = new Date();
  const month = now.getMonth() + 1;
  const season = month <= 2 || month === 12 ? '겨울' : month <= 5 ? '봄' : month <= 8 ? '여름' : '가을';
  const dateStr = now.toISOString().substring(0, 10);

  const system = `당신은 드렁큰몽키의 마케팅 총괄 디렉터입니다.\n회사: DRUNKN MONKEY — 일본 주류 전문 수입 쇼핑몰\n판매채널: 데일리샷, 자사몰\nweb_search 툴을 사용하세요.`;

  const prompt = `## 현재 시점\n날짜: ${dateStr} (${season})\n\n`
    + `## 거래처 상품 현황 (총 ${total}개)\n카테고리: ${catSummary}\n거래처: ${supSummary}\n\n`
    + `## 작업\n1. web_search로 주류 트렌드 조사\n2. 기획전 테마 8개 제안\n\n`
    + `JSON만:\n\`\`\`json\n{"themes":[{"title":"","brief":"","timing":"","target":"","keywords":"","category":"","confidence":"상|중|하","reason":""}]}\n\`\`\``;

  const raw = await callClaude(system, prompt, { useWebSearch: true, maxSearchUses: 8, maxTokens: 8000 });
  const data = extractJson<{ themes: unknown[] }>(raw);

  return { ok: true, themes: data.themes || [] };
}

// ── Supplier Recommend (기획전 상품 추천) ──

export async function supplierRecommend(brief: string, maxResults: number, supplierFilter: string, userId: string) {
  // Load products
  let where = '';
  const params: unknown[] = [];
  if (supplierFilter) {
    where = ' WHERE sp.supplier_id = ?';
    params.push(supplierFilter);
  }

  const products = await queryAll<{
    supplier_name: string; supplier_id: string; product_name: string; product_name_kr: string;
    category: string; category_kr: string; purchase_price: number; currency: string; product_url: string;
  }>(
    `SELECT s.name as supplier_name, sp.supplier_id, sp.product_name, sp.product_name_kr,
            sp.category, sp.category_kr, sp.purchase_price, sp.currency, sp.product_url
     FROM supplier_products sp LEFT JOIN suppliers s ON sp.supplier_id = s.supplier_id${where}`,
    ...params,
  );

  if (!products.length) return { ok: false, message: '거래처 상품이 없습니다.' };

  const productList = products.slice(0, 500).map((p, i) =>
    `${i + 1}. [${p.supplier_name}] ${p.product_name_kr || p.product_name} (${p.category_kr || p.category}) ¥${p.purchase_price || '?'}`,
  ).join('\n');

  const system = '당신은 드렁큰몽키의 상품 MD입니다. 기획전 조건에 맞는 상품을 추천하세요.';
  const prompt = `## 기획전 조건\n${brief}\n\n## 거래처 상품 (${products.length}개)\n${productList}\n\n`
    + `위 조건에 가장 적합한 상품 ${maxResults}개를 추천하세요.\n`
    + `JSON만:\n\`\`\`json\n{"recommendations":[{"product":"상품명","supplier":"거래처명","category":"카테고리","price":"가격","reason":"추천사유","priority":"high|medium|low"}]}\n\`\`\``;

  const raw = await callClaude(system, prompt, { maxTokens: 8000 });
  const data = extractJson<{ recommendations: unknown[] }>(raw);

  return { ok: true, recommendations: data.recommendations || [] };
}

// ── Price Check ──

export async function priceCheck(runId: string, products: Array<{ name: string; category?: string }>, userId: string) {
  const system = '당신은 한국 주류 시장의 가격 분석 전문가입니다.\nweb_search를 사용하여 한국 온라인 주류 판매 사이트에서 실제 소비자 가격을 조사하세요.';

  const prompt = `아래 상품들의 한국 시장 소비자가 조사:\n\n`
    + products.map((p, i) => `${i + 1}. ${p.name} (${p.category || ''})`).join('\n')
    + `\n\nJSON만:\n\`\`\`json\n{"prices":[{"name":"","category":"","korean_retail_min":0,"korean_retail_avg":0,"competitor_count":0,"competitiveness":"상|중|하","recommended_purchase_price":0,"import_note":"","verdict":""}],"summary":""}\n\`\`\``;

  const raw = await callClaude(system, prompt, { useWebSearch: true, maxSearchUses: 5 });
  const data = extractJson<{ prices: Array<Record<string, unknown>>; summary: string }>(raw);

  // Save
  const now = new Date().toISOString();
  const stmts = (data.prices || []).map(p => ({
    sql: `INSERT INTO mkt_price_check (run_id, analyzed_at, name, category, korean_retail_min, korean_retail_avg, competitor_count, competitiveness, recommended_purchase_price, import_note, verdict, summary, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [runId, now, p.name, p.category, p.korean_retail_min, p.korean_retail_avg, p.competitor_count, p.competitiveness, p.recommended_purchase_price, p.import_note, p.verdict, data.summary || '', userId] as unknown[],
  }));
  for (let i = 0; i < stmts.length; i += 80) {
    await executeBatch(stmts.slice(i, i + 80));
  }

  return { ok: true, prices: data.prices || [], summary: data.summary || '' };
}

// ── History ──

export async function getHistory(limit = 20) {
  const runs = await queryAll<{ run_id: string; scanned_at: string; keyword_count: number }>(
    `SELECT run_id, MIN(scanned_at) as scanned_at, COUNT(*) as keyword_count
     FROM mkt_trends GROUP BY run_id ORDER BY scanned_at DESC LIMIT ?`,
    limit,
  );
  return runs;
}

export async function loadRun(runId: string) {
  const trends = await queryAll('SELECT * FROM mkt_trends WHERE run_id = ?', runId);
  const matches = await queryAll('SELECT * FROM mkt_matches WHERE run_id = ?', runId);
  const drafts = await queryAll('SELECT * FROM mkt_dm_drafts WHERE run_id = ?', runId);
  const prices = await queryAll('SELECT * FROM mkt_price_check WHERE run_id = ?', runId);
  return { trends, matches, drafts, prices };
}
