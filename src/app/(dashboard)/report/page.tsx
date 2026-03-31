'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatKRW, formatNumber, formatPercent } from '@/lib/utils/currency';

export const runtime = 'edge';

interface SkuReport {
  master_sku: string;
  product_name_raw: string;
  order_count: number;
  qty_total: number;
  sales_total: number;
  settlement_total: number;
  unit_cost: number;
  cost_total: number;
  margin: number;
  margin_rate: number;
  has_cost: boolean;
}

interface MarketReport {
  market_id: string;
  order_count: number;
  qty_total: number;
  sales_total: number;
  settlement_total: number;
}

interface Summary {
  totalSales: number;
  totalSettl: number;
  totalOrders: number;
  totalMargin: number;
  hasCostCount: number;
  dateFrom: string;
  dateTo: string;
}

type QuickFilter = 'month' | 7 | 30 | 90 | 0;

const MARKET_LABELS: Record<string, string> = {
  dailyshot: 'Dailyshot', kihya: 'Kihya', dmonkey: '드렁큰몽키',
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

export default function ReportPage() {
  const { toast } = useToast();
  const [quick, setQuick] = useState<QuickFilter>('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [markets, setMarkets] = useState<MarketReport[]>([]);
  const [skus, setSkus] = useState<SkuReport[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);

    const res = await api<{
      summary: Summary;
      markets: MarketReport[];
      skus: SkuReport[];
    }>(`report?${params}`);

    if (res?.ok) {
      setSummary(res.summary);
      setMarkets(res.markets);
      setSkus(res.skus);
    } else {
      toast('리포트 로드 실패', 'error');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    const range = getDateRange(quick);
    setDateFrom(range.from);
    setDateTo(range.to);
    load(range.from, range.to);
  }, [quick, load]);

  const runSummary = async () => {
    setSummaryLoading(true);
    const res = await api<{ ok: boolean; message: string }>('summary', {});
    if (res?.ok) {
      toast(res.message, 'success');
    } else {
      toast('요약 생성 실패', 'error');
    }
    setSummaryLoading(false);
  };

  const quickButtons: { label: string; val: QuickFilter }[] = [
    { label: '전체', val: 0 },
    { label: '당월', val: 'month' },
    { label: '7일', val: 7 },
    { label: '30일', val: 30 },
    { label: '90일', val: 90 },
  ];

  return (
    <div className="space-y-4">
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
        <Button variant="outline" size="sm" onClick={runSummary} disabled={summaryLoading}>
          {summaryLoading ? '생성중…' : '요약 생성'}
        </Button>
      </div>

      {loading ? (
        <p className="text-mx-text-secondary text-sm py-8 text-center">로딩 중…</p>
      ) : summary ? (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="총 매출" value={formatKRW(summary.totalSales)} accent="green" />
            <KpiCard label="총 정산" value={formatKRW(summary.totalSettl)} accent="amber" />
            <KpiCard label="총 주문" value={formatNumber(summary.totalOrders)} accent="blue" />
            <KpiCard label="총 마진" value={formatKRW(summary.totalMargin)}
              accent={summary.totalMargin >= 0 ? 'green' : 'red'} />
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
                  {markets.map(m => (
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

          {/* SKU with cost/margin */}
          <Card>
            <h3 className="text-sm font-bold text-mx-text mb-3">
              SKU별 원가/마진 ({summary.hasCostCount}개 원가 등록)
            </h3>
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-mx-card">
                  <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                    <th className="py-1.5 pr-2">SKU</th>
                    <th className="py-1.5 pr-2">상품명</th>
                    <th className="py-1.5 pr-2 text-right">수량</th>
                    <th className="py-1.5 pr-2 text-right">정산</th>
                    <th className="py-1.5 pr-2 text-right">단가</th>
                    <th className="py-1.5 pr-2 text-right">총원가</th>
                    <th className="py-1.5 pr-2 text-right">마진</th>
                    <th className="py-1.5 text-right">마진율</th>
                  </tr>
                </thead>
                <tbody>
                  {skus.map(s => (
                    <tr key={s.master_sku} className="border-b border-mx-border/50">
                      <td className="py-1.5 pr-2 font-mono text-mx-cyan text-[10px]">{s.master_sku}</td>
                      <td className="py-1.5 pr-2 truncate max-w-[200px]">{s.product_name_raw}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{formatNumber(s.qty_total)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{formatKRW(s.settlement_total)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-mx-text-secondary">
                        {s.has_cost ? formatKRW(s.unit_cost) : '-'}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono text-mx-text-secondary">
                        {s.has_cost ? formatKRW(s.cost_total) : '-'}
                      </td>
                      <td className={`py-1.5 pr-2 text-right font-mono ${
                        !s.has_cost ? 'text-mx-text-secondary' : s.margin >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {s.has_cost ? formatKRW(s.margin) : '-'}
                      </td>
                      <td className={`py-1.5 text-right font-mono ${
                        !s.has_cost ? 'text-mx-text-secondary' : s.margin_rate >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {s.has_cost ? formatPercent(s.margin_rate) : '-'}
                      </td>
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
