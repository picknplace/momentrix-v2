/**
 * POST /api/sourcing — Sourcing operations
 *
 * Actions: generate_product_detail
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { generateProductDetail } from '@/lib/services/sourcing';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  const body = await req.json();
  const action = body.action as string;

  try {
    switch (action) {
      case 'generate_product_detail': {
        const result = await generateProductDetail({
          product_name: body.product_name,
          product_name_kr: body.product_name_kr,
          category: body.category,
          volume: body.volume,
          abv: body.abv,
          price: body.price,
          supply_price: body.supply_price,
        });
        return NextResponse.json({ ok: true, result });
      }

      default:
        return NextResponse.json({ ok: false, message: `알 수 없는 action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
