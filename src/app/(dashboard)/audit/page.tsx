'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface AuditEntry {
  log_id: string;
  timestamp: string;
  user_id: string;
  action_type: string;
  target_sheet: string;
  target_id: string;
  result: string;
  detail: string;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/audit?page=${page}&limit=${pageSize}`);
      const data = await res.json();
      if (data.ok) {
        setLogs(data.logs);
        setTotal(data.total);
      }
    } catch { /* */ }
    setLoading(false);
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-mx-text">감사 로그</h2>
      <Card>
        {loading ? (
          <p className="text-sm text-mx-text-muted p-4">로딩 중...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-mx-border text-mx-text-secondary">
                  <th className="text-left px-2 py-1.5">시간</th>
                  <th className="text-left px-2 py-1.5">사용자</th>
                  <th className="text-left px-2 py-1.5">액션</th>
                  <th className="text-left px-2 py-1.5">대상</th>
                  <th className="text-left px-2 py-1.5">결과</th>
                  <th className="text-left px-2 py-1.5">상세</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.log_id} className="border-b border-mx-border-light hover:bg-mx-card-hover">
                    <td className="px-2 py-1.5 text-mx-text-muted whitespace-nowrap">
                      {new Date(l.timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Tokyo' })}
                    </td>
                    <td className="px-2 py-1.5 text-mx-text">{l.user_id}</td>
                    <td className="px-2 py-1.5 text-mx-cyan">{l.action_type}</td>
                    <td className="px-2 py-1.5 text-mx-text-secondary">{l.target_sheet}{l.target_id ? ` / ${l.target_id}` : ''}</td>
                    <td className="px-2 py-1.5">
                      <span className={l.result === 'success' ? 'text-green-400' : 'text-red-400'}>{l.result}</span>
                    </td>
                    <td className="px-2 py-1.5 text-mx-text-muted max-w-[200px] truncate">{l.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex gap-1 p-2 justify-center">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</Button>
            <span className="text-xs text-mx-text-secondary py-1.5">{page} / {totalPages}</span>
            <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>다음</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
