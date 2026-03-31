/**
 * GET  /api/cafe24/products — List products from Cafe24
 * POST /api/cafe24/products — Create a new product on Cafe24
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { cafe24Api } from '@/lib/services/cafe24';

export const runtime = 'edge';

interface Cafe24ProductList {
  products: Record<string, unknown>[];
}

export async function GET(req: NextRequest) {
  const { error } = withAuth();
  if (error) return error;

  const url = new URL(req.url);
  const limit = url.searchParams.get('limit') || '10';
  const offset = url.searchParams.get('offset') || '0';

  try {
    const data = await cafe24Api<Cafe24ProductList>(
      'GET',
      `/products?limit=${limit}&offset=${offset}`,
    );
    return NextResponse.json({ ok: true, products: data.products });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { error } = withAuth();
  if (error) return error;

  const body = await req.json();

  // Build Cafe24 product payload
  const product: Record<string, unknown> = {
    product_name: body.product_name,
    supply_price: body.supply_price || '0',
    price: body.price || '0',
    detail: body.detail || '',
    product_tag: body.tags || '',
    summary_description: body.summary || '',
    simple_description: body.simple_description || '',
    display: body.display !== false ? 'T' : 'F',
    selling: body.selling !== false ? 'T' : 'F',
    product_condition: body.product_condition || 'N',
    product_used_month: body.product_used_month || 0,
  };

  // Category
  if (body.category_no) {
    product.category = [{ category_no: body.category_no }];
  }

  // Main image
  if (body.image_url) {
    product.image = { url: body.image_url };
  }

  // Custom fields (variants/options if needed)
  if (body.custom_product_code) {
    product.custom_product_code = body.custom_product_code;
  }

  try {
    const data = await cafe24Api<{ product: Record<string, unknown> }>(
      'POST',
      '/products',
      { product },
    );
    return NextResponse.json({ ok: true, product: data.product });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
