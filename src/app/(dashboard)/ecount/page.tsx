'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatNumber } from '@/lib/utils/currency';

export const runtime = 'edge';

interface EcRow {
  id: number;
  market_id: string;
  order_id: string;
  sub_order_id: string;
  master_sku: string;
  product_name_raw: string;
  qty: number;
  sales_date: string;
  recipient_name: string;
  order_status: string;
  ec_status: string | null;
}

const MKT: Record<string, string> = { dailyshot: 'DS', kihya: 'KH', dmonkey: 'DM' };

type FilterType = 'pending' | 'cancelled_pending' | 'all';

export default function EcountPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterType>('pending');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<EcRow[]>([]);
  const [skuNames, setSkuNames] = useState<Record<string, string>>({});
  const [pendingCancels, setPendingCancels] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ filter });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    const res = await api<{
      rows: EcRow[];
      skuNames: Record<string, string>;
      pendingCancels: number;
    }>(`ecount?${params}`);

    if (res?.ok) {
      setRows(res.rows || []);
      setSkuNames(res.skuNames || {});
      setPendingCancels(res.pendingCancels || 0);
      setSelected(new Set());
    } else {
      toast('이카운트 데이터 로드 실패', 'error');
    }
    setLoading(false);
  }, [filter, dateFrom, dateTo, toast]);

  useEffect(() => { load(); }, [load]);

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map(r => r.id)));
    }
  };

  const markDone = async (target: 'order' | 'cancel' | 'all') => {
    const orderIds = selected.size > 0
      ? rows.filter(r => selected.has(r.id)).map(r => r.order_id)
      : undefined;

    const res = await api<{ ok: boolean; count: number }>('ecount', {
      action: 'mark_done',
      target,
      order_ids: orderIds,
    });

    if (res?.ok) {
      toast(`${res.count}건 이카운트 완료 처리`, 'success');
      load();
    } else {
      toast('처리 실패', 'error');
    }
  };

  const filterButtons: { label: string; val: FilterType }[] = [
    { label: '미전송 주문', val: 'pending' },
    { label: '미전송 취소', val: 'cancelled_pending' },
    { label: '전체', val: 'all' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {filterButtons.map(b => (
          <Button
            key={b.val}
            variant={filter === b.val ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setFilter(b.val)}
          >
            {b.label}
          </Button>
        ))}
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
        <span className="text-mx-text-secondary text-xs">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
        <Button variant="outline" size="sm" onClick={load}>조회</Button>

        {pendingCancels > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-red-900/30 text-red-300 ml-auto">
            미전송 취소: {pendingCancels}건
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {selected.size > 0 && (
          <span className="text-xs text-mx-text-secondary">{selected.size}건 선택</span>
        )}
        <Button variant="outline" size="sm" onClick={() => markDone('order')}>
          주문 완료처리
        </Button>
        <Button variant="outline" size="sm" onClick={() => markDone('cancel')}>
          취소 완료처리
        </Button>
        <span className="text-xs text-mx-text-secondary ml-auto">{formatNumber(rows.length)}건</span>
      </div>

      <Card>
        {loading ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">로딩 중…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">
            {filter === 'pending' ? '미전송 주문이 없습니다.' : '데이터가 없습니다.'}
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-mx-card">
                <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                  <th className="py-1.5 pr-2">
                    <input type="checkbox" checked={selected.size === rows.length && rows.length > 0}
                      onChange={toggleAll} className="accent-mx-cyan" />
                  </th>
                  <th className="py-1.5 pr-2">마켓</th>
                  <th className="py-1.5 pr-2">매출일</th>
                  <th className="py-1.5 pr-2">주문번호</th>
                  <th className="py-1.5 pr-2">SKU</th>
                  <th className="py-1.5 pr-2">상품</th>
                  <th className="py-1.5 pr-2 text-right">수량</th>
                  <th className="py-1.5 pr-2">수취인</th>
                  <th className="py-1.5 pr-2">상태</th>
                  <th className="py-1.5">EC상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-mx-border/50 hover:bg-mx-border/10">
                    <td className="py-1.5 pr-2">
                      <input type="checkbox" checked={selected.has(r.id)}
                        onChange={() => toggleSelect(r.id)} className="accent-mx-cyan" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-mx-border/30">
                        {MKT[r.market_id] || r.market_id}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2">{r.sales_date}</td>
                    <td className="py-1.5 pr-2 font-mono">{r.order_id}</td>
                    <td className="py-1.5 pr-2 font-mono text-mx-cyan text-[10px]">{r.master_sku}</td>
                    <td className="py-1.5 pr-2 truncate max-w-[200px]">
                      {skuNames[r.master_sku] || r.product_name_raw}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono">{r.qty}</td>
                    <td className="py-1.5 pr-2">{r.recipient_name}</td>
                    <td className="py-1.5 pr-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        r.order_status === 'cancelled' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'
                      }`}>
                        {r.order_status}
                      </span>
                    </td>
                    <td className="py-1.5">
                      {r.ec_status ? (
                        <span className="text-green-400 text-[10px]">done</span>
                      ) : (
                        <span className="text-amber-400 text-[10px]">대기</span>
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
