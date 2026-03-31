'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';

export const runtime = 'edge';

type Market = 'dailyshot' | 'kihya' | 'dmonkey';
const MARKET_LABELS: Record<Market, string> = {
  dailyshot: 'Dailyshot',
  kihya: 'Kihya',
  dmonkey: '드렁큰몽키',
};

interface ImportRow {
  import_id: string;
  market_id: string;
  file_name: string;
  sales_date: string;
  upload_status: string;
  created_at: string;
}

export default function UploadPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [market, setMarket] = useState<Market>('dailyshot');
  const [fileName, setFileName] = useState('');
  const [fileData, setFileData] = useState<unknown[][] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('대기 중…');
  const [imports, setImports] = useState<ImportRow[]>([]);

  const loadImports = useCallback(async () => {
    const res = await api<{ imports: ImportRow[] }>('/api/imports');
    if (res?.ok) setImports(res.imports || []);
  }, []);

  useEffect(() => { loadImports(); }, [loadImports]);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setStatus('파일 읽는 중…');

    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
      setFileData(data);
      setStatus(`${file.name} — ${data.length - 1}행 로드됨`);
    } catch {
      setStatus('파일 읽기 실패');
      toast('파일을 읽을 수 없습니다.', 'error');
    }
  };

  const onClear = () => {
    setFileName('');
    setFileData(null);
    setStatus('대기 중…');
    if (fileRef.current) fileRef.current.value = '';
  };

  const onUpload = async () => {
    if (!fileData || !fileName) {
      toast('파일을 선택하세요.', 'warn');
      return;
    }
    setUploading(true);
    setStatus('업로드 처리 중…');

    try {
      const res = await api<{
        ok: boolean;
        message: string;
        importId?: string;
        count?: number;
        duplicate?: boolean;
      }>('/api/upload', { marketId: market, fileName, sheetData: fileData });

      if (res?.ok) {
        toast(res.message, 'success');
        setStatus(res.message);
        onClear();
        loadImports();
      } else {
        toast(res?.message || '업로드 실패', 'error');
        setStatus(res?.message || '오류 발생');
      }
    } catch {
      toast('업로드 중 오류가 발생했습니다.', 'error');
      setStatus('오류 발생');
    } finally {
      setUploading(false);
    }
  };

  const onRollback = async (importId: string) => {
    if (!confirm(`${importId} 를 롤백하시겠습니까?`)) return;
    const res = await api<{ ok: boolean; message: string }>('/api/orders', {
      action: 'rollback',
      import_id: importId,
      reason: '수동 롤백',
    });
    if (res?.ok) {
      toast(res.message, 'success');
      loadImports();
    } else {
      toast(res?.message || '롤백 실패', 'error');
    }
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      success: 'bg-green-900/50 text-green-300',
      uploaded: 'bg-blue-900/50 text-blue-300',
      error: 'bg-red-900/50 text-red-300',
      cancelled: 'bg-gray-700/50 text-gray-400',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[s] || 'bg-gray-700 text-gray-300'}`}>
        {s}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <Card accent="blue">
        <h2 className="text-sm font-bold text-mx-text mb-3">주문서 업로드</h2>

        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <label className="block text-xs text-mx-text-secondary mb-1">마켓</label>
            <select
              value={market}
              onChange={e => setMarket(e.target.value as Market)}
              className="bg-mx-bg border border-mx-border rounded px-2 py-1.5 text-sm text-mx-text"
            >
              {Object.entries(MARKET_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-mx-text-secondary mb-1">
              주문서 파일 (.xlsx)
            </label>
            <label className="flex items-center gap-2 px-3 py-1.5 bg-mx-bg border border-mx-border rounded cursor-pointer hover:border-mx-blue/50 text-sm text-mx-text-secondary">
              <span>📂</span>
              <span className="truncate">{fileName || '파일을 선택하세요 (날짜 포함 파일명)'}</span>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv"
                onChange={onFileChange}
                className="hidden"
              />
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={onUpload} disabled={uploading || !fileData} size="sm">
            {uploading ? '처리 중…' : '⬆️ 주문서 처리'}
          </Button>
          <Button variant="outline" onClick={onClear} size="sm">
            ✕ 선택 해제
          </Button>
        </div>

        <p className="mt-2 text-xs text-mx-text-secondary">{status}</p>
      </Card>

      <Card>
        <h2 className="text-sm font-bold text-mx-text mb-3">업로드 이력</h2>
        {imports.length === 0 ? (
          <p className="text-xs text-mx-text-secondary">업로드 이력이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                  <th className="py-1.5 pr-3">Import ID</th>
                  <th className="py-1.5 pr-3">마켓</th>
                  <th className="py-1.5 pr-3">파일명</th>
                  <th className="py-1.5 pr-3">매출일</th>
                  <th className="py-1.5 pr-3">상태</th>
                  <th className="py-1.5 pr-3">업로드일</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {imports.map(imp => (
                  <tr key={imp.import_id} className="border-b border-mx-border/50 hover:bg-mx-border/10">
                    <td className="py-1.5 pr-3 font-mono text-mx-cyan">{imp.import_id}</td>
                    <td className="py-1.5 pr-3">{MARKET_LABELS[imp.market_id as Market] || imp.market_id}</td>
                    <td className="py-1.5 pr-3 truncate max-w-[200px]">{imp.file_name}</td>
                    <td className="py-1.5 pr-3">{imp.sales_date}</td>
                    <td className="py-1.5 pr-3">{statusBadge(imp.upload_status)}</td>
                    <td className="py-1.5 pr-3">{imp.created_at?.substring(0, 16)}</td>
                    <td className="py-1.5">
                      {imp.upload_status === 'success' && (
                        <Button variant="danger" size="sm" onClick={() => onRollback(imp.import_id)}>
                          롤백
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
