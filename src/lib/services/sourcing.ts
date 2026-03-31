/**
 * Sourcing service — AI 상세페이지 생성, 이미지 스크래핑
 * Migrated from GAS serverGenerateProductDetail, _scrapeImages, _scrapeProductImage
 */
import { callClaude, extractJson } from '@/lib/services/claude';
import { queryOne } from '@/lib/db';

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

// ── Product detail generation ──

interface ProductDetailInput {
  product_name: string;
  product_name_kr?: string;
  category?: string;
  volume?: string;
  abv?: string;
  price?: number;
  supply_price?: number;
}

export async function generateProductDetail(input: ProductDetailInput) {
  const { product_name, product_name_kr, category, volume, abv, price, supply_price } = input;
  if (!product_name) throw new Error('상품명을 입력하세요.');

  const systemPrompt = '너는 일본 주류 전문 상품 상세페이지 작성자다. 한국 소비자 대상으로, 프리미엄 주류 쇼핑몰(키햐/데일리샷 스타일)에 올라갈 상품 상세 HTML을 생성한다.\n반드시 웹 검색을 통해 정확한 정보를 조사한 후 작성해야 한다.\n응답은 반드시 JSON 형식으로 반환한다.';

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
주의: 이미지는 실제 URL만 사용. placeholder 금지. 못 찾으면 img 태그 생략.
섹션 순서: 양조장→제품→수상→테이스팅→스펙→페어링`;

  const raw = await callClaude(systemPrompt, userPrompt, { useWebSearch: true, maxTokens: 16000, maxSearchUses: 5 });
  const result = extractJson<Record<string, unknown>>(raw);

  if (price) {
    result.price = Number(price);
    result.supply_price = Number(supply_price) || 0;
  }

  // Image scraping fallback
  try {
    const brewery = result.brewery as Record<string, string> | undefined;
    const productDetail = result.product_detail as Record<string, string> | undefined;

    if (brewery?.official_url && !brewery.image_url) {
      const imgs = await scrapeImages(brewery.official_url, 3);
      if (imgs.length) brewery.image_url = imgs[0];
    }
    if (productDetail?.official_url && !productDetail.image_url) {
      const imgs = await scrapeImages(productDetail.official_url, 3);
      if (imgs.length) productDetail.image_url = imgs[0];
    }
    if (productDetail && !productDetail.image_url) {
      const img = await scrapeProductImage(product_name);
      if (img) productDetail.image_url = img;
    }

    // Inject images into HTML
    let html = result.detail_html as string || '';
    if (brewery?.image_url) {
      html = html.replace(/\{\{BREWERY_IMG\}\}/g, `<img src="${brewery.image_url}" style="max-width:100%;border-radius:8px;" alt="양조장">`);
    }
    if (productDetail?.image_url) {
      html = html.replace(/\{\{PRODUCT_IMG\}\}/g, `<img src="${productDetail.image_url}" style="max-width:100%;max-height:400px;border-radius:8px;" alt="제품">`);
    }
    html = html.replace(/\{\{[A-Z_]+\}\}/g, '');
    result.detail_html = html;
  } catch {
    // Image scraping failure is non-fatal
  }

  return result;
}
