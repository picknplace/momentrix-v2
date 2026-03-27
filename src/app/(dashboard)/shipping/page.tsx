'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';

interface ShipOrder {
  id: number;
  market_id: string;
  sales_date: string;
  order_id: string;
  sub_order_id: string;
  product_name_raw: string;
  qty: number;
  recipient_name: string;
  tracking_no: string;
  ship_date: string;
  address: string;
  phone: string;
}

interface UnshippedCount {
  market_id: string;
  cnt: number;
}

const MKT: Record<string, string> = { dailyshot: 'DS', kihya: 'KH', dmonkey: 'DM' };

export default function ShippingPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<'unshipped' | 'all'>('unshipped');
  const [orders, setOrders] = useState<ShipOrder[]>([]);
  const [counts, setCounts] = useState<UnshippedCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api<{ orders: ShipOrder[]; unshippedCount: UnshippedCount[] }>(
      `/api/shipping?filter=${filter}`,
    );
    if (res?.ok) {
      setOrders(res.orders || []);
      setCounts(res.unshippedCount || []);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const onTrackingChange = (orderId: string, val: string) => {
    setTrackingInputs(prev => ({ ...prev, [orderId]: val }));
  };

  const onSaveTracking = async (order: ShipOrder) => {
    const trackingNo = trackingInputs[order.order_id];
    if (!trackingNo?.trim()) {
      toast('송장번호를 입력하세요.', 'warn');
      return;
    }

    const res = await api<{ ok: boolean; message: string }>('/api/shipping', {
      updates: [{
        order_id: order.order_id,
        sub_order_id: order.sub_order_id,
        tracking_no: trackingNo.trim(),
      }],
    });

    if (res?.ok) {
      toast('송장번호 저장 완료', 'success');
      setTrackingInputs(prev => { const n = { ...prev }; delete n[order.order_id]; return n; });
      load();
    } else {
      toast(res?.message || '저장 실패', 'error');
    }
  };

  const totalUnshipped = counts.reduce((s, c) => s + c.cnt, 0);

  // Elapsed days
  const elapsed = (salesDate: string) => {
    const d = new Date(salesDate);
    const now = new Date();
    return Math.floor((now.getTime() - d.getTime()) / 86400000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant={filter === 'unshipped' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setFilter('unshipped')}
        >
          미출고 ({totalUnshipped})
        </Button>
        <Button
          variant={filter === 'all' ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          전체
        </Button>
        <Button variant="outline" size="sm" onClick={load}>🔄 갱신</Button>

        {counts.map(c => (
          <span key={c.market_id} className="text-xs px-2 py-0.5 rounded bg-red-900/30 text-red-300">
            {MKT[c.market_id] || c.market_id}: {c.cnt}
          </span>
        ))}
      </div>

      <Card>
        {loading ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">로딩 중…</p>
        ) : orders.length === 0 ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">
            {filter === 'unshipped' ? '미출고 주문이 없습니다.' : '주문이 없습니다.'}
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-mx-card">
                <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                  <th className="py-1.5 pr-2">마켓</th>
                  <th className="py-1.5 pr-2">매출일</th>
                  <th className="py-1.5 pr-2">경과</th>
                  <th className="py-1.5 pr-2">주문번호</th>
                  <th className="py-1.5 pr-2">상품</th>
                  <th className="py-1.5 pr-2 text-right">수량</th>
                  <th className="py-1.5 pr-2">수취인</th>
                  <th className="py-1.5 pr-2">송장번호</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => {
                  const days = elapsed(o.sales_date);
                  const urgent = days >= 3;
                  return (
                    <tr key={o.id} className={`border-b border-mx-border/50 ${urgent ? 'bg-red-900/10' : ''}`}>
                      <td className="py-1.5 pr-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-mx-border/30">
                          {MKT[o.market_id] || o.market_id}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">{o.sales_date}</td>
                      <td className={`py-1.5 pr-2 font-mono ${urgent ? 'text-red-400 font-bold' : 'text-mx-text-secondary'}`}>
                        D+{days}
                      </td>
                      <td className="py-1.5 pr-2 font-mono">{o.order_id}</td>
                      <td className="py-1.5 pr-2 truncate max-w-[200px]">{o.product_name_raw}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{o.qty}</td>
                      <td className="py-1.5 pr-2">{o.recipient_name}</td>
                      <td className="py-1.5 pr-2">
                        {o.tracking_no ? (
                          <span className="text-green-400 font-mono">{o.tracking_no}</span>
                        ) : (
                          <input
                            type="text"
                            value={trackingInputs[o.order_id] || ''}
                            onChange={e => onTrackingChange(o.order_id, e.target.value)}
                            placeholder="송장번호"
                            className="bg-mx-bg border border-mx-border rounded px-1.5 py-0.5 text-xs text-mx-text w-[120px]"
                          />
                        )}
                      </td>
                      <td className="py-1.5">
                        {!o.tracking_no && trackingInputs[o.order_id] && (
                          <Button variant="success" size="sm" onClick={() => onSaveTracking(o)}>
                            저장
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
