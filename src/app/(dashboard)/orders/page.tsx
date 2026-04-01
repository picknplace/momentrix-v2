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
  ship_date: string;
  recipient_name: string;
  address: string;
  phone: string;
}

interface Analytics {
  trend: { period: string; orders: number; qty: number; settlement: number }[];
  byMarket: { market_id: string; orders: number; qty: number; settlement: number; cancelled: number }[];
  cancelRate: { period: string; total: number; cancelled: number }[];
  shipStatus: { market_id: string; shipped: number; unshipped: number }[];
  repeatCustomers: { key_val: string; key_type: string; order_count: number; total_qty: number; total_settlement: number; first_date: string; last_date: string; markets: string }[];
  repeatOrders: { key_val: string; market_id: string; sales_date: string; order_id: string }[];
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

type ViewMode = 'all' | 'unshipped' | 'cancelled';

export default function OrdersPage() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [marketFilter, setMarketFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('all');

  // Analytics
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [period, setPeriod] = useState<'day' | 'month' | 'year'>('day');
  const [days, setDays] = useState(30);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [showRepeat, setShowRepeat] = useState(false);
  const [showCharts, setShowCharts] = useState(true);

  // Repeat customer lookup
  const repeatMapRef = useRef<Map<string, number>>(new Map());
  const repeatOrdersMapRef = useRef<Map<string, { market_id: string; sales_date: string }[]>>(new Map());

  // Shipping: tracking inputs
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});

  // Cancel modal
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelDate, setCancelDate] = useState('');

  // Unshipped counts
  const [unshippedCounts, setUnshippedCounts] = useState<{ market_id: string; cnt: number }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);

    if (viewMode === 'unshipped') {
      // Use shipping API for unshipped
      const params = new URLSearchParams({ filter: 'unshipped' });
      if (marketFilter) params.set('marketId', marketFilter);
      const res = await api<{ orders: Order[]; unshippedCount: { market_id: string; cnt: number }[] }>(`shipping?${params}`);
      if (res?.ok) {
        setOrders(res.orders || []);
        setTotal(res.orders?.length || 0);
        setUnshippedCounts(res.unshippedCount || []);
      }
    } else {
      // Use orders API
      const params = new URLSearchParams({ page: String(page), limit: '100' });
      if (marketFilter) params.set('marketId', marketFilter);
      if (viewMode === 'cancelled') params.set('status', 'cancelled');
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const [ordRes, shipRes] = await Promise.all([
        api<{ orders: Order[]; total: number }>(`orders?${params}`),
        api<{ unshippedCount: { market_id: string; cnt: number }[] }>('shipping?filter=unshipped&limit=0'),
      ]);
      if (ordRes?.ok) {
        setOrders(ordRes.orders || []);
        setTotal(ordRes.total || 0);
      }
      if (shipRes?.ok) {
        setUnshippedCounts(shipRes.unshippedCount || []);
      }
    }
    setLoading(false);
  }, [page, marketFilter, dateFrom, dateTo, viewMode]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    const res = await api<Analytics>(`orders/analytics?period=${period}&days=${days}`);
    if (res?.ok) {
      const a = res as unknown as Analytics;
      setAnalytics(a);
      const m = new Map<string, number>();
      a.repeatCustomers?.forEach(r => { m.set(r.key_val, r.order_count); });
      repeatMapRef.current = m;
      // Build repeat orders map (platform flow per customer)
      const om = new Map<string, { market_id: string; sales_date: string }[]>();
      a.repeatOrders?.forEach(r => {
        if (!om.has(r.key_val)) om.set(r.key_val, []);
        om.get(r.key_val)!.push({ market_id: r.market_id, sales_date: r.sales_date });
      });
      repeatOrdersMapRef.current = om;
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

  const onSaveTracking = async (order: Order) => {
    const trackingNo = trackingInputs[order.order_id];
    if (!trackingNo?.trim()) { toast('송장번호를 입력하세요.', 'warn'); return; }
    const res = await api<{ ok: boolean; message: string }>('shipping', {
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

  const getRepeatCount = (o: Order) => repeatMapRef.current.get(o.recipient_name) || 0;

  const elapsed = (salesDate: string) => {
    const d = new Date(salesDate);
    const now = new Date();
    return Math.floor((now.getTime() - d.getTime()) / 86400000);
  };

  const totalUnshipped = unshippedCounts.reduce((s, c) => s + c.cnt, 0);

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
      { label: '전체', data: analytics.cancelRate.map(c => c.total), backgroundColor: 'rgba(59,130,246,0.6)' },
      { label: '취소', data: analytics.cancelRate.map(c => c.cancelled), backgroundColor: 'rgba(239,68,68,0.7)' },
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
  const totalUnshippedAll = analytics?.shipStatus.reduce((s, m) => s + m.unshipped, 0) || 0;
  const cancelPct = totalOrders > 0 ? ((totalCancelled / totalOrders) * 100).toFixed(1) : '0';
  const shipPct = (totalShipped + totalUnshippedAll) > 0 ? ((totalShipped / (totalShipped + totalUnshippedAll)) * 100).toFixed(0) : '0';

  return (
    <div className="space-y-4">
      {/* Period selector + chart toggle */}
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
        <Button variant="ghost" size="sm" onClick={() => setShowCharts(!showCharts)} className="ml-auto">
          {showCharts ? '차트 접기' : '차트 펼치기'}
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {[
          { label: '총 주문', value: totalOrders + '건', color: 'text-blue-400' },
          { label: '정산액', value: fmtMan(totalSettlement) + '원', color: 'text-green-400' },
          { label: '취소율', value: cancelPct + '%', color: parseFloat(cancelPct) > 5 ? 'text-red-400' : 'text-mx-text' },
          { label: '출고율', value: shipPct + '%', color: 'text-emerald-400' },
          { label: '미출고', value: totalUnshipped + '건', color: totalUnshipped > 0 ? 'text-red-400' : 'text-mx-text' },
          { label: '재주문 고객', value: (analytics?.repeatCustomers?.length || 0) + '명', color: 'text-amber-400' },
        ].map(k => (
          <Card key={k.label} className="!p-2 text-center">
            <p className="text-[10px] text-mx-text-secondary">{k.label}</p>
            <p className={`text-base font-bold ${k.color}`}>{analyticsLoading ? '-' : k.value}</p>
          </Card>
        ))}
      </div>

      {/* Charts */}
      {showCharts && analytics && !analyticsLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="!p-3">
            <h3 className="text-xs font-bold text-mx-text mb-2">주문 추이 (정산액)</h3>
            <div className="h-[160px]">
              {trendData && <Line data={trendData} options={{
                ...chartOpts,
                scales: {
                  ...chartOpts.scales,
                  y: { ...chartOpts.scales.y, ticks: { ...chartOpts.scales.y.ticks, callback: (v: string | number) => fmtMan(Number(v)) } },
                },
              }} />}
            </div>
          </Card>
          <Card className="!p-3">
            <h3 className="text-xs font-bold text-mx-text mb-2">취소 추이</h3>
            <div className="h-[160px]">
              {cancelData && <Bar data={cancelData} options={{
                ...chartOpts,
                plugins: { legend: { display: true, labels: { color: '#888', font: { size: 10 } } } },
              }} />}
            </div>
          </Card>
          <Card className="!p-3">
            <h3 className="text-xs font-bold text-mx-text mb-2">마켓별 정산</h3>
            <div className="h-[160px] flex items-center justify-center">
              {marketDoughnut && <Doughnut data={marketDoughnut} options={{
                responsive: true, maintainAspectRatio: false, cutout: '60%',
                plugins: {
                  legend: { position: 'right', labels: { color: '#ccc', font: { size: 10 }, padding: 8 } },
                  tooltip: { callbacks: { label: (ctx: { label: string; raw: unknown }) => `${ctx.label}: ${fmtMan(Number(ctx.raw))}원` } },
                },
              }} />}
            </div>
            <div className="mt-2 space-y-1">
              {analytics.byMarket.map(m => (
                <div key={m.market_id} className="flex justify-between text-[10px]">
                  <span className="text-mx-text-secondary">{MKT[m.market_id] || m.market_id}</span>
                  <span className="text-mx-text">{m.orders}건 / {fmtMan(m.settlement)}원 / 취소 {m.cancelled}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="!p-3">
            <h3 className="text-xs font-bold text-mx-text mb-2">출고현황</h3>
            <div className="h-[160px]">
              {shipData && <Bar data={shipData} options={{
                ...chartOpts,
                plugins: { legend: { display: true, labels: { color: '#888', font: { size: 10 } } } },
                scales: { ...chartOpts.scales, x: { ...chartOpts.scales.x, stacked: true }, y: { ...chartOpts.scales.y, stacked: true } },
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
            <div className="overflow-x-auto max-h-[250px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-mx-card">
                  <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                    <th className="py-1 pr-2">고객</th>
                    <th className="py-1 pr-2">유형</th>
                    <th className="py-1 pr-2 text-right">회수</th>
                    <th className="py-1 pr-2 text-right">수량</th>
                    <th className="py-1 pr-2 text-right">정산</th>
                    <th className="py-1 pr-2">플랫폼</th>
                    <th className="py-1 pr-2">주문 흐름</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.repeatCustomers.map((r, i) => {
                    const flow = repeatOrdersMapRef.current.get(r.key_val) || [];
                    const marketList = r.markets?.split(',') || [];
                    const isMultiPlatform = marketList.length > 1;
                    return (
                      <tr key={i} className={`border-b border-mx-border/50 ${isMultiPlatform ? 'bg-purple-900/10' : ''}`}>
                        <td className="py-1 pr-2">{r.key_val}</td>
                        <td className="py-1 pr-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.key_type === 'name' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'}`}>
                            {r.key_type === 'customs' ? '통관부호' : '수취인'}
                          </span>
                        </td>
                        <td className="py-1 pr-2 text-right font-bold text-amber-400">{r.order_count}회</td>
                        <td className="py-1 pr-2 text-right">{r.total_qty}개</td>
                        <td className="py-1 pr-2 text-right">{formatKRW(r.total_settlement)}</td>
                        <td className="py-1 pr-2">
                          {marketList.map(m => (
                            <span key={m} className="mr-1 px-1 py-0.5 rounded text-[9px] font-bold" style={{
                              backgroundColor: MKT_COLORS[m]?.replace('0.8', '0.2') || 'rgba(156,163,175,0.2)',
                              color: MKT_COLORS[m]?.replace('0.8', '1') || '#9ca3af',
                            }}>
                              {MKT[m] || m}
                            </span>
                          ))}
                          {isMultiPlatform && (
                            <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-purple-600/30 text-purple-300">이동</span>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-[10px] text-mx-text-secondary">
                          {flow.slice(0, 8).map((f, j) => (
                            <span key={j}>
                              {j > 0 && <span className="text-mx-text-secondary mx-0.5">→</span>}
                              <span className={j === 0 ? 'text-mx-text-secondary' : ''} style={{
                                color: MKT_COLORS[f.market_id]?.replace('0.8', '1') || '#9ca3af',
                              }}>
                                {MKT[f.market_id] || f.market_id}
                              </span>
                              <span className="text-mx-text-secondary">({f.sales_date.substring(5)})</span>
                            </span>
                          ))}
                          {flow.length > 8 && <span className="text-mx-text-secondary"> +{flow.length - 8}</span>}
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

      {/* View mode tabs + Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-mx-card border border-mx-border rounded overflow-hidden">
          <button onClick={() => { setViewMode('all'); setPage(1); }}
            className={`px-3 py-1 text-xs ${viewMode === 'all' ? 'bg-blue-600 text-white' : 'text-mx-text-secondary hover:bg-mx-border/30'}`}>
            전체
          </button>
          <button onClick={() => { setViewMode('unshipped'); setPage(1); }}
            className={`px-3 py-1 text-xs ${viewMode === 'unshipped' ? 'bg-red-600 text-white' : 'text-mx-text-secondary hover:bg-mx-border/30'}`}>
            미출고 ({totalUnshipped})
          </button>
          <button onClick={() => { setViewMode('cancelled'); setPage(1); }}
            className={`px-3 py-1 text-xs ${viewMode === 'cancelled' ? 'bg-amber-600 text-white' : 'text-mx-text-secondary hover:bg-mx-border/30'}`}>
            취소
          </button>
        </div>

        {/* Unshipped counts by market */}
        {unshippedCounts.map(c => (
          <span key={c.market_id} className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-300">
            {MKT[c.market_id] || c.market_id}: {c.cnt}
          </span>
        ))}

        <select value={marketFilter} onChange={e => { setMarketFilter(e.target.value); setPage(1); }}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text">
          <option value="">전체 마켓</option>
          <option value="dailyshot">Dailyshot</option>
          <option value="kihya">Kihya</option>
          <option value="dmonkey">드렁큰몽키</option>
        </select>
        {viewMode !== 'unshipped' && (
          <>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
            <span className="text-mx-text-secondary text-xs">~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => { setPage(1); load(); }}>조회</Button>
        <span className="text-xs text-mx-text-secondary ml-auto">{total}건</span>
      </div>

      {/* Orders Table */}
      <Card>
        {loading ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">로딩 중…</p>
        ) : orders.length === 0 ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">
            {viewMode === 'unshipped' ? '미출고 주문이 없습니다.' : '주문이 없습니다.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-mx-card">
                  <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                    <th className="py-1.5 pr-2">마켓</th>
                    <th className="py-1.5 pr-2">매출일</th>
                    {viewMode === 'unshipped' && <th className="py-1.5 pr-2">경과</th>}
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
                    const days_elapsed = elapsed(o.sales_date);
                    const urgent = viewMode === 'unshipped' && days_elapsed >= 3;
                    return (
                      <tr key={o.id} className={`border-b border-mx-border/50 hover:bg-mx-border/10 ${urgent ? 'bg-red-900/10' : ''}`}>
                        <td className="py-1.5 pr-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-mx-border/30">
                            {MKT[o.market_id] || o.market_id}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2">{o.sales_date}</td>
                        {viewMode === 'unshipped' && (
                          <td className={`py-1.5 pr-2 font-mono ${urgent ? 'text-red-400 font-bold' : 'text-mx-text-secondary'}`}>
                            D+{days_elapsed}
                          </td>
                        )}
                        <td className="py-1.5 pr-2 font-mono text-xs">{o.order_id}</td>
                        <td className="py-1.5 pr-2">
                          <span className="truncate max-w-[80px] inline-block align-middle">{o.recipient_name}</span>
                          {rc >= 2 && (
                            <span className="ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-900/60 text-amber-300">
                              {rc}회
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 truncate max-w-[160px]">{o.product_name_raw}</td>
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
                          ) : o.order_status === 'normal' ? (
                            <input
                              type="text"
                              value={trackingInputs[o.order_id] || ''}
                              onChange={e => setTrackingInputs(prev => ({ ...prev, [o.order_id]: e.target.value }))}
                              placeholder="송장번호"
                              className="bg-mx-bg border border-mx-border rounded px-1.5 py-0.5 text-xs text-mx-text w-[110px]"
                            />
                          ) : (
                            <span className="text-[10px] text-mx-text-secondary">-</span>
                          )}
                        </td>
                        <td className="py-1.5 whitespace-nowrap">
                          {!o.tracking_no && trackingInputs[o.order_id] && (
                            <Button variant="success" size="sm" onClick={() => onSaveTracking(o)}>저장</Button>
                          )}
                          {o.order_status === 'normal' && o.tracking_no && !trackingInputs[o.order_id] && (
                            <Button variant="danger" size="sm" onClick={() => {
                              setCancelTarget(o);
                              setCancelDate(new Date().toISOString().substring(0, 10));
                            }}>취소</Button>
                          )}
                          {o.order_status === 'normal' && !o.tracking_no && !trackingInputs[o.order_id] && (
                            <Button variant="danger" size="sm" onClick={() => {
                              setCancelTarget(o);
                              setCancelDate(new Date().toISOString().substring(0, 10));
                            }}>취소</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination (not for unshipped) */}
            {viewMode !== 'unshipped' && (
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
            )}
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
