/**
 * POST /api/upload — Order file upload & import
 *
 * Accepts: multipart/form-data with:
 *   - file: xlsx/csv file
 *   - marketId: 'dailyshot' | 'kihya' | 'dmonkey'
 *
 * Or JSON body with:
 *   - marketId, fileName, sheetData (2D array, already parsed client-side)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-guard';
import { uploadAndImport } from '@/lib/services/upload';
import { writeAuditLog } from '@/lib/services/audit';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  const { user, error } = withAuth();
  if (error) return error;

  try {
    const contentType = req.headers.get('content-type') || '';

    let marketId: string;
    let fileName: string;
    let sheetData: unknown[][];

    if (contentType.includes('application/json')) {
      // Client-side parsed data (SheetJS on client)
      const body = await req.json();
      marketId = body.marketId;
      fileName = body.fileName;
      sheetData = body.sheetData;
    } else {
      return NextResponse.json(
        { ok: false, message: 'JSON body required (client-side xlsx parsing)' },
        { status: 400 },
      );
    }

    if (!marketId || !fileName || !sheetData?.length) {
      return NextResponse.json(
        { ok: false, message: '마켓, 파일명, 데이터가 필요합니다.' },
        { status: 400 },
      );
    }

    const result = await uploadAndImport(marketId, fileName, sheetData);

    // Audit log
    await writeAuditLog(
      user.user_id,
      'upload',
      'order_items',
      result.importId || '',
      undefined,
      undefined,
      undefined,
      result.ok ? 'success' : 'error',
      result.message,
    );

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, message: '업로드 오류: ' + msg }, { status: 500 });
  }
}
