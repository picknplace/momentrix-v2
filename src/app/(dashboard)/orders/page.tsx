'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatKRW } from '@/lib/utils/currency';

export const runtime = 'edge';

interface Order {
  id: number;
  import_id: string;
  market_id: string;
  sales_date: string;
  order_id: string;
  sub_order_id: string;
  product_name_raw: string;
  qty: number;
  sales_amount: number;
  settlement_amount: number;
  master_sku: string;
  order_status: string;
  tracking_no: string;
  recipient_name: string;
}

const MKT: Record<string, string> = { dailyshot: 'DS', kihya: 'KH', dmonkey: 'DM' };
const STATUS_COLORS: Record<string, string> = {
  normal: 'bg-green-900/50 text-green-300',
  cancelled: 'bg-red-900/50 text-red-300',
  refunded: 'bg-amber-900/50 text-amber-300',
  rolled_back: 'bg-gray-700/50 text-gray-400',
};

export default function OrdersPage() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [marketFilter, setMarketFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Cancel modal
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelDate, setCancelDate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '100' });
    if (marketFilter) params.set('marketId', marketFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    const res = await api<{ orders: Order[]; total: number }>(`orders?${params}`);
    if (res?.ok) {
      setOrders(res.orders || []);
      setTotal(res.total || 0);
    }
    setLoading(false);
  }, [page, marketFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const doCancel = async () => {
    if (!cancelTarget) return;
    const orderId = cancelTarget.market_id === 'kihya' ? cancelTarget.sub_order_id : cancelTarget.order_id;
    const res = await api<{ ok: boolean; message: string }>('orders', {
      action: 'cancel',
      market_id: cancelTarget.market_id,
      order_id: orderId,
      reason: cancelReason,
      cancel_date: cancelDate,
    });
    if (res?.ok) {
      toast(res.message, 'success');
      setCancelTarget(null);
      load();
    } else {
      toast(res?.message || '취소 실패', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={marketFilter} onChange={e => { setMarketFilter(e.target.value); setPage(1); }}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text">
          <option value="">전체 마켓</option>
          <option value="dailyshot">Dailyshot</option>
          <option value="kihya">Kihya</option>
          <option value="dmonkey">드렁큰몽키</option>
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text">
          <option value="">전체 상태</option>
          <option value="normal">정상</option>
          <option value="cancelled">취소</option>
          <option value="refunded">환불</option>
          <option value="rolled_back">롤백</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
        <span className="text-mx-text-secondary text-xs">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
        <Button variant="outline" size="sm" onClick={() => { setPage(1); load(); }}>조회</Button>
        <span className="text-xs text-mx-text-secondary ml-auto">{total}건</span>
      </div>

      <Card>
        {loading ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">로딩 중…</p>
        ) : (
          <>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-mx-card">
                  <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                    <th className="py-1.5 pr-2">마켓</th>
                    <th className="py-1.5 pr-2">매출일</th>
                    <th className="py-1.5 pr-2">주문번호</th>
                    <th className="py-1.5 pr-2">상품</th>
                    <th className="py-1.5 pr-2 text-right">수량</th>
                    <th className="py-1.5 pr-2 text-right">정산</th>
                    <th className="py-1.5 pr-2">SKU</th>
                    <th className="py-1.5 pr-2">상태</th>
                    <th className="py-1.5 pr-2">송장</th>
                    <th className="py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id} className="border-b border-mx-border/50 hover:bg-mx-border/10">
                      <td className="py-1.5 pr-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-mx-border/30">
                          {MKT[o.market_id] || o.market_id}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">{o.sales_date}</td>
                      <td className="py-1.5 pr-2 font-mono text-xs">{o.order_id}</td>
                      <td className="py-1.5 pr-2 truncate max-w-[180px]">{o.product_name_raw}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{o.qty}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{formatKRW(o.settlement_amount)}</td>
                      <td className="py-1.5 pr-2 font-mono text-mx-cyan text-[10px]">{o.master_sku}</td>
                      <td className="py-1.5 pr-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[o.order_status] || ''}`}>
                          {o.order_status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 font-mono text-[10px] text-green-400">{o.tracking_no}</td>
                      <td className="py-1.5">
                        {o.order_status === 'normal' && (
                          <Button variant="danger" size="sm" onClick={() => {
                            setCancelTarget(o);
                            setCancelDate(new Date().toISOString().substring(0, 10));
                          }}>
                            취소
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-center gap-2 mt-3">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                ← 이전
              </Button>
              <span className="text-xs text-mx-text-secondary">
                {page} / {Math.ceil(total / 100) || 1}
              </span>
              <Button variant="ghost" size="sm" disabled={page * 100 >= total} onClick={() => setPage(p => p + 1)}>
                다음 →
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* Cancel Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-mx-card border border-mx-border rounded-lg p-5 w-[400px]">
            <h3 className="text-sm font-bold text-mx-text mb-3">주문 취소</h3>
            <p className="text-xs text-mx-text-secondary mb-3">
              {cancelTarget.order_id} — {cancelTarget.product_name_raw}
            </p>
            <div className="space-y-2 mb-4">
              <div>
                <label className="block text-xs text-mx-text-secondary mb-1">취소일</label>
                <input type="date" value={cancelDate} onChange={e => setCancelDate(e.target.value)}
                  className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-full" />
              </div>
              <div>
                <label className="block text-xs text-mx-text-secondary mb-1">사유</label>
                <input type="text" value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                  placeholder="취소 사유"
                  className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-full" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" onClick={doCancel}>취소 확인</Button>
              <Button variant="outline" size="sm" onClick={() => setCancelTarget(null)}>닫기</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
