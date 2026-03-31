'use client';

import { useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatKRW, formatNumber } from '@/lib/utils/currency';

export const runtime = 'edge';

interface InvoiceRow {
  order_id: string;
  order_date: string;
  product_name: string;
  option_name: string;
  qty: number;
  settlement_amount: number;
  tracking_no: string;
  master_sku: string;
}

interface SkuGroup {
  master_sku: string;
  product_name: string;
  qty: number;
  settlement_amount: number;
}

export default function InvoiceDSPage() {
  const { toast } = useToast();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const load = useCallback(async () => {
    if (!month) { toast('월을 선택해주세요.', 'error'); return; }
    setLoading(true);
    const [year, mon] = month.split('-');
    const from = `${year}-${mon}-01`;
    const lastDay = new Date(parseInt(year), parseInt(mon), 0).getDate();
    const to = `${year}-${mon}-${String(lastDay).padStart(2, '0')}`;

    const res = await api<{ rows: InvoiceRow[] }>('orders', {
      action: 'get_invoice_ds',
      from,
      to,
    });

    if (res?.ok) {
      setRows(res.rows || []);
      setFetched(true);
    } else {
      toast(('message' in res ? res.message : res.error) || '조회 실패', 'error');
    }
    setLoading(false);
  }, [month, toast]);

  // Group rows by SKU for summary view
  const skuGroups: SkuGroup[] = (() => {
    const map = new Map<string, SkuGroup>();
    rows.forEach(r => {
      const key = r.master_sku || r.product_name;
      const existing = map.get(key);
      if (existing) {
        existing.qty += r.qty;
        existing.settlement_amount += r.settlement_amount;
      } else {
        map.set(key, {
          master_sku: r.master_sku || '-',
          product_name: r.product_name,
          qty: r.qty,
          settlement_amount: r.settlement_amount,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.settlement_amount - a.settlement_amount);
  })();

  const totalQty = skuGroups.reduce((s, r) => s + r.qty, 0);
  const totalSettlement = skuGroups.reduce((s, r) => s + r.settlement_amount, 0);

  const exportCSV = () => {
    if (!skuGroups.length) return;
    const header = ['SKU', '상품명', '수량', '정산금액'];
    const csvRows = [
      header.join(','),
      ...skuGroups.map(r =>
        [r.master_sku, `"${r.product_name}"`, r.qty, r.settlement_amount].join(',')
      ),
      ['', '합계', totalQty, totalSettlement].join(','),
    ];
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DS_인보이스_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] text-mx-text-secondary mb-0.5">정산월</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
        </div>
        <div>
          <label className="block text-[10px] text-mx-text-secondary mb-0.5">인보이스 번호</label>
          <input type="text" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)}
            placeholder="INV-2026-001"
            className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-36" />
        </div>
        <div>
          <label className="block text-[10px] text-mx-text-secondary mb-0.5">인보이스 날짜</label>
          <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
            className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? '조회 중...' : '정산 데이터 조회'}
        </Button>
        {fetched && rows.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportCSV}>CSV 다운로드</Button>
        )}
        {fetched && (
          <span className="text-xs text-mx-text-secondary ml-auto">
            주문 {formatNumber(rows.length)}건 / SKU {skuGroups.length}종
          </span>
        )}
      </div>

      {/* Invoice header info */}
      {fetched && (invoiceNo || invoiceDate) && (
        <div className="flex gap-4 text-xs text-mx-text-secondary">
          {invoiceNo && <span>No. {invoiceNo}</span>}
          {invoiceDate && <span>발행일: {invoiceDate}</span>}
          <span>정산월: {month}</span>
        </div>
      )}

      {/* SKU Summary Table */}
      <Card>
        {loading ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">로딩 중...</p>
        ) : !fetched ? (
          <p className="text-xs text-mx-text-muted py-4 text-center">정산월을 선택하고 조회해주세요.</p>
        ) : skuGroups.length === 0 ? (
          <p className="text-xs text-mx-text-muted py-4 text-center">해당 월에 데이터가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-mx-card">
                <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                  <th className="py-1.5 pr-2 w-8">#</th>
                  <th className="py-1.5 pr-2">SKU</th>
                  <th className="py-1.5 pr-2">상품명</th>
                  <th className="py-1.5 pr-2 text-right">수량</th>
                  <th className="py-1.5 pr-2 text-right">정산금액</th>
                  <th className="py-1.5 text-right">건당 단가</th>
                </tr>
              </thead>
              <tbody>
                {skuGroups.map((r, i) => (
                  <tr key={r.master_sku + i} className="border-b border-mx-border/50 hover:bg-mx-border/10">
                    <td className="py-1.5 pr-2 text-mx-text-secondary">{i + 1}</td>
                    <td className="py-1.5 pr-2 font-mono text-mx-cyan text-[10px]">{r.master_sku}</td>
                    <td className="py-1.5 pr-2 truncate max-w-[240px]">{r.product_name}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{formatNumber(r.qty)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{formatKRW(r.settlement_amount)}</td>
                    <td className="py-1.5 text-right font-mono text-mx-text-secondary">
                      {r.qty > 0 ? formatKRW(Math.round(r.settlement_amount / r.qty)) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-mx-border font-bold text-mx-text">
                  <td className="py-2 pr-2" colSpan={3}>합계</td>
                  <td className="py-2 pr-2 text-right font-mono">{formatNumber(totalQty)}</td>
                  <td className="py-2 pr-2 text-right font-mono">{formatKRW(totalSettlement)}</td>
                  <td className="py-2 text-right font-mono text-mx-text-secondary">
                    {totalQty > 0 ? formatKRW(Math.round(totalSettlement / totalQty)) : '-'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Detail Table (raw orders) */}
      {fetched && rows.length > 0 && (
        <details className="group">
          <summary className="text-xs text-mx-text-secondary cursor-pointer hover:text-mx-text py-1">
            주문 상세 ({formatNumber(rows.length)}건)
          </summary>
          <Card className="mt-2">
            <div className="overflow-x-auto max-h-[400px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-mx-card">
                  <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                    <th className="py-1.5 pr-2">주문번호</th>
                    <th className="py-1.5 pr-2">날짜</th>
                    <th className="py-1.5 pr-2">상품</th>
                    <th className="py-1.5 pr-2">옵션</th>
                    <th className="py-1.5 pr-2">SKU</th>
                    <th className="py-1.5 pr-2 text-right">수량</th>
                    <th className="py-1.5 pr-2 text-right">정산</th>
                    <th className="py-1.5">송장</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.order_id + i} className="border-b border-mx-border/50 hover:bg-mx-border/10">
                      <td className="py-1.5 pr-2 font-mono text-[10px]">{r.order_id}</td>
                      <td className="py-1.5 pr-2">{r.order_date}</td>
                      <td className="py-1.5 pr-2 truncate max-w-[160px]">{r.product_name}</td>
                      <td className="py-1.5 pr-2 truncate max-w-[100px] text-mx-text-secondary">{r.option_name}</td>
                      <td className="py-1.5 pr-2 font-mono text-mx-cyan text-[10px]">{r.master_sku}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{r.qty}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{formatKRW(r.settlement_amount)}</td>
                      <td className="py-1.5 font-mono text-[10px] text-green-400">{r.tracking_no}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </details>
      )}
    </div>
  );
}
