'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatNumber } from '@/lib/utils/currency';

export const runtime = 'edge';

interface InvRow {
  master_sku: string;
  product_name: string;
  stock: number;
  allocated: number;
  available: number;
  safety_stock: number;
  updated_at: string;
}

export default function InventoryPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<InvRow[]>([]);
  const [shippedMap, setShippedMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Adjust modal
  const [adjustTarget, setAdjustTarget] = useState<InvRow | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api<{ rows: InvRow[]; shippedMap: Record<string, number> }>('inventory');
    if (res?.ok) {
      setRows(res.rows || []);
      setShippedMap(res.shippedMap || {});
    } else {
      toast('재고 로드 실패', 'error');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? rows.filter(r =>
        r.master_sku.toLowerCase().includes(search.toLowerCase()) ||
        (r.product_name || '').toLowerCase().includes(search.toLowerCase())
      )
    : rows;

  const doAdjust = async () => {
    if (!adjustTarget) return;
    const qty = parseInt(adjustQty, 10);
    if (isNaN(qty) || qty === 0) {
      toast('수량을 입력하세요 (양수: 입고, 음수: 출고)', 'warn');
      return;
    }

    const res = await api<{ ok: boolean; message: string }>('inventory', {
      action: 'adjust',
      sku: adjustTarget.master_sku,
      qty,
      note: adjustNote,
    });

    if (res?.ok) {
      toast(res.message, 'success');
      setAdjustTarget(null);
      setAdjustQty('');
      setAdjustNote('');
      load();
    } else {
      toast(res?.message || '조정 실패', 'error');
    }
  };

  const totalStock = rows.reduce((s, r) => s + r.stock, 0);
  const totalAvail = rows.reduce((s, r) => s + r.available, 0);
  const lowStockCount = rows.filter(r => r.safety_stock > 0 && r.available <= r.safety_stock).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="SKU / 상품명 검색"
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-[200px]"
        />
        <Button variant="outline" size="sm" onClick={load}>갱신</Button>
        <div className="flex items-center gap-3 ml-auto text-xs text-mx-text-secondary">
          <span>총재고: <b className="text-mx-text">{formatNumber(totalStock)}</b></span>
          <span>가용: <b className="text-mx-cyan">{formatNumber(totalAvail)}</b></span>
          {lowStockCount > 0 && (
            <span className="px-2 py-0.5 rounded bg-red-900/30 text-red-300">
              안전재고 미달: {lowStockCount}
            </span>
          )}
        </div>
      </div>

      <Card>
        {loading ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">로딩 중…</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">재고 데이터가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-mx-card">
                <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                  <th className="py-1.5 pr-2">SKU</th>
                  <th className="py-1.5 pr-2">상품명</th>
                  <th className="py-1.5 pr-2 text-right">재고</th>
                  <th className="py-1.5 pr-2 text-right">할당</th>
                  <th className="py-1.5 pr-2 text-right">가용</th>
                  <th className="py-1.5 pr-2 text-right">안전재고</th>
                  <th className="py-1.5 pr-2 text-right">7일출고</th>
                  <th className="py-1.5 pr-2">수정일</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const low = r.safety_stock > 0 && r.available <= r.safety_stock;
                  const shipped7d = shippedMap[r.master_sku] || 0;
                  return (
                    <tr key={r.master_sku} className={`border-b border-mx-border/50 ${low ? 'bg-red-900/10' : ''}`}>
                      <td className="py-1.5 pr-2 font-mono text-mx-cyan">{r.master_sku}</td>
                      <td className="py-1.5 pr-2 truncate max-w-[200px]">{r.product_name}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{formatNumber(r.stock)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-mx-text-secondary">{formatNumber(r.allocated)}</td>
                      <td className={`py-1.5 pr-2 text-right font-mono ${low ? 'text-red-400 font-bold' : ''}`}>
                        {formatNumber(r.available)}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono text-mx-text-secondary">{r.safety_stock || '-'}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-amber-400">{shipped7d || '-'}</td>
                      <td className="py-1.5 pr-2 text-mx-text-secondary">{r.updated_at?.substring(0, 10)}</td>
                      <td className="py-1.5">
                        <Button variant="ghost" size="sm" onClick={() => {
                          setAdjustTarget(r);
                          setAdjustQty('');
                          setAdjustNote('');
                        }}>
                          조정
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Adjust Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-mx-card border border-mx-border rounded-lg p-5 w-[400px]">
            <h3 className="text-sm font-bold text-mx-text mb-3">재고 조정</h3>
            <p className="text-xs text-mx-text-secondary mb-1">
              {adjustTarget.master_sku} — {adjustTarget.product_name}
            </p>
            <p className="text-xs text-mx-text-secondary mb-3">
              현재: 재고 {adjustTarget.stock} / 할당 {adjustTarget.allocated} / 가용 {adjustTarget.available}
            </p>
            <div className="space-y-2 mb-4">
              <div>
                <label className="block text-xs text-mx-text-secondary mb-1">조정 수량 (양수: 입고, 음수: 출고)</label>
                <input type="number" value={adjustQty} onChange={e => setAdjustQty(e.target.value)}
                  placeholder="예: 10 또는 -5"
                  className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-full" />
              </div>
              <div>
                <label className="block text-xs text-mx-text-secondary mb-1">메모</label>
                <input type="text" value={adjustNote} onChange={e => setAdjustNote(e.target.value)}
                  placeholder="조정 사유"
                  className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-full" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={doAdjust}>조정</Button>
              <Button variant="outline" size="sm" onClick={() => setAdjustTarget(null)}>닫기</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
