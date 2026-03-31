'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';

export const runtime = 'edge';

/* ── Types ────────────────────────────────────────────────── */

interface ProductDetailResult {
  product_name_display: string;
  one_liner: string;
  tags: string[];
  specs: Record<string, string>;
  tasting: Record<string, string>;
  brewery: Record<string, string>;
  product_detail: string;
  awards: string[];
  detail_html: string;
  price: number;
  supply_price: number;
}

interface CostRow {
  master_sku: string;
  product_name: string;
  purchase_cost: number;
  shipping_cost: number;
  packaging_cost: number;
  tariff_cost: number;
  other_cost: number;
  total_cost: number;
  updated_at?: string;
}

interface ExchangeRate {
  date: string;
  usd: number;
  jpy100: number;
}

const CATEGORIES = ['사케', '위스키', '와인', '맥주', '소주', '리큐르', '기타'] as const;

const EMPTY_COST: CostRow = {
  master_sku: '',
  product_name: '',
  purchase_cost: 0,
  shipping_cost: 0,
  packaging_cost: 0,
  tariff_cost: 0,
  other_cost: 0,
  total_cost: 0,
};

/* ── Component ────────────────────────────────────────────── */

export default function SourcingPage() {
  const { toast } = useToast();

  /* --- Product Detail Generator state --- */
  const [pdForm, setPdForm] = useState({
    product_name: '',
    product_name_kr: '',
    category: '사케' as string,
    volume: '',
    abv: '',
    price: '',
    supply_price: '',
  });
  const [pdModel, setPdModel] = useState<'haiku' | 'sonnet'>('haiku');
  const [pdLoading, setPdLoading] = useState(false);
  const [pdResult, setPdResult] = useState<ProductDetailResult | null>(null);

  /* --- Cost Master state --- */
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [costsLoading, setCostsLoading] = useState(true);
  const [editRow, setEditRow] = useState<CostRow | null>(null);
  const [showCostForm, setShowCostForm] = useState(false);

  /* --- Exchange Rate state --- */
  const [fx, setFx] = useState<ExchangeRate | null>(null);
  const [fxMsg, setFxMsg] = useState('');

  /* ── Loaders ─────────────────────────────────────────────── */

  const loadCosts = useCallback(async () => {
    setCostsLoading(true);
    const res = await api<{ costs: CostRow[] }>('/api/cost-master');
    if (res?.ok) setCosts(res.costs || []);
    setCostsLoading(false);
  }, []);

  const loadFx = useCallback(async () => {
    setFxMsg('조회 중…');
    const res = await api<ExchangeRate>('/api/exchange-rate');
    if (res?.ok) {
      setFx({ date: res.date, usd: res.usd, jpy100: res.jpy100 });
      setFxMsg('');
    } else {
      setFx(null);
      setFxMsg(('message' in res ? (res as { message?: string }).message : res.error) || '환율 조회 실패');
    }
  }, []);

  useEffect(() => {
    loadCosts();
    loadFx();
  }, [loadCosts, loadFx]);

  /* ── Product Detail Generate ─────────────────────────────── */

  const onGenerate = async () => {
    if (!pdForm.product_name.trim()) {
      toast('상품명(JP)을 입력하세요.', 'warn');
      return;
    }
    setPdLoading(true);
    setPdResult(null);
    const res = await api<{ result: ProductDetailResult }>('/api/sourcing', {
      action: 'generate_product_detail',
      ...pdForm,
      model: pdModel,
      volume: pdForm.volume ? Number(pdForm.volume) : undefined,
      abv: pdForm.abv ? Number(pdForm.abv) : undefined,
      price: pdForm.price ? Number(pdForm.price) : undefined,
      supply_price: pdForm.supply_price ? Number(pdForm.supply_price) : undefined,
    });
    if (res?.ok) {
      setPdResult(res.result);
      toast('상세페이지 생성 완료', 'success');
    } else {
      toast(('message' in res ? (res as { message?: string }).message : res.error) || '생성 실패', 'error');
    }
    setPdLoading(false);
  };

  const copyHtml = () => {
    if (!pdResult?.detail_html) return;
    navigator.clipboard.writeText(pdResult.detail_html);
    toast('HTML 복사 완료', 'success');
  };

  /* ── Cost Master CRUD ────────────────────────────────────── */

  const onCostSave = async () => {
    if (!editRow?.master_sku?.trim()) {
      toast('SKU를 입력하세요.', 'warn');
      return;
    }
    const res = await api<{ ok: boolean; message: string }>('/api/cost-master', {
      action: 'upsert',
      ...editRow,
    });
    if (res?.ok) {
      toast('원가 저장 완료', 'success');
      setShowCostForm(false);
      setEditRow(null);
      loadCosts();
    } else {
      toast(res?.message || '저장 실패', 'error');
    }
  };

  const onCostDelete = async (sku: string) => {
    const res = await api<{ ok: boolean; message: string }>('/api/cost-master', {
      action: 'delete',
      master_sku: sku,
    });
    if (res?.ok) {
      toast('삭제 완료', 'success');
      loadCosts();
    } else {
      toast(res?.message || '삭제 실패', 'error');
    }
  };

  const openAddForm = () => {
    setEditRow({ ...EMPTY_COST });
    setShowCostForm(true);
  };

  const openEditForm = (row: CostRow) => {
    setEditRow({ ...row });
    setShowCostForm(true);
  };

  /* ── Helpers ─────────────────────────────────────────────── */

  const inputCls = 'bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-full focus:outline-none focus:border-mx-blue';
  const labelCls = 'text-[11px] text-mx-text-secondary mb-0.5';

  const fmtNum = (n: number) => n.toLocaleString('ko-KR');

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-mx-text">소싱 · 상품관리</h1>

        {/* Exchange Rate Widget */}
        <div className="flex items-center gap-3 text-xs">
          {fx ? (
            <>
              <span className="text-mx-text-secondary">{fx.date}</span>
              <span className="px-2 py-0.5 rounded bg-mx-blue/10 text-mx-blue font-mono">
                USD {fmtNum(fx.usd)}
              </span>
              <span className="px-2 py-0.5 rounded bg-mx-amber/10 text-mx-amber font-mono">
                JPY(100) {fmtNum(fx.jpy100)}
              </span>
            </>
          ) : (
            <span className="text-mx-text-secondary">{fxMsg}</span>
          )}
          <Button variant="ghost" size="sm" onClick={loadFx}>갱신</Button>
        </div>
      </div>

      {/* ── Product Detail Generator ──────────────────────── */}
      <Card accent="purple">
        <h2 className="text-sm font-bold text-mx-text mb-3">상세페이지 생성 (AI)</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <div className={labelCls}>상품명 (JP) *</div>
            <input
              className={inputCls}
              value={pdForm.product_name}
              onChange={e => setPdForm(p => ({ ...p, product_name: e.target.value }))}
              placeholder="例: 獺祭 純米大吟醸 磨き三割九分"
            />
          </div>
          <div>
            <div className={labelCls}>상품명 (KR)</div>
            <input
              className={inputCls}
              value={pdForm.product_name_kr}
              onChange={e => setPdForm(p => ({ ...p, product_name_kr: e.target.value }))}
              placeholder="닷사이 준마이다이긴조 39"
            />
          </div>
          <div>
            <div className={labelCls}>카테고리</div>
            <select
              className={inputCls}
              value={pdForm.category}
              onChange={e => setPdForm(p => ({ ...p, category: e.target.value }))}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className={labelCls}>용량 (ml)</div>
            <input
              className={inputCls}
              type="number"
              value={pdForm.volume}
              onChange={e => setPdForm(p => ({ ...p, volume: e.target.value }))}
              placeholder="720"
            />
          </div>
          <div>
            <div className={labelCls}>도수 (%)</div>
            <input
              className={inputCls}
              type="number"
              step="0.1"
              value={pdForm.abv}
              onChange={e => setPdForm(p => ({ ...p, abv: e.target.value }))}
              placeholder="16"
            />
          </div>
          <div>
            <div className={labelCls}>판매가 (원)</div>
            <input
              className={inputCls}
              type="number"
              value={pdForm.price}
              onChange={e => setPdForm(p => ({ ...p, price: e.target.value }))}
              placeholder="45000"
            />
          </div>
          <div>
            <div className={labelCls}>공급가 (원)</div>
            <input
              className={inputCls}
              type="number"
              value={pdForm.supply_price}
              onChange={e => setPdForm(p => ({ ...p, supply_price: e.target.value }))}
              placeholder="30000"
            />
          </div>
          <div>
            <div className={labelCls}>AI 모델</div>
            <select
              className={inputCls}
              value={pdModel}
              onChange={e => setPdModel(e.target.value as 'haiku' | 'sonnet')}
            >
              <option value="haiku">기본 (Haiku) ~83원</option>
              <option value="sonnet">고급 (Sonnet) ~276원</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button
              variant="primary"
              size="sm"
              onClick={onGenerate}
              disabled={pdLoading}
            >
              {pdLoading ? '생성 중…' : '상세페이지 생성'}
            </Button>
          </div>
        </div>

        {/* Loading */}
        {pdLoading && (
          <div className="text-xs text-mx-text-secondary py-6 text-center animate-pulse">
            AI가 상품 정보를 분석하고 상세페이지를 생성하고 있습니다…
          </div>
        )}

        {/* Result */}
        {pdResult && !pdLoading && (
          <div className="space-y-3 mt-2">
            {/* Structured Data Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* One-liner & Tags */}
              <div className="bg-mx-bg rounded p-3 border border-mx-border">
                <div className="text-[10px] text-mx-text-secondary mb-1">한줄 소개</div>
                <div className="text-xs text-mx-text mb-2">{pdResult.one_liner}</div>
                <div className="flex flex-wrap gap-1">
                  {pdResult.tags?.map((t, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded-full bg-mx-purple/15 text-mx-purple text-[10px]">
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Specs */}
              <div className="bg-mx-bg rounded p-3 border border-mx-border">
                <div className="text-[10px] text-mx-text-secondary mb-1">스펙</div>
                {pdResult.specs && Object.entries(pdResult.specs).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs py-0.5">
                    <span className="text-mx-text-secondary">{k}</span>
                    <span className="text-mx-text">{v}</span>
                  </div>
                ))}
              </div>

              {/* Tasting */}
              <div className="bg-mx-bg rounded p-3 border border-mx-border">
                <div className="text-[10px] text-mx-text-secondary mb-1">테이스팅 노트</div>
                {pdResult.tasting && Object.entries(pdResult.tasting).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs py-0.5">
                    <span className="text-mx-text-secondary">{k}</span>
                    <span className="text-mx-text">{v}</span>
                  </div>
                ))}
              </div>

              {/* Brewery */}
              <div className="bg-mx-bg rounded p-3 border border-mx-border">
                <div className="text-[10px] text-mx-text-secondary mb-1">양조장 / 브랜드</div>
                {pdResult.brewery && Object.entries(pdResult.brewery).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs py-0.5">
                    <span className="text-mx-text-secondary">{k}</span>
                    <span className="text-mx-text">{v}</span>
                  </div>
                ))}
              </div>

              {/* Awards */}
              {pdResult.awards?.length > 0 && (
                <div className="bg-mx-bg rounded p-3 border border-mx-border">
                  <div className="text-[10px] text-mx-text-secondary mb-1">수상 이력</div>
                  {pdResult.awards.map((a, i) => (
                    <div key={i} className="text-xs text-mx-text py-0.5">- {a}</div>
                  ))}
                </div>
              )}

              {/* Price */}
              <div className="bg-mx-bg rounded p-3 border border-mx-border">
                <div className="text-[10px] text-mx-text-secondary mb-1">가격</div>
                <div className="flex justify-between text-xs py-0.5">
                  <span className="text-mx-text-secondary">판매가</span>
                  <span className="text-mx-text font-mono">{fmtNum(pdResult.price)}원</span>
                </div>
                <div className="flex justify-between text-xs py-0.5">
                  <span className="text-mx-text-secondary">공급가</span>
                  <span className="text-mx-text font-mono">{fmtNum(pdResult.supply_price)}원</span>
                </div>
              </div>
            </div>

            {/* HTML Preview */}
            <div className="border border-mx-border rounded overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-mx-bg border-b border-mx-border">
                <span className="text-[11px] text-mx-text-secondary">상세페이지 HTML 미리보기</span>
                <Button variant="outline" size="sm" onClick={copyHtml}>HTML 복사</Button>
              </div>
              <div
                className="bg-white text-black p-4 max-h-[500px] overflow-y-auto text-sm"
                dangerouslySetInnerHTML={{ __html: pdResult.detail_html }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* ── Cost Master ───────────────────────────────────── */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-mx-text">원가 마스터</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadCosts}>갱신</Button>
            <Button variant="primary" size="sm" onClick={openAddForm}>+ 추가</Button>
          </div>
        </div>

        {/* Cost Form (Add/Edit) */}
        {showCostForm && editRow && (
          <div className="bg-mx-bg border border-mx-border rounded p-3 mb-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
              <div>
                <div className={labelCls}>SKU *</div>
                <input
                  className={inputCls}
                  value={editRow.master_sku}
                  onChange={e => setEditRow(r => r ? { ...r, master_sku: e.target.value } : r)}
                  placeholder="SKU-001"
                />
              </div>
              <div>
                <div className={labelCls}>상품명</div>
                <input
                  className={inputCls}
                  value={editRow.product_name}
                  onChange={e => setEditRow(r => r ? { ...r, product_name: e.target.value } : r)}
                />
              </div>
              <div>
                <div className={labelCls}>매입원가</div>
                <input
                  className={inputCls}
                  type="number"
                  value={editRow.purchase_cost || ''}
                  onChange={e => setEditRow(r => r ? { ...r, purchase_cost: Number(e.target.value) } : r)}
                />
              </div>
              <div>
                <div className={labelCls}>배송비</div>
                <input
                  className={inputCls}
                  type="number"
                  value={editRow.shipping_cost || ''}
                  onChange={e => setEditRow(r => r ? { ...r, shipping_cost: Number(e.target.value) } : r)}
                />
              </div>
              <div>
                <div className={labelCls}>포장비</div>
                <input
                  className={inputCls}
                  type="number"
                  value={editRow.packaging_cost || ''}
                  onChange={e => setEditRow(r => r ? { ...r, packaging_cost: Number(e.target.value) } : r)}
                />
              </div>
              <div>
                <div className={labelCls}>관세</div>
                <input
                  className={inputCls}
                  type="number"
                  value={editRow.tariff_cost || ''}
                  onChange={e => setEditRow(r => r ? { ...r, tariff_cost: Number(e.target.value) } : r)}
                />
              </div>
              <div>
                <div className={labelCls}>기타비용</div>
                <input
                  className={inputCls}
                  type="number"
                  value={editRow.other_cost || ''}
                  onChange={e => setEditRow(r => r ? { ...r, other_cost: Number(e.target.value) } : r)}
                />
              </div>
              <div className="flex items-end gap-1">
                <Button variant="success" size="sm" onClick={onCostSave}>저장</Button>
                <Button variant="ghost" size="sm" onClick={() => { setShowCostForm(false); setEditRow(null); }}>취소</Button>
              </div>
            </div>
          </div>
        )}

        {/* Cost Table */}
        {costsLoading ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">로딩 중…</p>
        ) : costs.length === 0 ? (
          <p className="text-xs text-mx-text-secondary py-4 text-center">등록된 원가 데이터가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-mx-card">
                <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                  <th className="py-1.5 pr-2">SKU</th>
                  <th className="py-1.5 pr-2">상품명</th>
                  <th className="py-1.5 pr-2 text-right">매입원가</th>
                  <th className="py-1.5 pr-2 text-right">배송비</th>
                  <th className="py-1.5 pr-2 text-right">포장비</th>
                  <th className="py-1.5 pr-2 text-right">관세</th>
                  <th className="py-1.5 pr-2 text-right">기타</th>
                  <th className="py-1.5 pr-2 text-right font-bold">합계</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {costs.map(c => (
                  <tr key={c.master_sku} className="border-b border-mx-border/50 hover:bg-mx-border/10">
                    <td className="py-1.5 pr-2 font-mono">{c.master_sku}</td>
                    <td className="py-1.5 pr-2 truncate max-w-[180px]">{c.product_name}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{fmtNum(c.purchase_cost)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{fmtNum(c.shipping_cost)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{fmtNum(c.packaging_cost)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{fmtNum(c.tariff_cost)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{fmtNum(c.other_cost)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono font-bold text-mx-blue">{fmtNum(c.total_cost)}</td>
                    <td className="py-1.5 flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditForm(c)}>수정</Button>
                      <Button variant="ghost" size="sm" className="text-mx-red" onClick={() => onCostDelete(c.master_sku)}>삭제</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
