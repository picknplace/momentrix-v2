'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatKRW, formatNumber, formatPercent } from '@/lib/utils/currency';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Filler,
);

export const runtime = 'edge';

interface DashKpi {
  totalOrders: number;
  totalQty: number;
  totalSales: number;
  totalSettlement: number;
  totalSkus: number;
  unshippedCount: number;
  shippedCount: number;
  avgDailySettlement: number;
  topMarket: string;
  topMarketSettlement: number;
  cancelCount: number;
  cancelAmount: number;
  cancelRate: number;
}

interface DailyRow {
  sales_date: string;
  order_count: number;
  qty_total: number;
  sales_total: number;
  settlement_total: number;
}

interface DailyMarketRow {
  sales_date: string;
  market_id: string;
  settlement_total: number;
}

interface MarketRow {
  market_id: string;
  order_count: number;
  qty_total: number;
  sales_total: number;
  settlement_total: number;
}

interface SkuRow {
  master_sku: string;
  product_name_raw: string;
  qty_total: number;
  settlement_total: number;
  order_count: number;
}

interface ShippedDailyRow {
  ship_date: string;
  shipped_qty: number;
  shipped_count: number;
}

type QuickFilter = 'month' | 1 | 7 | 30 | 90 | 0;

const MARKET_LABELS: Record<string, string> = {
  dailyshot: 'Dailyshot', kihya: 'Kihya', dmonkey: '드렁큰몽키',
};
const MARKET_COLORS: Record<string, string> = {
  dailyshot: '#3B82F6', kihya: '#F59E0B', dmonkey: '#10B981',
};

function getDateRange(q: QuickFilter): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().substring(0, 10);
  if (q === 0) return { from: '', to: '' };
  if (q === 'month') {
    const y = now.getFullYear(), m = now.getMonth() + 1;
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const monthTo = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { from, to: monthTo };
  }
  const d = new Date(now.getTime() - (q as number) * 86400000);
  return { from: d.toISOString().substring(0, 10), to };
}

const chartOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94A3B8', font: { size: 10 } } },
  },
  scales: {
    x: { ticks: { color: '#64748B', font: { size: 9 } }, grid: { color: '#1E293B' } },
    y: { ticks: { color: '#64748B', font: { size: 9 } }, grid: { color: '#1E293B' } },
  },
};

export default function DashboardPage() {
  const { toast } = useToast();
  const [quick, setQuick] = useState<QuickFilter>('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState<DashKpi | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [dailyByMarket, setDailyByMarket] = useState<DailyMarketRow[]>([]);
  const [byMarket, setByMarket] = useState<MarketRow[]>([]);
  const [topSkus, setTopSkus] = useState<SkuRow[]>([]);
  const [shippedDaily, setShippedDaily] = useState<ShippedDailyRow[]>([]);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);

    const res = await api<{
      kpi: DashKpi; daily: DailyRow[]; dailyByMarket: DailyMarketRow[];
      byMarket: MarketRow[]; topSkus: SkuRow[]; shippedDaily: ShippedDailyRow[];
    }>(`dashboard?${params}`);

    if (res?.ok) {
      setKpi(res.kpi);
      setDaily(res.daily);
      setDailyByMarket(res.dailyByMarket || []);
      setByMarket(res.byMarket);
      setTopSkus(res.topSkus);
      setShippedDaily(res.shippedDaily || []);
    } else {
      toast('대시보드 로드 실패', 'error');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    const range = getDateRange(quick);
    setDateFrom(range.from);
    setDateTo(range.to);
    load(range.from, range.to);
  }, [quick, load]);

  // Chart data: Settlement trend by market
  const trendData = useMemo(() => {
    const dates = [...new Set(dailyByMarket.map(d => d.sales_date))].sort();
    const markets = [...new Set(dailyByMarket.map(d => d.market_id))];
    return {
      labels: dates.map(d => d.substring(5)),
      datasets: markets.map(m => ({
        label: MARKET_LABELS[m] || m,
        data: dates.map(d => {
          const row = dailyByMarket.find(r => r.sales_date === d && r.market_id === m);
          return row ? row.settlement_total : 0;
        }),
        borderColor: MARKET_COLORS[m] || '#6366F1',
        backgroundColor: (MARKET_COLORS[m] || '#6366F1') + '20',
        tension: 0.3,
        fill: true,
        pointRadius: 1,
      })),
    };
  }, [dailyByMarket]);

  // Chart data: Market share doughnut
  const shareData = useMemo(() => ({
    labels: byMarket.map(m => MARKET_LABELS[m.market_id] || m.market_id),
    datasets: [{
      data: byMarket.map(m => m.settlement_total),
      backgroundColor: byMarket.map(m => MARKET_COLORS[m.market_id] || '#6366F1'),
      borderWidth: 0,
    }],
  }), [byMarket]);

  // Chart data: Market comparison bar
  const marketBarData = useMemo(() => ({
    labels: byMarket.map(m => MARKET_LABELS[m.market_id] || m.market_id),
    datasets: [
      {
        label: '정산',
        data: byMarket.map(m => m.settlement_total),
        backgroundColor: '#3B82F6',
      },
      {
        label: '매출',
        data: byMarket.map(m => m.sales_total),
        backgroundColor: '#3B82F640',
      },
    ],
  }), [byMarket]);

  // Chart data: SKU Top 10 bar
  const skuBarData = useMemo(() => ({
    labels: topSkus.map(s => s.product_name_raw?.substring(0, 15) || s.master_sku),
    datasets: [{
      label: '정산',
      data: topSkus.map(s => s.settlement_total),
      backgroundColor: '#10B981',
    }],
  }), [topSkus]);

  // Chart data: Daily shipment
  const shipData = useMemo(() => ({
    labels: shippedDaily.map(d => d.ship_date.substring(5)),
    datasets: [{
      label: '출고 수량',
      data: shippedDaily.map(d => d.shipped_qty),
      backgroundColor: '#8B5CF6',
    }],
  }), [shippedDaily]);

  const quickButtons: { label: string; val: QuickFilter }[] = [
    { label: '전체', val: 0 },
    { label: '오늘', val: 1 },
    { label: '7일', val: 7 },
    { label: '당월', val: 'month' },
    { label: '30일', val: 30 },
    { label: '90일', val: 90 },
  ];

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {quickButtons.map(b => (
          <Button key={String(b.val)} variant={quick === b.val ? 'primary' : 'ghost'} size="sm"
            onClick={() => setQuick(b.val)}>
            {b.label}
          </Button>
        ))}
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
        <span className="text-mx-text-secondary text-xs">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
        <Button variant="outline" size="sm" onClick={() => load(dateFrom, dateTo)}>조회</Button>
      </div>

      {loading ? (
        <p className="text-mx-text-secondary text-sm py-8 text-center">로딩 중…</p>
      ) : kpi ? (
        <>
          {/* KPI Cards — Row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="정산 합계" value={formatKRW(kpi.totalSettlement)} accent="blue" />
            <KpiCard label="일평균 정산" value={formatKRW(kpi.avgDailySettlement)} accent="cyan" />
            <KpiCard label="총 주문" value={formatNumber(kpi.totalOrders)} accent="green" />
            <KpiCard label="총 수량" value={formatNumber(kpi.totalQty)} accent="amber" />
            <KpiCard label="SKU 수" value={formatNumber(kpi.totalSkus)} accent="purple" />
          </div>

          {/* KPI Cards — Row 2: Shipping/Cancel */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="출고 완료" value={formatNumber(kpi.shippedCount)} accent="green" />
            <KpiCard label="미출고" value={formatNumber(kpi.unshippedCount)} accent="red" />
            <KpiCard label="취소 건수" value={formatNumber(kpi.cancelCount)} accent="red" />
            <KpiCard label="취소 금액" value={formatKRW(kpi.cancelAmount)} accent="red" />
            <KpiCard label="취소율" value={formatPercent(kpi.cancelRate)} accent={kpi.cancelRate > 5 ? 'red' : 'green'} />
          </div>

          {/* Charts Row 1: Trend + Share */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="md:col-span-2">
              <h3 className="text-sm font-bold text-mx-text mb-2">마켓별 정산 추이</h3>
              <div style={{ height: 250 }}>
                <Line data={trendData} options={chartOpts as never} />
              </div>
            </Card>
            <Card>
              <h3 className="text-sm font-bold text-mx-text mb-2">마켓 쉐어</h3>
              <div style={{ height: 250 }}>
                <Doughnut data={shareData} options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { position: 'bottom', labels: { color: '#94A3B8', font: { size: 10 } } } },
                } as never} />
              </div>
            </Card>
          </div>

          {/* Charts Row 2: Market Bar + SKU Top 10 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <h3 className="text-sm font-bold text-mx-text mb-2">마켓별 비교</h3>
              <div style={{ height: 220 }}>
                <Bar data={marketBarData} options={chartOpts as never} />
              </div>
            </Card>
            <Card>
              <h3 className="text-sm font-bold text-mx-text mb-2">SKU TOP 10 (정산)</h3>
              <div style={{ height: 220 }}>
                <Bar data={skuBarData} options={{
                  ...chartOpts, indexAxis: 'y' as const,
                  plugins: { legend: { display: false } },
                } as never} />
              </div>
            </Card>
          </div>

          {/* Chart Row 3: Shipment */}
          <Card>
            <h3 className="text-sm font-bold text-mx-text mb-2">일별 출고량</h3>
            <div style={{ height: 200 }}>
              <Bar data={shipData} options={{
                ...chartOpts, plugins: { legend: { display: false } },
              } as never} />
            </div>
          </Card>

          {/* Market breakdown table */}
          <Card>
            <h3 className="text-sm font-bold text-mx-text mb-3">마켓별</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                    <th className="py-1.5 pr-3">마켓</th>
                    <th className="py-1.5 pr-3 text-right">주문</th>
                    <th className="py-1.5 pr-3 text-right">수량</th>
                    <th className="py-1.5 pr-3 text-right">매출</th>
                    <th className="py-1.5 text-right">정산</th>
                  </tr>
                </thead>
                <tbody>
                  {byMarket.map(m => (
                    <tr key={m.market_id} className="border-b border-mx-border/50">
                      <td className="py-1.5 pr-3 font-medium">{MARKET_LABELS[m.market_id] || m.market_id}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatNumber(m.order_count)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatNumber(m.qty_total)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatKRW(m.sales_total)}</td>
                      <td className="py-1.5 text-right font-mono">{formatKRW(m.settlement_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Daily trend table */}
          <Card>
            <h3 className="text-sm font-bold text-mx-text mb-3">일별 추이</h3>
            <div className="overflow-x-auto max-h-[400px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-mx-card">
                  <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                    <th className="py-1.5 pr-3">날짜</th>
                    <th className="py-1.5 pr-3 text-right">주문</th>
                    <th className="py-1.5 pr-3 text-right">수량</th>
                    <th className="py-1.5 pr-3 text-right">매출</th>
                    <th className="py-1.5 text-right">정산</th>
                  </tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map(d => (
                    <tr key={d.sales_date} className="border-b border-mx-border/50">
                      <td className="py-1.5 pr-3">{d.sales_date}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatNumber(d.order_count)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatNumber(d.qty_total)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatKRW(d.sales_total)}</td>
                      <td className="py-1.5 text-right font-mono">{formatKRW(d.settlement_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Top SKU table */}
          <Card>
            <h3 className="text-sm font-bold text-mx-text mb-3">SKU 순위 (정산 기준)</h3>
            <div className="overflow-x-auto max-h-[400px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-mx-card">
                  <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                    <th className="py-1.5 pr-2 w-8">#</th>
                    <th className="py-1.5 pr-3">상품명</th>
                    <th className="py-1.5 pr-3 text-right">정산</th>
                    <th className="py-1.5 text-right">건수</th>
                  </tr>
                </thead>
                <tbody>
                  {topSkus.map((s, i) => (
                    <tr key={s.master_sku} className="border-b border-mx-border/50">
                      <td className="py-1.5 pr-2 text-mx-text-secondary">{i + 1}</td>
                      <td className="py-1.5 pr-3 truncate max-w-[300px]">{s.product_name_raw}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatKRW(s.settlement_total)}</td>
                      <td className="py-1.5 text-right font-mono">{formatNumber(s.order_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
