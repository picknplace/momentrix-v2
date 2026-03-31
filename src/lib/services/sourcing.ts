/**
 * Sourcing service — AI 상세페이지 생성, 이미지 스크래핑
 * Migrated from GAS serverGenerateProductDetail, _scrapeImages, _scrapeProductImage
 */
import { callClaude, extractJson } from '@/lib/services/claude';
import { queryOne, queryAll } from '@/lib/db';

// ── Image scraping helpers ──

export async function scrapeImages(url: string, maxCount = 5): Promise<string[]> {
  if (!url) return [];
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return [];
    const html = await res.text();
    const imgs: string[] = [];
    const regex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = regex.exec(html)) !== null && imgs.length < maxCount) {
      let src = match[1];
      if (src.startsWith('//')) src = 'https:' + src;
      else if (src.startsWith('/')) {
        const base = url.match(/^(https?:\/\/[^/]+)/);
        if (base) src = base[1] + src;
      }
      if (src.includes('.svg') || src.includes('pixel') || src.includes('spacer') || src.includes('blank')) continue;
      if (src.includes('logo') && imgs.length > 0) continue;
      const widthMatch = match[0].match(/width=["']?(\d+)/i);
      const heightMatch = match[0].match(/height=["']?(\d+)/i);
      if (widthMatch && parseInt(widthMatch[1]) < 50) continue;
      if (heightMatch && parseInt(heightMatch[1]) < 50) continue;
      if (src.startsWith('http')) imgs.push(src);
    }
    return imgs;
  } catch {
    return [];
  }
}

export async function scrapeProductImage(productName: string): Promise<string | null> {
  const row = await queryOne<{ value: string }>("SELECT value FROM config_kv WHERE key = 'RAKUTEN_APP_ID'");
  const appId = row?.value;
  if (!appId) return null;

  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${appId}&keyword=${encodeURIComponent(productName)}&hits=1&imageFlag=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as { Items?: Array<{ Item: { mediumImageUrls?: Array<{ imageUrl: string }>; smallImageUrls?: Array<{ imageUrl: string }> } }> };
    if (data.Items?.[0]?.Item) {
      const imgs = data.Items[0].Item.mediumImageUrls || data.Items[0].Item.smallImageUrls;
      if (imgs?.length) {
        return String(imgs[0].imageUrl || imgs[0]).replace('?_ex=128x128', '?_ex=500x500').replace('?_ex=64x64', '?_ex=500x500');
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Google Custom Search image search ──

interface GoogleSearchItem {
  link: string;
  image?: { contextLink: string; width: number; height: number };
}

export async function searchGoogleImages(query: string, count = 3): Promise<string[]> {
  const rows = await queryAll<{ key: string; value: string }>(
    "SELECT key, value FROM config_kv WHERE key IN ('GOOGLE_CSE_KEY', 'GOOGLE_CSE_API_KEY', 'GOOGLE_CSE_CX')"
  );
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;

  const apiKey = cfg.GOOGLE_CSE_KEY || cfg.GOOGLE_CSE_API_KEY;
  const cx = cfg.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return [];

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&searchType=image&num=${count}&imgSize=large&safe=active`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as { items?: GoogleSearchItem[] };
    if (!data.items?.length) return [];
    return data.items
      .filter(item => item.image && item.image.width >= 200 && item.image.height >= 200)
      .map(item => item.link);
  } catch {
    return [];
  }
}

// ── Product detail generation ──

interface ProductDetailInput {
  product_name: string;
  product_name_kr?: string;
  category?: string;
  volume?: string;
  abv?: string;
  price?: number;
  supply_price?: number;
  model?: 'haiku' | 'sonnet';
}

export async function generateProductDetail(input: ProductDetailInput) {
  const { product_name, product_name_kr, category, volume, abv, price, supply_price, model } = input;
  if (!product_name) throw new Error('상품명을 입력하세요.');

  const systemPrompt = `너는 일본 주류 전문 상품 상세페이지 작성자다. 한국 소비자 대상으로, 프리미엄 주류 쇼핑몰(키햐/데일리샷 스타일)에 올라갈 상품 상세 HTML을 생성한다.
반드시 웹 검색을 통해 정확한 정보를 조사한 후 작성해야 한다.
응답은 반드시 JSON 형식으로 반환한다.

한국 소비자에게 익숙한 표현을 사용할 것. 아래 치환 규칙을 반드시 따를 것:
- 純米大吟醸/순미대긴죠 → 준마이 다이긴조
- 純米吟醸/순미긴죠 → 준마이 긴조
- 大吟醸/대긴죠 → 다이긴조
- 吟醸/긴죠 → 긴조
- 純米/순미 → 준마이
- 本醸造/본양조 → 혼조조
- 生酒/생주 → 나마자케
- 原酒/원주 → 겐슈
- にごり/니고리 → 니고리자케
- 焼酎/소주 → 쇼추
- 泡盛/아와모리 → 아와모리
- 梅酒/매주 → 우메슈
- 정미율(精米歩合) → 정미율 (그대로 사용)
- 槽搾り/후네시보리 → 후네 압착
- 荒走り → 아라바시리
- 責め → 세메
- 杜氏/두씨 → 토지(양조장인)
- 蔵元/장원 → 양조장
- 蔵人/장인 → 양조사
- 冷やおろし → 히야오로시
- 冷酒/냉주 → 차갑게
- 燗酒/연주 → 따뜻하게 데워서
- ぬる燗 → 미지근한 온도(40℃)
- 上燗 → 살짝 따뜻하게(45℃)
- 熱燗 → 뜨겁게 데워서(50℃)
- 甘口/단구 → 달콤한 맛
- 辛口/신구 → 드라이한 맛
- 키레/キレ → 깔끔한 마무리
- 旨味/우마미 → 감칠맛
- 吟醸香/긴죠카 → 긴조 향
- 含み香 → 입안 향
- 敷地内 → 부지 내`;

  let userPrompt = `다음 주류 상품의 상세 페이지 콘텐츠를 생성해줘.\n\n상품명: ${product_name}\n`;
  if (product_name_kr && product_name_kr !== product_name) userPrompt += `한글명: ${product_name_kr}\n`;
  if (category) userPrompt += `카테고리: ${category}\n`;
  if (volume) userPrompt += `용량: ${volume}\n`;
  if (abv) userPrompt += `도수: ${abv}\n`;

  userPrompt += `\n웹 검색으로 조사 후 JSON 반환:
\`\`\`json
{
  "product_name_display": "상품 표시명",
  "one_liner": "한줄 캐치프레이즈",
  "tags": ["해시태그"],
  "specs": {"종류":"","용량":"","도수":"","국가":"","원료":"","정미율":"","숙성":"","케이스":""},
  "tasting": {"aroma":"","taste":"","finish":""},
  "brewery": {"name":"","name_ja":"","location":"","founded":"","description":"","official_url":"","image_url":""},
  "product_detail": {"description":"","food_pairing":"","serving":"","official_url":"","image_url":""},
  "awards": [{"name":"","year":"","result":""}],
  "detail_html": "완전한 HTML (인라인 CSS, 모바일 반응형)"
}
\`\`\`
중요:
- detail_html 양조장 소개 섹션에 반드시 {{BREWERY_IMG}} 플레이스홀더를 포함할 것 (시스템이 실제 이미지로 교체함)
- detail_html 제품 소개 섹션에 반드시 {{PRODUCT_IMG}} 플레이스홀더를 포함할 것 (시스템이 실제 이미지로 교체함)
- brewery.official_url과 product_detail.official_url은 반드시 실제 공식 사이트 URL을 조사해서 넣을 것
섹션 순서: 양조장→제품→수상→테이스팅→스펙→페어링`;

  const raw = await callClaude(systemPrompt, userPrompt, { useWebSearch: true, maxTokens: 16000, maxSearchUses: 5, model: model || 'haiku' });
  const result = extractJson<Record<string, unknown>>(raw);

  if (price) {
    result.price = Number(price);
    result.supply_price = Number(supply_price) || 0;
  }

  // Image acquisition chain: Claude → scrape official URL → Google Images → Rakuten
  try {
    const brewery = result.brewery as Record<string, string> | undefined;
    const productDetail = result.product_detail as Record<string, string> | undefined;
    const breweryName = brewery?.name_ja || brewery?.name || '';

    // Step 1: Scrape official URLs (if Claude found them)
    if (brewery?.official_url && !brewery.image_url) {
      const imgs = await scrapeImages(brewery.official_url, 3);
      if (imgs.length) brewery.image_url = imgs[0];
    }
    if (productDetail?.official_url && !productDetail.image_url) {
      const imgs = await scrapeImages(productDetail.official_url, 3);
      if (imgs.length) productDetail.image_url = imgs[0];
    }

    // Step 2: Google Custom Search Images
    if (brewery && !brewery.image_url && breweryName) {
      const imgs = await searchGoogleImages(`${breweryName} 酒蔵 外観`, 2);
      if (imgs.length) brewery.image_url = imgs[0];
    }
    if (productDetail && !productDetail.image_url) {
      const imgs = await searchGoogleImages(`${product_name} 日本酒 ボトル`, 2);
      if (imgs.length) productDetail.image_url = imgs[0];
    }

    // Step 3: Rakuten API fallback for product image
    if (productDetail && !productDetail.image_url) {
      const img = await scrapeProductImage(product_name);
      if (img) productDetail.image_url = img;
    }

    // Inject images into HTML
    let html = result.detail_html as string || '';
    const breweryImgTag = brewery?.image_url
      ? `<img src="${brewery.image_url}" style="max-width:100%;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);" alt="양조장">`
      : '';
    const productImgTag = productDetail?.image_url
      ? `<img src="${productDetail.image_url}" style="max-width:100%;max-height:400px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);" alt="제품">`
      : '';

    // Replace placeholders if present
    if (html.includes('{{BREWERY_IMG}}')) {
      html = html.replace(/\{\{BREWERY_IMG\}\}/g, breweryImgTag);
    } else if (breweryImgTag) {
      // Fallback: insert after brewery section title
      const breweryTitleMatch = html.match(/(양조장[^<]*<\/h[23]>)/i);
      if (breweryTitleMatch) {
        html = html.replace(breweryTitleMatch[0], `${breweryTitleMatch[0]}<div style="text-align:center;margin:20px 0;">${breweryImgTag}</div>`);
      }
    }

    if (html.includes('{{PRODUCT_IMG}}')) {
      html = html.replace(/\{\{PRODUCT_IMG\}\}/g, productImgTag);
    } else if (productImgTag) {
      // Fallback: insert after product section title
      const productTitleMatch = html.match(/(제품[^<]*<\/h[23]>)/i);
      if (productTitleMatch) {
        html = html.replace(productTitleMatch[0], `${productTitleMatch[0]}<div style="text-align:center;margin:20px 0;">${productImgTag}</div>`);
      }
    }

    html = html.replace(/\{\{[A-Z_]+\}\}/g, '');
    result.detail_html = html;
  } catch {
    // Image scraping failure is non-fatal
  }

  // Post-process: Korean term normalization
  result.detail_html = normalizeKoreanTerms(result.detail_html as string || '');

  return result;
}

// ── Korean term normalization ──

const TERM_REPLACEMENTS: [RegExp, string][] = [
  // 한자 → 한글 (순서 중요: 긴 패턴 먼저)
  [/純米大吟醸/g, '준마이 다이긴조'],
  [/純米大吟醗/g, '준마이 다이긴조'],
  [/순미 대吟醸/g, '준마이 다이긴조'],
  [/순미대吟醸/g, '준마이 다이긴조'],
  [/大吟醸/g, '다이긴조'],
  [/대吟醸/g, '다이긴조'],
  [/純米吟醸/g, '준마이 긴조'],
  [/순미吟醸/g, '준마이 긴조'],
  [/吟醸香/g, '긴조 향'],
  [/吟醸/g, '긴조'],
  [/純米酒/g, '준마이슈'],
  [/純米/g, '준마이'],
  [/本醸造/g, '혼조조'],
  [/生酒/g, '나마자케'],
  [/原酒/g, '겐슈'],
  [/焼酎/g, '쇼추'],
  [/泡盛/g, '아와모리'],
  [/梅酒/g, '우메슈'],
  [/日本酒度/g, '일본주도'],
  [/일본酒度/g, '일본주도'],
  [/日本酒/g, '일본주'],
  [/酵母/g, '효모'],
  [/酒蔵/g, '양조장'],
  [/酒造/g, '주조'],
  [/杜氏/g, '토지(양조장인)'],
  [/蔵元/g, '양조장'],
  [/蔵人/g, '양조사'],
  [/蔵內/g, '양조장 내'],
  [/蔵内/g, '양조장 내'],
  [/仕込み水/g, '담금수'],
  [/仕込み/g, '담금'],
  [/精米歩合/g, '정미율'],
  [/原料米/g, '원료쌀'],
  [/원료米/g, '원료쌀'],
  [/酒米/g, '주조용 쌀'],
  [/新酒/g, '햇술'],
  [/古酒/g, '숙성주'],
  [/甘口/g, '달콤한 맛'],
  [/辛口/g, '드라이한 맛'],
  [/旨味/g, '감칠맛'],
  [/敷地内/g, '부지 내'],
  [/敷地內/g, '부지 내'],
  [/品評会/g, '품평회'],
  [/品評會/g, '품평회'],
  [/金賞/g, '금상'],
  // 한글 표기 통일
  [/순미대긴죠/g, '준마이 다이긴조'],
  [/순미 대긴죠/g, '준마이 다이긴조'],
  [/대긴죠/g, '다이긴조'],
  [/순미긴죠/g, '준마이 긴조'],
  [/순미 긴죠/g, '준마이 긴조'],
  [/긴죠카/g, '긴조 향'],
  [/긴죠향/g, '긴조 향'],
  [/긴죠 향/g, '긴조 향'],
  [/긴죠/g, '긴조'],
  [/순미/g, '준마이'],
  [/본양조/g, '혼조조'],
  [/생주/g, '나마자케'],
  [/원주/g, '겐슈'],
  [/매주/g, '우메슈'],
  [/두씨/g, '토지(양조장인)'],
  [/장원/g, '양조장'],
  [/냉주/g, '차갑게'],
  [/단구/g, '달콤한 맛'],
  [/신구/g, '드라이한 맛'],
  [/키레/g, '깔끔한 마무리'],
  [/후네시보리/g, '후네 압착'],
];

function normalizeKoreanTerms(html: string): string {
  let result = html;
  for (const [pattern, replacement] of TERM_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
