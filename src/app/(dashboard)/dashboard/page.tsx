'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatKRW, formatNumber } from '@/lib/utils/currency';

export const runtime = 'edge';

interface DashKpi {
  totalOrders: number;
  totalQty: number;
  totalSales: number;
  totalSettlement: number;
  unshippedCount: number;
}

interface DailyRow {
  sales_date: string;
  order_count: number;
  qty_total: number;
  sales_total: number;
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
}

type QuickFilter = 'month' | 1 | 7 | 30 | 90 | 0;

const MARKET_LABELS: Record<string, string> = {
  dailyshot: 'Dailyshot',
  kihya: 'Kihya',
  dmonkey: '드렁큰몽키',
};

function getDateRange(q: QuickFilter): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().substring(0, 10);

  if (q === 0) return { from: '', to: '' };
  if (q === 'month') {
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return { from, to };
  }
  const d = new Date(now.getTime() - (q as number) * 86400000);
  return { from: d.toISOString().substring(0, 10), to };
}

export default function DashboardPage() {
  const { toast } = useToast();
  const [quick, setQuick] = useState<QuickFilter>('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState<DashKpi | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [byMarket, setByMarket] = useState<MarketRow[]>([]);
  const [topSkus, setTopSkus] = useState<SkuRow[]>([]);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);

    const res = await api<{
      kpi: DashKpi;
      daily: DailyRow[];
      byMarket: MarketRow[];
      topSkus: SkuRow[];
    }>(`/api/dashboard?${params}`);

    if (res?.ok) {
      setKpi(res.kpi);
      setDaily(res.daily);
      setByMarket(res.byMarket);
      setTopSkus(res.topSkus);
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

  const onCustomRange = () => load(dateFrom, dateTo);

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
          <Button
            key={String(b.val)}
            variant={quick === b.val ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setQuick(b.val)}
          >
            {b.label}
          </Button>
        ))}
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text"
        />
        <span className="text-mx-text-secondary text-xs">~</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text"
        />
        <Button variant="outline" size="sm" onClick={onCustomRange}>조회</Button>
      </div>

      {loading ? (
        <p className="text-mx-text-secondary text-sm py-8 text-center">로딩 중…</p>
      ) : kpi ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="총 주문" value={formatNumber(kpi.totalOrders)} accent="blue" />
            <KpiCard label="총 수량" value={formatNumber(kpi.totalQty)} accent="cyan" />
            <KpiCard label="매출" value={formatKRW(kpi.totalSales)} accent="green" />
            <KpiCard label="정산" value={formatKRW(kpi.totalSettlement)} accent="amber" />
            <KpiCard label="미출고" value={formatNumber(kpi.unshippedCount)} accent="red" />
          </div>

          {/* Market breakdown */}
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

          {/* Top SKUs */}
          <Card>
            <h3 className="text-sm font-bold text-mx-text mb-3">Top SKU (수량 기준)</h3>
            <div className="overflow-x-auto max-h-[400px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-mx-card">
                  <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                    <th className="py-1.5 pr-3">SKU</th>
                    <th className="py-1.5 pr-3">상품명</th>
                    <th className="py-1.5 pr-3 text-right">수량</th>
                    <th className="py-1.5 text-right">정산</th>
                  </tr>
                </thead>
                <tbody>
                  {topSkus.map(s => (
                    <tr key={s.master_sku} className="border-b border-mx-border/50">
                      <td className="py-1.5 pr-3 font-mono text-mx-cyan">{s.master_sku}</td>
                      <td className="py-1.5 pr-3 truncate max-w-[300px]">{s.product_name_raw}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatNumber(s.qty_total)}</td>
                      <td className="py-1.5 text-right font-mono">{formatKRW(s.settlement_total)}</td>
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
