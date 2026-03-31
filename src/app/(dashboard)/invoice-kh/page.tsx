'use client';

import { useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatKRW, formatNumber } from '@/lib/utils/currency';

export const runtime = 'edge';

interface KhOrderRow {
  order_id: string;
  sub_order_id: string;
  order_date: string;
  sales_date: string;
  product_name: string;
  option_name: string;
  product_code: string;
  qty: number;
  purchase_price: number;
  settlement_amount: number;
  recipient: string;
  customs_id: string;
  phone: string;
  mobile: string;
  postal_code: string;
  address: string;
  order_note: string;
  remark: string;
  supplier_name: string;
  master_sku: string;
  tracking_no: string;
}

export default function InvoiceKHPage() {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().substring(0, 10));
  const [rows, setRows] = useState<KhOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [detailTarget, setDetailTarget] = useState<KhOrderRow | null>(null);

  const load = useCallback(async () => {
    if (!dateFrom || !dateTo) { toast('날짜를 선택해주세요.', 'error'); return; }
    setLoading(true);

    const res = await api<{ rows: KhOrderRow[] }>('/api/orders', {
      action: 'get_invoice_kh',
      from: dateFrom,
      to: dateTo,
    });

    if (res?.ok) {
      setRows(res.rows || []);
      setFetched(true);
    } else {
      toast(('message' in res ? res.message : res.error) || '조회 실패', 'error');
    }
    setLoading(false);
  }, [dateFrom, dateTo, toast]);

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalSettlement = rows.reduce((s, r) => s + r.settlement_amount, 0);

  const exportCSV = () => {
    if (!rows.length) return;
    const header = ['주문번호', '상품주문번호', '발송일', '상품', '옵션', 'SKU', '수량', '정산금액', '수취인', '송장'];
    const csvRows = [
      header.join(','),
      ...rows.map(r =>
        [
          r.order_id,
          r.sub_order_id,
          r.sales_date,
          `"${r.product_name}"`,
          `"${r.option_name || ''}"`,
          r.master_sku || '',
          r.qty,
          r.settlement_amount,
          `"${r.recipient || ''}"`,
          r.tracking_no || '',
        ].join(',')
      ),
      ['', '', '', '', '합계', '', totalQty, totalSettlement, '', ''].join(','),
    ];
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KH_인보이스_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] text-mx-text-secondary mb-0.5">시작일</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
        </div>
        <span className="text-mx-text-secondary text-xs pb-1">~</span>
        <div>
          <label className="block text-[10px] text-mx-text-secondary mb-0.5">종료일</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? '조회 중...' : '주문 데이터 조회'}
        </Button>
        {fetched && rows.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportCSV}>CSV 다운로드</Button>
        )}
        {fetched && (
          <span className="text-xs text-mx-text-secondary ml-auto">{formatNumber(rows.length)}건</span>
        )}
      </div>

      {/* Main Table */}
      <Card>
        {loading ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">로딩 중...</p>
        ) : !fetched ? (
          <p className="text-xs text-mx-text-muted py-4 text-center">기간을 선택하고 조회해주세요.</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-mx-text-muted py-4 text-center">해당 기간에 데이터가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-mx-card">
                <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                  <th className="py-1.5 pr-2 w-8">#</th>
                  <th className="py-1.5 pr-2">주문번호</th>
                  <th className="py-1.5 pr-2">상품주문번호</th>
                  <th className="py-1.5 pr-2">발송일</th>
                  <th className="py-1.5 pr-2">상품</th>
                  <th className="py-1.5 pr-2">SKU</th>
                  <th className="py-1.5 pr-2 text-right">수량</th>
                  <th className="py-1.5 pr-2 text-right">정산금액</th>
                  <th className="py-1.5 pr-2">수취인</th>
                  <th className="py-1.5 pr-2">송장</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.sub_order_id + i} className="border-b border-mx-border/50 hover:bg-mx-border/10">
                    <td className="py-1.5 pr-2 text-mx-text-secondary">{i + 1}</td>
                    <td className="py-1.5 pr-2 font-mono text-[10px]">{r.order_id}</td>
                    <td className="py-1.5 pr-2 font-mono text-[10px]">{r.sub_order_id}</td>
                    <td className="py-1.5 pr-2">{r.sales_date}</td>
                    <td className="py-1.5 pr-2 truncate max-w-[180px]">{r.product_name}</td>
                    <td className="py-1.5 pr-2 font-mono text-mx-cyan text-[10px]">{r.master_sku}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{r.qty}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{formatKRW(r.settlement_amount)}</td>
                    <td className="py-1.5 pr-2">{r.recipient}</td>
                    <td className="py-1.5 pr-2 font-mono text-[10px] text-green-400">{r.tracking_no}</td>
                    <td className="py-1.5">
                      <Button variant="ghost" size="sm" onClick={() => setDetailTarget(r)}>
                        상세
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-mx-border font-bold text-mx-text">
                  <td className="py-2 pr-2" colSpan={6}>합계</td>
                  <td className="py-2 pr-2 text-right font-mono">{formatNumber(totalQty)}</td>
                  <td className="py-2 pr-2 text-right font-mono">{formatKRW(totalSettlement)}</td>
                  <td className="py-2" colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Detail Modal */}
      {detailTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-mx-card border border-mx-border rounded-lg p-5 w-[500px] max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-bold text-mx-text mb-3">주문 상세</h3>
            <div className="space-y-1.5 text-xs">
              <DetailRow label="주문번호" value={detailTarget.order_id} />
              <DetailRow label="상품주문번호" value={detailTarget.sub_order_id} />
              <DetailRow label="매출일" value={detailTarget.sales_date} />
              <DetailRow label="주문일" value={detailTarget.order_date} />
              <DetailRow label="상품" value={detailTarget.product_name} />
              <DetailRow label="옵션" value={detailTarget.option_name} />
              <DetailRow label="상품코드" value={detailTarget.product_code} />
              <DetailRow label="SKU" value={detailTarget.master_sku} mono />
              <DetailRow label="수량" value={String(detailTarget.qty)} />
              <DetailRow label="건당단가" value={formatKRW(detailTarget.purchase_price || 0)} />
              <DetailRow label="정산금액" value={formatKRW(detailTarget.settlement_amount)} />
              <div className="border-t border-mx-border my-2" />
              <DetailRow label="수취인" value={detailTarget.recipient} />
              <DetailRow label="연락처" value={detailTarget.phone || detailTarget.mobile} />
              <DetailRow label="통관번호" value={detailTarget.customs_id} />
              <DetailRow label="우편번호" value={detailTarget.postal_code} />
              <DetailRow label="주소" value={detailTarget.address} />
              <div className="border-t border-mx-border my-2" />
              <DetailRow label="공급사" value={detailTarget.supplier_name} />
              <DetailRow label="송장번호" value={detailTarget.tracking_no} mono />
              <DetailRow label="주문메모" value={detailTarget.order_note} />
              <DetailRow label="비고" value={detailTarget.remark} />
            </div>
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={() => setDetailTarget(null)}>닫기</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-mx-text-secondary w-20 shrink-0">{label}</span>
      <span className={`text-mx-text ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
