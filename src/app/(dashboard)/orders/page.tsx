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

/* ── Types ── */
interface Order {
  id: number; import_id: string; market_id: string; sales_date: string;
  order_id: string; sub_order_id: string; master_sku: string;
  product_name_raw: string; qty: number; sales_amount: number; settlement_amount: number;
  order_status: string; tracking_no: string; ship_date: string;
  recipient_name: string; customs_id: string;
  delivery_status: string; delivery_status_dt: string;
}
interface Analytics {
  trend: { period: string; orders: number; qty: number; settlement: number }[];
  byMarket: { market_id: string; orders: number; qty: number; settlement: number; cancelled: number }[];
  cancelRate: { period: string; total: number; cancelled: number }[];
  shipStatus: { market_id: string; shipped: number; unshipped: number }[];
  repeatCustomers: { customs_id: string; recipient_name: string; order_count: number; total_qty: number; total_settlement: number; first_date: string; last_date: string; markets: string; cancelled: number; avg_amount: number }[];
  repeatOrders: { customs_id: string; market_id: string; sales_date: string; product_name_raw: string; qty: number; settlement_amount: number }[];
}

/* ── Constants ── */
const MKT: Record<string, string> = { dailyshot: '데일리샷', kihya: '키하', dmonkey: '드몽' };
const MKT_SHORT: Record<string, string> = { dailyshot: 'DS', kihya: 'KH', dmonkey: 'DM' };
const MKT_COLORS: Record<string, string> = { dailyshot: 'rgba(59,130,246,0.8)', kihya: 'rgba(34,197,94,0.8)', dmonkey: 'rgba(249,115,22,0.8)' };

// Delivery pipeline stages
const PIPELINE = [
  { key: '오더접수', color: 'border-gray-500 text-gray-300' },
  { key: '픽업', color: 'border-gray-500 text-gray-300' },
  { key: '창고반입', color: 'border-gray-500 text-gray-300' },
  { key: '창고반출', color: 'border-gray-500 text-gray-300' },
  { key: '항공출발', color: 'border-gray-500 text-gray-300' },
  { key: '항공도착', color: 'border-yellow-500 text-yellow-300' },
  { key: '장치장반입', color: 'border-gray-500 text-gray-300' },
  { key: '장치장반출', color: 'border-gray-500 text-gray-300' },
  { key: '통관진행', color: 'border-green-500 text-green-300' },
  { key: '통관완료', color: 'border-green-500 text-green-300' },
  { key: '택배배송중', color: 'border-blue-500 text-blue-300' },
  { key: '배송완료', color: 'border-purple-500 text-purple-300' },
];

const chartOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
    y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
  },
};

function fmtMan(v: number) { return Math.round(v / 10000).toLocaleString() + '만'; }
function fmtN(v: number) { return v.toLocaleString(); }
function cleanTrackingNo(v: string) { if (!v) return ''; const s = String(v); return s.endsWith('.0') ? s.slice(0, -2) : s; }
function elapsed(salesDate: string) { return Math.floor((Date.now() - new Date(salesDate).getTime()) / 86400000); }

type ShipFilter = 'all' | 'unshipped' | 'shipped';
type Tab = 'list' | 'analytics';

export default function OrdersPage() {
  const { toast } = useToast();

  /* ── Tab ── */
  const [tab, setTab] = useState<Tab>('list');

  /* ── List state ── */
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [unshippedCnt, setUnshippedCnt] = useState(0);
  const [shippedCnt, setShippedCnt] = useState(0);
  const [deliveryCounts, setDeliveryCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [shipFilter, setShipFilter] = useState<ShipFilter>('all');
  const [marketFilter, setMarketFilter] = useState('');
  const [deliveryFilter, setDeliveryFilter] = useState('');
  const [search, setSearch] = useState('');

  // Tracking inputs
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});

  // Cancel modal
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelDate, setCancelDate] = useState('');

  /* ── Analytics state ── */
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [period, setPeriod] = useState<'day' | 'month' | 'year'>('day');
  const [days, setDays] = useState(30);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [showRepeat, setShowRepeat] = useState(false);
  const repeatMapRef = useRef<Map<string, number>>(new Map());
  const repeatOrdersMapRef = useRef<Map<string, { market_id: string; sales_date: string; product_name_raw: string; qty: number; settlement_amount: number }[]>>(new Map());

  /* ── Load list ── */
  const loadList = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ shipFilter, page: String(page), limit: '200' });
    if (marketFilter) params.set('marketId', marketFilter);
    if (deliveryFilter) params.set('deliveryStatus', deliveryFilter);
    if (search) params.set('search', search);

    const res = await api<{
      orders: Order[]; total: number; unshipped: number; shipped: number;
      deliveryCounts: { delivery_status: string; cnt: number }[];
    }>(`shipping?${params}`);

    if (res?.ok) {
      setOrders(res.orders || []);
      setTotal(res.total || 0);
      setUnshippedCnt(res.unshipped || 0);
      setShippedCnt(res.shipped || 0);
      const dc: Record<string, number> = {};
      res.deliveryCounts?.forEach(d => { dc[d.delivery_status || ''] = d.cnt; });
      setDeliveryCounts(dc);
    }
    setLoading(false);
  }, [shipFilter, marketFilter, deliveryFilter, search, page]);

  /* ── Load analytics ── */
  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    const res = await api<Analytics>(`orders/analytics?period=${period}&days=${days}`);
    if (res?.ok) {
      const a = res as unknown as Analytics;
      setAnalytics(a);
      const m = new Map<string, number>();
      a.repeatCustomers?.forEach(r => { m.set(r.customs_id, r.order_count); });
      repeatMapRef.current = m;
      const om = new Map<string, { market_id: string; sales_date: string; product_name_raw: string; qty: number; settlement_amount: number }[]>();
      a.repeatOrders?.forEach(r => {
        if (!om.has(r.customs_id)) om.set(r.customs_id, []);
        om.get(r.customs_id)!.push({ market_id: r.market_id, sales_date: r.sales_date, product_name_raw: r.product_name_raw, qty: r.qty, settlement_amount: r.settlement_amount });
      });
      repeatOrdersMapRef.current = om;
    }
    setAnalyticsLoading(false);
  }, [period, days]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (tab === 'analytics') loadAnalytics(); }, [tab, loadAnalytics]);

  /* ── Actions ── */
  const doCancel = async () => {
    if (!cancelTarget) return;
    const orderId = cancelTarget.market_id === 'kihya' ? cancelTarget.sub_order_id : cancelTarget.order_id;
    const res = await api<{ ok: boolean; message: string }>('orders', {
      action: 'cancel', market_id: cancelTarget.market_id, order_id: orderId,
      reason: cancelReason, cancel_date: cancelDate,
    });
    if (res?.ok) { toast(res.message, 'success'); setCancelTarget(null); loadList(); }
    else toast(res?.message || '취소 실패', 'error');
  };

  const onSaveTracking = async (order: Order) => {
    const trackingNo = trackingInputs[order.order_id];
    if (!trackingNo?.trim()) { toast('송장번호를 입력하세요.', 'warn'); return; }
    const res = await api<{ ok: boolean; message: string }>('shipping', {
      updates: [{ order_id: order.order_id, sub_order_id: order.sub_order_id, tracking_no: trackingNo.trim() }],
    });
    if (res?.ok) {
      toast('송장번호 저장 완료', 'success');
      setTrackingInputs(prev => { const n = { ...prev }; delete n[order.order_id]; return n; });
      loadList();
    } else toast(res?.message || '저장 실패', 'error');
  };

  const getRepeatCount = (o: Order) => repeatMapRef.current.get(o.customs_id) || 0;

  /* ── Chart data ── */
  const trendData = analytics ? {
    labels: analytics.trend.map(t => period === 'day' ? t.period.substring(5, 10) : t.period),
    datasets: [{ label: '정산액', data: analytics.trend.map(t => t.settlement), borderColor: 'rgba(59,130,246,0.9)', backgroundColor: 'rgba(59,130,246,0.15)', fill: true, tension: 0.4, pointRadius: 2 }],
  } : null;
  const cancelData = analytics ? {
    labels: analytics.cancelRate.map(c => period === 'day' ? c.period.substring(5, 10) : c.period),
    datasets: [
      { label: '전체', data: analytics.cancelRate.map(c => c.total), backgroundColor: 'rgba(59,130,246,0.6)' },
      { label: '취소', data: analytics.cancelRate.map(c => c.cancelled), backgroundColor: 'rgba(239,68,68,0.7)' },
    ],
  } : null;
  const marketDoughnut = analytics ? {
    labels: analytics.byMarket.map(m => MKT[m.market_id] || m.market_id),
    datasets: [{ data: analytics.byMarket.map(m => m.settlement), backgroundColor: analytics.byMarket.map(m => MKT_COLORS[m.market_id] || 'rgba(156,163,175,0.6)') }],
  } : null;
  const shipChartData = analytics ? {
    labels: analytics.shipStatus.map(s => MKT_SHORT[s.market_id] || s.market_id),
    datasets: [
      { label: '출고', data: analytics.shipStatus.map(s => s.shipped), backgroundColor: 'rgba(34,197,94,0.7)' },
      { label: '미출고', data: analytics.shipStatus.map(s => s.unshipped), backgroundColor: 'rgba(239,68,68,0.5)' },
    ],
  } : null;

  const totalOrders = analytics?.byMarket.reduce((s, m) => s + m.orders, 0) || 0;
  const totalSettlement = analytics?.byMarket.reduce((s, m) => s + m.settlement, 0) || 0;
  const totalCancelled = analytics?.byMarket.reduce((s, m) => s + m.cancelled, 0) || 0;
  const cancelPct = totalOrders > 0 ? ((totalCancelled / totalOrders) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-bold text-mx-text">주문 리스트</h2>
        <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-600 text-white">미출 {fmtN(unshippedCnt)}건</span>
        <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-600 text-white">출고 {fmtN(shippedCnt)}건</span>

        <div className="ml-auto flex gap-2">
          {/* Tab toggle */}
          <div className="flex bg-mx-card border border-mx-border rounded overflow-hidden">
            <button onClick={() => setTab('list')}
              className={`px-3 py-1 text-xs ${tab === 'list' ? 'bg-blue-600 text-white' : 'text-mx-text-secondary hover:bg-mx-border/30'}`}>
              주문목록
            </button>
            <button onClick={() => setTab('analytics')}
              className={`px-3 py-1 text-xs ${tab === 'analytics' ? 'bg-blue-600 text-white' : 'text-mx-text-secondary hover:bg-mx-border/30'}`}>
              분석
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={loadList}>갱신</Button>
        </div>
      </div>

      {/* ── Delivery Pipeline ── */}
      <div className="flex flex-wrap gap-1">
        {PIPELINE.map(s => {
          const cnt = deliveryCounts[s.key] || 0;
          return (
            <button key={s.key} onClick={() => { setDeliveryFilter(deliveryFilter === s.key ? '' : s.key); setPage(1); }}
              className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
                deliveryFilter === s.key ? 'bg-white/10 font-bold' : ''
              } ${cnt > 0 ? s.color : 'border-mx-border/50 text-mx-text-secondary/50'}`}>
              {s.key}{cnt > 0 ? ` ${fmtN(cnt)}` : ''}
            </button>
          );
        })}
      </div>

      {tab === 'list' ? (
        <>
          {/* ── Filter bars ── */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Ship status */}
            <div className="flex border border-mx-border rounded overflow-hidden">
              {([['all', '전체'], ['unshipped', '미출고'], ['shipped', '출고완료']] as const).map(([k, label]) => (
                <button key={k} onClick={() => { setShipFilter(k); setPage(1); }}
                  className={`px-2.5 py-1 text-xs ${shipFilter === k
                    ? k === 'unshipped' ? 'bg-red-600 text-white' : k === 'shipped' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'
                    : 'text-mx-text-secondary hover:bg-mx-border/30'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Market */}
            <div className="flex border border-mx-border rounded overflow-hidden">
              <button onClick={() => { setMarketFilter(''); setPage(1); }}
                className={`px-2.5 py-1 text-xs ${!marketFilter ? 'bg-blue-600 text-white' : 'text-mx-text-secondary hover:bg-mx-border/30'}`}>전체</button>
              {Object.entries(MKT).map(([id, label]) => (
                <button key={id} onClick={() => { setMarketFilter(marketFilter === id ? '' : id); setPage(1); }}
                  className={`px-2.5 py-1 text-xs ${marketFilter === id ? 'bg-blue-600 text-white' : 'text-mx-text-secondary hover:bg-mx-border/30'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Delivery filter shortcuts */}
            <div className="flex border border-mx-border rounded overflow-hidden">
              {[['', '전체'], ['미조회', '미조회'], ['택배배송중', '배송중'], ['통관진행', '통관'], ['배송완료', '배송완료']].map(([k, label]) => (
                <button key={k} onClick={() => { setDeliveryFilter(deliveryFilter === k ? '' : k); setPage(1); }}
                  className={`px-2.5 py-1 text-xs ${deliveryFilter === k ? 'bg-blue-600 text-white' : 'text-mx-text-secondary hover:bg-mx-border/30'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Search */}
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setPage(1); loadList(); } }}
              placeholder="주문번호/상품명 검색"
              className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-[180px]" />

            <span className="text-xs text-mx-text-secondary ml-auto">{fmtN(total)}건</span>
          </div>

          {/* ── Orders Table ── */}
          <Card className="!p-0">
            {loading ? (
              <p className="text-xs text-mx-text-secondary py-4 text-center">로딩 중…</p>
            ) : orders.length === 0 ? (
              <p className="text-xs text-mx-text-secondary py-4 text-center">주문이 없습니다.</p>
            ) : (
              <>
                <div className="overflow-x-auto max-h-[calc(100vh-320px)]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-mx-card z-10">
                      <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                        <th className="py-1.5 px-2">상태</th>
                        <th className="py-1.5 px-2">플랫폼</th>
                        <th className="py-1.5 px-2">주문번호</th>
                        <th className="py-1.5 px-2">SKU</th>
                        <th className="py-1.5 px-2">상품명</th>
                        <th className="py-1.5 px-2 text-right">수량</th>
                        <th className="py-1.5 px-2">수취인</th>
                        <th className="py-1.5 px-2">접수일</th>
                        <th className="py-1.5 px-2">경과</th>
                        <th className="py-1.5 px-2">송장번호</th>
                        <th className="py-1.5 px-2">발송일</th>
                        <th className="py-1.5 px-2">배송상태</th>
                        <th className="py-1.5 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => {
                        const d = elapsed(o.sales_date);
                        const hasTracking = o.tracking_no && o.tracking_no !== '';
                        const urgent = !hasTracking && d >= 3;
                        const rc = getRepeatCount(o);
                        return (
                          <tr key={o.id} className={`border-b border-mx-border/50 hover:bg-mx-border/10 ${urgent ? 'bg-red-900/10' : ''}`}>
                            {/* 상태 */}
                            <td className="py-1.5 px-2">
                              {hasTracking ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/50 text-green-300">출고</span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-900/50 text-red-300">미출고</span>
                              )}
                            </td>
                            {/* 플랫폼 */}
                            <td className="py-1.5 px-2 text-[11px]">{MKT[o.market_id] || o.market_id}</td>
                            {/* 주문번호 */}
                            <td className="py-1.5 px-2 font-mono">{o.order_id}</td>
                            {/* SKU */}
                            <td className="py-1.5 px-2 font-mono text-mx-cyan text-[10px]">{o.master_sku}</td>
                            {/* 상품명 */}
                            <td className="py-1.5 px-2 truncate max-w-[200px]">{o.product_name_raw}</td>
                            {/* 수량 */}
                            <td className="py-1.5 px-2 text-right font-mono">{o.qty}</td>
                            {/* 수취인 */}
                            <td className="py-1.5 px-2">
                              {o.recipient_name}
                              {rc >= 2 && (
                                <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-900/60 text-amber-300">{rc}회</span>
                              )}
                            </td>
                            {/* 접수일 */}
                            <td className="py-1.5 px-2">{o.sales_date}</td>
                            {/* 경과 */}
                            <td className="py-1.5 px-2">
                              {!hasTracking ? (
                                <span className={`font-mono font-bold ${d >= 7 ? 'text-red-400' : d >= 3 ? 'text-amber-400' : 'text-mx-text-secondary'}`}>
                                  {d}일
                                </span>
                              ) : (
                                <span className="text-mx-text-secondary">—</span>
                              )}
                            </td>
                            {/* 송장번호 */}
                            <td className="py-1.5 px-2">
                              {hasTracking ? (
                                <span className="font-mono text-[10px] text-green-400">{cleanTrackingNo(o.tracking_no)}</span>
                              ) : (
                                <input type="text" value={trackingInputs[o.order_id] || ''}
                                  onChange={e => setTrackingInputs(prev => ({ ...prev, [o.order_id]: e.target.value }))}
                                  placeholder="송장번호"
                                  className="bg-mx-bg border border-mx-border rounded px-1.5 py-0.5 text-xs text-mx-text w-[110px]" />
                              )}
                            </td>
                            {/* 발송일 */}
                            <td className="py-1.5 px-2 text-mx-text-secondary">{o.ship_date || '—'}</td>
                            {/* 배송상태 */}
                            <td className="py-1.5 px-2">
                              {o.delivery_status ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-mx-border/30">{o.delivery_status}</span>
                              ) : '—'}
                            </td>
                            {/* 액션 */}
                            <td className="py-1.5 px-2 whitespace-nowrap">
                              {!hasTracking && trackingInputs[o.order_id] && (
                                <Button variant="success" size="sm" onClick={() => onSaveTracking(o)}>저장</Button>
                              )}
                              {!hasTracking && !trackingInputs[o.order_id] && (
                                <Button variant="danger" size="sm" onClick={() => {
                                  setCancelTarget(o); setCancelDate(new Date().toISOString().substring(0, 10));
                                }}>취소</Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-center gap-2 py-2 border-t border-mx-border">
                  <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← 이전</Button>
                  <span className="text-xs text-mx-text-secondary">{page} / {Math.ceil(total / 200) || 1}</span>
                  <Button variant="ghost" size="sm" disabled={page * 200 >= total} onClick={() => setPage(p => p + 1)}>다음 →</Button>
                </div>
              </>
            )}
          </Card>
        </>
      ) : (
        /* ── Analytics Tab ── */
        <div className="space-y-3">
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
              <option value={7}>7일</option><option value={30}>30일</option>
              <option value={90}>90일</option><option value={180}>180일</option><option value={365}>365일</option>
            </select>
          </div>

          {/* KPI */}
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {[
              { label: '총 주문', value: fmtN(totalOrders) + '건', color: 'text-blue-400' },
              { label: '정산액', value: fmtMan(totalSettlement) + '원', color: 'text-green-400' },
              { label: '취소율', value: cancelPct + '%', color: parseFloat(cancelPct) > 5 ? 'text-red-400' : 'text-mx-text' },
              { label: '미출고', value: fmtN(unshippedCnt) + '건', color: unshippedCnt > 0 ? 'text-red-400' : 'text-mx-text' },
              { label: '재주문 고객', value: fmtN(analytics?.repeatCustomers?.length || 0) + '명', color: 'text-amber-400' },
            ].map(k => (
              <Card key={k.label} className="!p-2 text-center">
                <p className="text-[10px] text-mx-text-secondary">{k.label}</p>
                <p className={`text-base font-bold ${k.color}`}>{analyticsLoading ? '-' : k.value}</p>
              </Card>
            ))}
          </div>

          {/* Charts */}
          {analytics && !analyticsLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Card className="!p-3">
                <h3 className="text-xs font-bold text-mx-text mb-2">주문 추이 (정산액)</h3>
                <div className="h-[160px]">
                  {trendData && <Line data={trendData} options={{ ...chartOpts, scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, ticks: { ...chartOpts.scales.y.ticks, callback: (v: string | number) => fmtMan(Number(v)) } } } }} />}
                </div>
              </Card>
              <Card className="!p-3">
                <h3 className="text-xs font-bold text-mx-text mb-2">취소 추이</h3>
                <div className="h-[160px]">
                  {cancelData && <Bar data={cancelData} options={{ ...chartOpts, plugins: { legend: { display: true, labels: { color: '#888', font: { size: 10 } } } } }} />}
                </div>
              </Card>
              <Card className="!p-3">
                <h3 className="text-xs font-bold text-mx-text mb-2">마켓별 정산</h3>
                <div className="h-[160px] flex items-center justify-center">
                  {marketDoughnut && <Doughnut data={marketDoughnut} options={{ responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { color: '#ccc', font: { size: 10 }, padding: 8 } }, tooltip: { callbacks: { label: (ctx: { label: string; raw: unknown }) => `${ctx.label}: ${fmtMan(Number(ctx.raw))}원` } } } }} />}
                </div>
              </Card>
              <Card className="!p-3">
                <h3 className="text-xs font-bold text-mx-text mb-2">출고현황</h3>
                <div className="h-[160px]">
                  {shipChartData && <Bar data={shipChartData} options={{ ...chartOpts, plugins: { legend: { display: true, labels: { color: '#888', font: { size: 10 } } } }, scales: { ...chartOpts.scales, x: { ...chartOpts.scales.x, stacked: true }, y: { ...chartOpts.scales.y, stacked: true } } }} />}
                </div>
              </Card>
            </div>
          )}

          {/* Repeat customers */}
          {analytics && analytics.repeatCustomers.length > 0 && (
            <Card className="!p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-amber-400">재주문 고객 TOP {analytics.repeatCustomers.length}</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowRepeat(!showRepeat)}>{showRepeat ? '접기' : '펼치기'}</Button>
              </div>
              {showRepeat && (
                <div className="overflow-x-auto max-h-[400px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-mx-card">
                      <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                        <th className="py-1.5 pr-2 align-middle">통관부호</th>
                        <th className="py-1.5 pr-2 align-middle text-right">회수</th>
                        <th className="py-1.5 pr-2 align-middle text-right">총 수량</th>
                        <th className="py-1.5 pr-2 align-middle text-right">총 정산</th>
                        <th className="py-1.5 pr-2 align-middle">플랫폼</th>
                        <th className="py-1.5 pr-2 align-middle">주문 이력</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.repeatCustomers.map((r, i) => {
                        const flow = repeatOrdersMapRef.current.get(r.customs_id) || [];
                        const marketList = r.markets?.split(',') || [];
                        const isMultiPlatform = marketList.length > 1;
                        return (
                          <tr key={i} className={`border-b border-mx-border/50 align-top ${isMultiPlatform ? 'bg-purple-900/10' : ''}`}>
                            <td className="py-1.5 pr-2 align-middle">
                              <span className="font-mono text-[10px]">{r.customs_id}</span>
                              {r.recipient_name && <span className="ml-1 text-mx-text-secondary text-[10px]">({r.recipient_name})</span>}
                            </td>
                            <td className="py-1.5 pr-2 text-right font-bold text-amber-400 align-middle">{fmtN(r.order_count)}회</td>
                            <td className="py-1.5 pr-2 text-right align-middle">{fmtN(r.total_qty)}개</td>
                            <td className="py-1.5 pr-2 text-right align-middle">{formatKRW(r.total_settlement)}</td>
                            <td className="py-1.5 pr-2 align-middle">
                              {marketList.map(m => (
                                <span key={m} className="mr-1 px-1 py-0.5 rounded text-[9px] font-bold" style={{
                                  backgroundColor: MKT_COLORS[m]?.replace('0.8', '0.2') || 'rgba(156,163,175,0.2)',
                                  color: MKT_COLORS[m]?.replace('0.8', '1') || '#9ca3af',
                                }}>{MKT_SHORT[m] || m}</span>
                              ))}
                              {isMultiPlatform && <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-purple-600/30 text-purple-300">이동</span>}
                            </td>
                            <td className="py-1.5 pr-2">
                              <div className="space-y-0.5">
                                {flow.map((f, j) => (
                                  <div key={j} className="flex items-center gap-1 text-[10px]">
                                    <span className="w-3 text-center text-mx-text-secondary">{j + 1}</span>
                                    <span className="px-1 py-0.5 rounded text-[9px] font-bold" style={{
                                      backgroundColor: MKT_COLORS[f.market_id]?.replace('0.8', '0.2') || 'rgba(156,163,175,0.2)',
                                      color: MKT_COLORS[f.market_id]?.replace('0.8', '1') || '#9ca3af',
                                    }}>{MKT_SHORT[f.market_id] || f.market_id}</span>
                                    <span className="text-mx-text-secondary">{f.sales_date.substring(5, 10)}</span>
                                    <span className="text-mx-text truncate max-w-[120px]">{f.product_name_raw}</span>
                                    <span className="text-mx-text-secondary">x{f.qty}</span>
                                    <span className="text-green-400">{fmtN(f.settlement_amount)}원</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ── Cancel Modal ── */}
      {cancelTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-mx-card border border-mx-border rounded-lg p-5 w-[400px]">
            <h3 className="text-sm font-bold text-mx-text mb-3">주문 취소</h3>
            <p className="text-xs text-mx-text-secondary mb-3">{cancelTarget.order_id} — {cancelTarget.product_name_raw}</p>
            <div className="space-y-2 mb-4">
              <div>
                <label className="block text-xs text-mx-text-secondary mb-1">취소일</label>
                <input type="date" value={cancelDate} onChange={e => setCancelDate(e.target.value)}
                  className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-full" />
              </div>
              <div>
                <label className="block text-xs text-mx-text-secondary mb-1">사유</label>
                <input type="text" value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="취소 사유"
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
