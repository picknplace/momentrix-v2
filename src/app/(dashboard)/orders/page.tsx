'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatKRW } from '@/lib/utils/currency';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend, Filler);

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

interface Analytics {
  trend: { period: string; orders: number; qty: number; settlement: number }[];
  byMarket: { market_id: string; orders: number; qty: number; settlement: number; cancelled: number }[];
  cancelRate: { period: string; total: number; cancelled: number }[];
  shipStatus: { market_id: string; shipped: number; unshipped: number }[];
  repeatCustomers: { key_val: string; key_type: string; order_count: number; total_qty: number; total_settlement: number; first_date: string; last_date: string }[];
}

const MKT: Record<string, string> = { dailyshot: 'DS', kihya: 'KH', dmonkey: 'DM' };
const MKT_COLORS: Record<string, string> = {
  dailyshot: 'rgba(59,130,246,0.8)',
  kihya: 'rgba(34,197,94,0.8)',
  dmonkey: 'rgba(249,115,22,0.8)',
};
const STATUS_COLORS: Record<string, string> = {
  normal: 'bg-green-900/50 text-green-300',
  cancelled: 'bg-red-900/50 text-red-300',
  refunded: 'bg-amber-900/50 text-amber-300',
  rolled_back: 'bg-gray-700/50 text-gray-400',
};

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
    y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
  },
};

function fmtMan(v: number) { return Math.round(v / 10000) + '만'; }

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

  // Analytics
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [period, setPeriod] = useState<'day' | 'month' | 'year'>('day');
  const [days, setDays] = useState(30);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [showRepeat, setShowRepeat] = useState(false);

  // Repeat customer lookup
  const repeatMapRef = useRef<Map<string, number>>(new Map());

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

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    const res = await api<Analytics>(`orders/analytics?period=${period}&days=${days}`);
    if (res?.ok) {
      setAnalytics(res as unknown as Analytics);
      // Build repeat customer map
      const m = new Map<string, number>();
      (res as unknown as Analytics).repeatCustomers?.forEach(r => {
        m.set(r.key_val, r.order_count);
      });
      repeatMapRef.current = m;
    }
    setAnalyticsLoading(false);
  }, [period, days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

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

  const getRepeatCount = (o: Order) => repeatMapRef.current.get(o.recipient_name) || 0;

  // Chart data
  const trendData = analytics ? {
    labels: analytics.trend.map(t => period === 'day' ? t.period.substring(5) : t.period),
    datasets: [{
      label: '정산액',
      data: analytics.trend.map(t => t.settlement),
      borderColor: 'rgba(59,130,246,0.9)',
      backgroundColor: 'rgba(59,130,246,0.15)',
      fill: true, tension: 0.4, pointRadius: 2,
    }],
  } : null;

  const cancelData = analytics ? {
    labels: analytics.cancelRate.map(c => period === 'day' ? c.period.substring(5) : c.period),
    datasets: [
      {
        label: '전체',
        data: analytics.cancelRate.map(c => c.total),
        backgroundColor: 'rgba(59,130,246,0.6)',
      },
      {
        label: '취소',
        data: analytics.cancelRate.map(c => c.cancelled),
        backgroundColor: 'rgba(239,68,68,0.7)',
      },
    ],
  } : null;

  const marketDoughnut = analytics ? {
    labels: analytics.byMarket.map(m => MKT[m.market_id] || m.market_id),
    datasets: [{
      data: analytics.byMarket.map(m => m.settlement),
      backgroundColor: analytics.byMarket.map(m => MKT_COLORS[m.market_id] || 'rgba(156,163,175,0.6)'),
    }],
  } : null;

  const shipData = analytics ? {
    labels: analytics.shipStatus.map(s => MKT[s.market_id] || s.market_id),
    datasets: [
      { label: '출고', data: analytics.shipStatus.map(s => s.shipped), backgroundColor: 'rgba(34,197,94,0.7)' },
      { label: '미출고', data: analytics.shipStatus.map(s => s.unshipped), backgroundColor: 'rgba(239,68,68,0.5)' },
    ],
  } : null;

  // KPI summary
  const totalOrders = analytics?.byMarket.reduce((s, m) => s + m.orders, 0) || 0;
  const totalSettlement = analytics?.byMarket.reduce((s, m) => s + m.settlement, 0) || 0;
  const totalCancelled = analytics?.byMarket.reduce((s, m) => s + m.cancelled, 0) || 0;
  const totalShipped = analytics?.shipStatus.reduce((s, m) => s + m.shipped, 0) || 0;
  const totalUnshipped = analytics?.shipStatus.reduce((s, m) => s + m.unshipped, 0) || 0;
  const cancelPct = totalOrders > 0 ? ((totalCancelled / totalOrders) * 100).toFixed(1) : '0';
  const shipPct = (totalShipped + totalUnshipped) > 0 ? ((totalShipped / (totalShipped + totalUnshipped)) * 100).toFixed(0) : '0';

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <div className="flex bg-mx-card border border-mx-border rounded overflow-hidden">
          {(['day', 'month', 'year'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs ${period === p ? 'bg-blue-600 text-white' : 'text-mx-text-secondary hover:bg-mx-border/30'}`}>
              {p === 'day' ? '일별' : p === 'month' ? '월별' : '연별'}
            </button>
          ))}
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text">
          <option value={7}>7일</option>
          <option value={30}>30일</option>
          <option value={90}>90일</option>
          <option value={180}>180일</option>
          <option value={365}>365일</option>
        </select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          { label: '총 주문', value: totalOrders + '건', color: 'text-blue-400' },
          { label: '정산액', value: fmtMan(totalSettlement) + '원', color: 'text-green-400' },
          { label: '취소율', value: cancelPct + '%', color: parseFloat(cancelPct) > 5 ? 'text-red-400' : 'text-mx-text' },
          { label: '출고율', value: shipPct + '%', color: 'text-emerald-400' },
          { label: '재주문 고객', value: (analytics?.repeatCustomers?.length || 0) + '명', color: 'text-amber-400' },
        ].map(k => (
          <Card key={k.label} className="!p-3 text-center">
            <p className="text-[10px] text-mx-text-secondary">{k.label}</p>
            <p className={`text-lg font-bold ${k.color}`}>{analyticsLoading ? '-' : k.value}</p>
          </Card>
        ))}
      </div>

      {/* Charts */}
      {analytics && !analyticsLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* 주문 추이 */}
          <Card className="!p-3">
            <h3 className="text-xs font-bold text-mx-text mb-2">주문 추이 (정산액)</h3>
            <div className="h-[180px]">
              {trendData && <Line data={trendData} options={{
                ...chartOpts,
                scales: {
                  ...chartOpts.scales,
                  y: { ...chartOpts.scales.y, ticks: { ...chartOpts.scales.y.ticks, callback: (v: string | number) => fmtMan(Number(v)) } },
                },
              }} />}
            </div>
          </Card>

          {/* 취소율 */}
          <Card className="!p-3">
            <h3 className="text-xs font-bold text-mx-text mb-2">취소 추이</h3>
            <div className="h-[180px]">
              {cancelData && <Bar data={cancelData} options={{
                ...chartOpts,
                plugins: { legend: { display: true, labels: { color: '#888', font: { size: 10 } } } },
              }} />}
            </div>
          </Card>

          {/* 마켓별 비중 */}
          <Card className="!p-3">
            <h3 className="text-xs font-bold text-mx-text mb-2">마켓별 정산 비중</h3>
            <div className="h-[180px] flex items-center justify-center">
              {marketDoughnut && <Doughnut data={marketDoughnut} options={{
                responsive: true, maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                  legend: { position: 'right', labels: { color: '#ccc', font: { size: 10 }, padding: 8 } },
                  tooltip: { callbacks: { label: (ctx: { label: string; raw: unknown }) => `${ctx.label}: ${fmtMan(Number(ctx.raw))}원` } },
                },
              }} />}
            </div>
            {/* Market detail */}
            <div className="mt-2 space-y-1">
              {analytics.byMarket.map(m => (
                <div key={m.market_id} className="flex justify-between text-[10px]">
                  <span className="text-mx-text-secondary">{MKT[m.market_id] || m.market_id}</span>
                  <span className="text-mx-text">{m.orders}건 / {fmtMan(m.settlement)}원 / 취소 {m.cancelled}건</span>
                </div>
              ))}
            </div>
          </Card>

          {/* 출고현황 */}
          <Card className="!p-3">
            <h3 className="text-xs font-bold text-mx-text mb-2">출고현황</h3>
            <div className="h-[180px]">
              {shipData && <Bar data={shipData} options={{
                ...chartOpts,
                plugins: { legend: { display: true, labels: { color: '#888', font: { size: 10 } } } },
                scales: {
                  ...chartOpts.scales,
                  x: { ...chartOpts.scales.x, stacked: true },
                  y: { ...chartOpts.scales.y, stacked: true },
                },
              }} />}
            </div>
          </Card>
        </div>
      )}

      {/* Repeat Customers */}
      {analytics && analytics.repeatCustomers.length > 0 && (
        <Card className="!p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-amber-400">재주문 고객 TOP {analytics.repeatCustomers.length}</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowRepeat(!showRepeat)}>
              {showRepeat ? '접기' : '펼치기'}
            </Button>
          </div>
          {showRepeat && (
            <div className="overflow-x-auto max-h-[300px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-mx-card">
                  <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                    <th className="py-1 pr-2">고객</th>
                    <th className="py-1 pr-2">유형</th>
                    <th className="py-1 pr-2 text-right">주문 회수</th>
                    <th className="py-1 pr-2 text-right">총 수량</th>
                    <th className="py-1 pr-2 text-right">총 정산</th>
                    <th className="py-1 pr-2">첫 주문</th>
                    <th className="py-1 pr-2">최근 주문</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.repeatCustomers.map((r, i) => (
                    <tr key={i} className="border-b border-mx-border/50">
                      <td className="py-1 pr-2">{r.key_val}</td>
                      <td className="py-1 pr-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.key_type === 'name' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'}`}>
                          {r.key_type === 'name' ? '수취인' : '통관부호'}
                        </span>
                      </td>
                      <td className="py-1 pr-2 text-right font-bold text-amber-400">{r.order_count}회</td>
                      <td className="py-1 pr-2 text-right">{r.total_qty}개</td>
                      <td className="py-1 pr-2 text-right">{formatKRW(r.total_settlement)}</td>
                      <td className="py-1 pr-2 text-mx-text-secondary">{r.first_date}</td>
                      <td className="py-1 pr-2">{r.last_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

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
                    <th className="py-1.5 pr-2">수취인</th>
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
                  {orders.map(o => {
                    const rc = getRepeatCount(o);
                    return (
                      <tr key={o.id} className="border-b border-mx-border/50 hover:bg-mx-border/10">
                        <td className="py-1.5 pr-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-mx-border/30">
                            {MKT[o.market_id] || o.market_id}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2">{o.sales_date}</td>
                        <td className="py-1.5 pr-2 font-mono text-xs">{o.order_id}</td>
                        <td className="py-1.5 pr-2">
                          <span className="truncate max-w-[80px] inline-block align-middle">{o.recipient_name}</span>
                          {rc >= 2 && (
                            <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-900/60 text-amber-300">
                              {rc}회
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 truncate max-w-[180px]">{o.product_name_raw}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{o.qty}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{formatKRW(o.settlement_amount)}</td>
                        <td className="py-1.5 pr-2 font-mono text-mx-cyan text-[10px]">{o.master_sku}</td>
                        <td className="py-1.5 pr-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[o.order_status] || ''}`}>
                            {o.order_status}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2">
                          {o.tracking_no ? (
                            <span className="font-mono text-[10px] text-green-400">{o.tracking_no}</span>
                          ) : (
                            <span className="text-[10px] text-red-400/60">미출고</span>
                          )}
                        </td>
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
                    );
                  })}
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
