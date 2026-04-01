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

/* ─── Types ─── */
interface DashKpi {
  totalOrders: number; totalQty: number; totalSales: number;
  totalSettlement: number; totalSkus: number; unshippedCount: number;
  shippedCount: number; avgDailySettlement: number; topMarket: string;
  topMarketSettlement: number; cancelCount: number; cancelAmount: number;
  cancelRate: number;
}
interface DailyRow { sales_date: string; order_count: number; qty_total: number; sales_total: number; settlement_total: number; }
interface DailyMarketRow { sales_date: string; market_id: string; settlement_total: number; }
interface MarketRow { market_id: string; order_count: number; qty_total: number; sales_total: number; settlement_total: number; }
interface SkuRow { master_sku: string; product_name_raw: string; qty_total: number; settlement_total: number; order_count: number; }
interface ShippedDailyRow { ship_date: string; shipped_qty: number; shipped_count: number; }
interface SkuLeadRow { master_sku: string; product_name_raw: string; avg_days: number; order_count: number; }
interface DailyShipMarketRow { ship_date: string; market_id: string; shipped_qty: number; }

interface MixpanelItem { name: string; value: number; }
interface MixpanelTs { date: string; value: number; }
interface MixpanelData {
  '어제_결제건수': number | null;
  '어제_결제금액': number | null;
  '이번달_결제건수': number | null;
  '이번달_결제금액': number | null;
  '어제_품목별_금액': MixpanelItem[] | null;
  '어제_품목별_판매량': MixpanelItem[] | null;
  '이번달_품목별_금액': MixpanelItem[] | null;
  '이번달_품목별_판매량': MixpanelItem[] | null;
  '어제_주종별_판매량': MixpanelItem[] | null;
  '이번달_주종별_판매량': MixpanelItem[] | null;
  '요일별_판매량': MixpanelItem[] | null;
  '재입고_3개월': MixpanelItem[] | null;
  '추이_건수': MixpanelTs[] | null;
  '추이_금액': MixpanelTs[] | null;
}

type QuickFilter = 'month' | 1 | 7 | 30 | 90 | 0;

/* ─── GAS-identical palette ─── */
const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4'];
const MARKET_LABELS: Record<string, string> = { dailyshot: 'Dailyshot', kihya: 'Kihya', dmonkey: '드렁큰몽키' };
const MARKET_COLORS: Record<string, string> = { dailyshot: '#3B82F6', kihya: '#F59E0B', dmonkey: '#10B981' };

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

/* ─── Shared chart base ─── */
const baseScales = {
  x: { ticks: { color: '#64748B', font: { size: 9 } }, grid: { color: '#1E293B' } },
  y: { ticks: { color: '#64748B', font: { size: 9 } }, grid: { color: '#1E293B' } },
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
  const [skuLead, setSkuLead] = useState<SkuLeadRow[]>([]);
  const [dailyShipByMarket, setDailyShipByMarket] = useState<DailyShipMarketRow[]>([]);

  // Mixpanel
  const [mpData, setMpData] = useState<MixpanelData | null>(null);
  const [mpLoading, setMpLoading] = useState(false);
  const [mpCachedAt, setMpCachedAt] = useState('');

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);

    const res = await api<{
      kpi: DashKpi; daily: DailyRow[]; dailyByMarket: DailyMarketRow[];
      byMarket: MarketRow[]; topSkus: SkuRow[]; shippedDaily: ShippedDailyRow[];
      skuLead: SkuLeadRow[]; dailyShipByMarket: DailyShipMarketRow[];
    }>(`dashboard?${params}`);

    if (res?.ok) {
      setKpi(res.kpi);
      setDaily(res.daily);
      setDailyByMarket(res.dailyByMarket || []);
      setByMarket(res.byMarket);
      setTopSkus(res.topSkus);
      setShippedDaily(res.shippedDaily || []);
      setSkuLead(res.skuLead || []);
      setDailyShipByMarket(res.dailyShipByMarket || []);
    } else {
      toast('대시보드 로드 실패', 'error');
    }
    setLoading(false);
  }, [toast]);

  const loadMixpanel = useCallback(async (refresh = false) => {
    setMpLoading(true);
    const res = await api<{ data: MixpanelData; cached: boolean; cachedAt: string }>(
      `mixpanel${refresh ? '?refresh=1' : ''}`
    );
    if (res?.ok) {
      setMpData(res.data);
      setMpCachedAt(res.cachedAt);
    }
    setMpLoading(false);
  }, []);

  useEffect(() => {
    const range = getDateRange(quick);
    setDateFrom(range.from);
    setDateTo(range.to);
    load(range.from, range.to);
    loadMixpanel();
  }, [quick, load, loadMixpanel]);

  /* ═══════════════════════════════════════════
     CHART DATA — matching GAS exactly
     ═══════════════════════════════════════════ */

  // cTrend: Line, tension 0.4, fill false, palette
  const trendData = useMemo(() => {
    const dates = [...new Set(dailyByMarket.map(d => d.sales_date))].sort();
    const markets = [...new Set(dailyByMarket.map(d => d.market_id))];
    return {
      labels: dates.map(d => d.substring(5)),
      datasets: markets.map((m, i) => ({
        label: MARKET_LABELS[m] || m,
        data: dates.map(d => {
          const row = dailyByMarket.find(r => r.sales_date === d && r.market_id === m);
          return row ? Math.round(row.settlement_total / 10000) : 0;
        }),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: 'transparent',
        tension: 0.4,
        fill: false,
        pointRadius: 2,
        borderWidth: 2,
      })),
    };
  }, [dailyByMarket]);

  // cShare: Doughnut, cutout 65%, borderColor #161E2E, borderWidth 3
  const shareData = useMemo(() => ({
    labels: byMarket.map(m => MARKET_LABELS[m.market_id] || m.market_id),
    datasets: [{
      data: byMarket.map(m => m.settlement_total),
      backgroundColor: byMarket.map((_, i) => PALETTE[i % PALETTE.length]),
      borderColor: '#161E2E',
      borderWidth: 3,
    }],
  }), [byMarket]);

  // cMarket: Bar, SINGLE dataset (정산 only), green color
  const marketBarData = useMemo(() => ({
    labels: byMarket.map(m => MARKET_LABELS[m.market_id] || m.market_id),
    datasets: [{
      label: '정산',
      data: byMarket.map(m => m.settlement_total),
      backgroundColor: '#10B98144',
      borderColor: '#10B981',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [byMarket]);

  // cSku: Horizontal bar + line overlay (dual axis)
  const skuChartData = useMemo(() => ({
    labels: topSkus.map(s => s.product_name_raw?.substring(0, 20) || s.master_sku),
    datasets: [
      {
        type: 'bar' as const,
        label: '정산 (만원)',
        data: topSkus.map(s => Math.round(s.settlement_total / 10000)),
        backgroundColor: '#10B98144',
        borderColor: '#10B981',
        borderWidth: 1,
        borderRadius: 4,
        yAxisID: 'y',
      },
      {
        type: 'line' as const,
        label: '수량',
        data: topSkus.map(s => s.qty_total),
        borderColor: '#3B82F6',
        backgroundColor: '#3B82F6',
        pointRadius: 3,
        borderWidth: 2,
        tension: 0.3,
        yAxisID: 'y1',
      },
    ],
  }), [topSkus]);

  // cShipment: Stacked bar by market
  const shipData = useMemo(() => {
    const dates = [...new Set(dailyShipByMarket.map(d => d.ship_date))].sort();
    const markets = [...new Set(dailyShipByMarket.map(d => d.market_id))];
    return {
      labels: dates.map(d => d.substring(5)),
      datasets: markets.map((m, i) => ({
        label: MARKET_LABELS[m] || m,
        data: dates.map(d => {
          const row = dailyShipByMarket.find(r => r.ship_date === d && r.market_id === m);
          return row ? row.shipped_qty : 0;
        }),
        backgroundColor: PALETTE[i % PALETTE.length],
        borderRadius: 2,
      })),
    };
  }, [dailyShipByMarket]);

  // cLeadTime: Horizontal bar, dynamic colors (>3d red, >2d amber, <=2d green)
  const leadTimeData = useMemo(() => ({
    labels: skuLead.map(s => s.product_name_raw?.substring(0, 20) || s.master_sku),
    datasets: [{
      label: '평균 리드타임 (일)',
      data: skuLead.map(s => s.avg_days),
      backgroundColor: skuLead.map(s =>
        s.avg_days > 3 ? '#EF444488' : s.avg_days > 2 ? '#F59E0B88' : '#10B98188'
      ),
      borderColor: skuLead.map(s =>
        s.avg_days > 3 ? '#EF4444' : s.avg_days > 2 ? '#F59E0B' : '#10B981'
      ),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [skuLead]);

  // Mixpanel dual-axis trend (건수 blue, 금액 purple)
  const mpTrendData = useMemo(() => {
    if (!mpData?.['추이_건수'] || !mpData?.['추이_금액']) return null;
    const counts = mpData['추이_건수'] as MixpanelTs[];
    const amounts = mpData['추이_금액'] as MixpanelTs[];
    const labels = counts.map(c => c.date.substring(5));
    return {
      labels,
      datasets: [
        {
          label: '건수',
          data: counts.map(c => c.value),
          borderColor: '#60A5FA',
          backgroundColor: 'transparent',
          tension: 0.4,
          yAxisID: 'y',
          pointRadius: 1,
          borderWidth: 2,
        },
        {
          label: '금액 (만원)',
          data: amounts.map(a => Math.round(a.value / 10000)),
          borderColor: '#A78BFA',
          backgroundColor: 'transparent',
          tension: 0.4,
          yAxisID: 'y1',
          pointRadius: 1,
          borderWidth: 2,
        },
      ],
    };
  }, [mpData]);

  const quickButtons: { label: string; val: QuickFilter }[] = [
    { label: '전체', val: 0 }, { label: '오늘', val: 1 },
    { label: '7일', val: 7 }, { label: '당월', val: 'month' },
    { label: '30일', val: 30 }, { label: '90일', val: 90 },
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

          {/* KPI Cards — Row 2 */}
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
              <h3 className="text-sm font-bold text-mx-text mb-2">마켓별 정산 추이 (만원)</h3>
              <div style={{ height: 250 }}>
                <Line data={trendData} options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { labels: { color: '#94A3B8', font: { size: 10 } } },
                    tooltip: { callbacks: { label: (ctx: { dataset: { label?: string }; parsed: { y?: number } }) => `${ctx.dataset.label}: ${ctx.parsed.y?.toLocaleString()}만원` } },
                  },
                  scales: baseScales,
                } as never} />
              </div>
            </Card>
            <Card>
              <h3 className="text-sm font-bold text-mx-text mb-2">마켓 쉐어</h3>
              <div style={{ height: 250 }}>
                <Doughnut data={shareData} options={{
                  responsive: true, maintainAspectRatio: false,
                  cutout: '65%',
                  plugins: { legend: { position: 'bottom', labels: { color: '#94A3B8', font: { size: 10 } } } },
                } as never} />
              </div>
            </Card>
          </div>

          {/* Charts Row 2: Market Bar (정산 only) + SKU Top 10 (dual axis) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <h3 className="text-sm font-bold text-mx-text mb-2">마켓별 비교 (정산)</h3>
              <div style={{ height: 220 }}>
                <Bar data={marketBarData} options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    ...baseScales,
                    y: { ...baseScales.y, ticks: { ...baseScales.y.ticks, callback: (v: string | number) => `${Number(v) / 10000}만` } },
                  },
                } as never} />
              </div>
            </Card>
            <Card>
              <h3 className="text-sm font-bold text-mx-text mb-2">SKU TOP 10</h3>
              <div style={{ height: 220 }}>
                <Bar data={skuChartData as never} options={{
                  responsive: true, maintainAspectRatio: false,
                  indexAxis: 'y' as const,
                  plugins: { legend: { labels: { color: '#94A3B8', font: { size: 9 } } } },
                  scales: {
                    x: { position: 'bottom', ticks: { color: '#64748B', font: { size: 9 } }, grid: { color: '#1E293B' } },
                    y: { ticks: { color: '#64748B', font: { size: 8 } }, grid: { display: false } },
                    y1: { position: 'top' as const, ticks: { color: '#3B82F6', font: { size: 8 } }, grid: { display: false } },
                  },
                } as never} />
              </div>
            </Card>
          </div>

          {/* Charts Row 3: Shipment (stacked by market) + Lead Time */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <h3 className="text-sm font-bold text-mx-text mb-2">일별 출고량</h3>
              <div style={{ height: 220 }}>
                <Bar data={shipData} options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: '#94A3B8', font: { size: 9 } } } },
                  scales: {
                    ...baseScales,
                    x: { ...baseScales.x, stacked: true },
                    y: { ...baseScales.y, stacked: true },
                  },
                } as never} />
              </div>
            </Card>
            <Card>
              <h3 className="text-sm font-bold text-mx-text mb-2">SKU별 평균 리드타임 (주문→출고)</h3>
              <div style={{ height: 220 }}>
                {skuLead.length > 0 ? (
                  <Bar data={leadTimeData} options={{
                    responsive: true, maintainAspectRatio: false,
                    indexAxis: 'y' as const,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { ticks: { color: '#64748B', font: { size: 9 } }, grid: { color: '#1E293B' } },
                      y: { ticks: { color: '#64748B', font: { size: 8 } }, grid: { display: false } },
                    },
                  } as never} />
                ) : (
                  <p className="text-mx-text-secondary text-xs text-center pt-16">리드타임 데이터 없음</p>
                )}
              </div>
            </Card>
          </div>

          {/* ═══════════ Mixpanel Section ═══════════ */}
          <div className="border-t border-mx-border pt-4 mt-4">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-base font-bold text-mx-text">데일리샷 (Mixpanel)</h2>
              {mpCachedAt && (
                <span className="text-[10px] text-mx-text-secondary">
                  캐시: {mpCachedAt.substring(0, 16).replace('T', ' ')}
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={() => loadMixpanel(true)} disabled={mpLoading}>
                {mpLoading ? '로딩...' : '새로고침'}
              </Button>
            </div>

            {mpData ? (
              <>
                {/* Mixpanel KPI cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <KpiCard label="어제 결제건수" value={formatNumber(mpData['어제_결제건수'] ?? 0)} accent="blue" />
                  <KpiCard label="어제 결제금액" value={formatKRW(mpData['어제_결제금액'] ?? 0)} accent="blue" />
                  <KpiCard label="이번달 결제건수" value={formatNumber(mpData['이번달_결제건수'] ?? 0)} accent="purple" />
                  <KpiCard label="이번달 결제금액" value={formatKRW(mpData['이번달_결제금액'] ?? 0)} accent="purple" />
                </div>

                {/* Mixpanel trend chart (dual axis: 건수 + 금액) */}
                {mpTrendData && (
                  <Card className="mb-4">
                    <h3 className="text-sm font-bold text-mx-text mb-2">데일리샷 추이</h3>
                    <div style={{ height: 220 }}>
                      <Line data={mpTrendData} options={{
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { labels: { color: '#94A3B8', font: { size: 10 } } } },
                        scales: {
                          x: { ticks: { color: '#64748B', font: { size: 8 } }, grid: { color: '#1E293B' } },
                          y: { position: 'left', ticks: { color: '#60A5FA', font: { size: 9 } }, grid: { color: '#1E293B' }, title: { display: true, text: '건수', color: '#60A5FA' } },
                          y1: { position: 'right', ticks: { color: '#A78BFA', font: { size: 9 } }, grid: { drawOnChartArea: false }, title: { display: true, text: '금액(만)', color: '#A78BFA' } },
                        },
                      } as never} />
                    </div>
                  </Card>
                )}

                {/* Mixpanel breakdowns */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <MpItemTable title="어제 품목별 금액" items={mpData['어제_품목별_금액']} format="krw" />
                  <MpItemTable title="어제 품목별 판매량" items={mpData['어제_품목별_판매량']} />
                  <MpItemTable title="이번달 품목별 금액" items={mpData['이번달_품목별_금액']} format="krw" />
                  <MpItemTable title="이번달 품목별 판매량" items={mpData['이번달_품목별_판매량']} />
                  <MpItemTable title="어제 주종별 판매량" items={mpData['어제_주종별_판매량']} />
                  <MpItemTable title="이번달 주종별 판매량" items={mpData['이번달_주종별_판매량']} />
                  <MpItemTable title="요일별 판매량" items={mpData['요일별_판매량']} />
                  <MpItemTable title="재입고 알림 (3개월)" items={mpData['재입고_3개월']} highlight />
                </div>
              </>
            ) : mpLoading ? (
              <p className="text-mx-text-secondary text-sm py-4 text-center">Mixpanel 데이터 로딩 중…</p>
            ) : (
              <p className="text-mx-text-secondary text-sm py-4 text-center">Mixpanel 데이터 없음</p>
            )}
          </div>

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

/* ─── Mixpanel Item Table sub-component ─── */
function MpItemTable({ title, items, format, highlight }: {
  title: string;
  items: MixpanelItem[] | null;
  format?: 'krw';
  highlight?: boolean;
}) {
  if (!items || items.length === 0) return null;
  return (
    <Card>
      <h4 className="text-xs font-bold text-mx-text mb-2">{title}</h4>
      <div className="overflow-x-auto max-h-[200px]">
        <table className="w-full text-xs">
          <tbody>
            {items.slice(0, 15).map((item, i) => (
              <tr key={item.name} className={`border-b border-mx-border/30 ${highlight && i < 3 ? 'text-amber-400' : ''}`}>
                <td className="py-1 pr-2 truncate max-w-[200px]">{item.name}</td>
                <td className="py-1 text-right font-mono">
                  {format === 'krw' ? formatKRW(item.value) : formatNumber(item.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
