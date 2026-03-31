'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';

export const runtime = 'edge';

/* ── Types ── */

interface TrendItem {
  keyword: string;
  keyword_ja?: string;
  category: string;
  reason: string;
  searchVolume: string;
  targetAudience: string;
  season: string;
  sources: string[];
}

interface MatchedItem {
  trend: string;
  product: string;
  matchScore: number;
  dmAngle: string;
}

interface NotMatchedItem {
  trend: string;
  category: string;
  suggestedProduct: string;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
}

interface EmailDraft {
  subject: string;
  preview: string;
  headline: string;
  body: string;
  cta: string;
  targetTrend: string;
}

interface InstaDraft {
  caption: string;
  story_text: string;
  dm_text: string;
  hashtags: string[];
  targetTrend: string;
}

interface ThemeItem {
  title: string;
  brief: string;
  timing: string;
  target: string;
  keywords: string;
  category: string;
  confidence: string;
  reason: string;
}

interface RecommendItem {
  product: string;
  supplier: string;
  category: string;
  price: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

interface PriceItem {
  name: string;
  category: string;
  korean_retail_min: number;
  korean_retail_avg: number;
  competitor_count: number;
  competitiveness: string;
  recommended_purchase_price: number;
  import_note: string;
  verdict: string;
}

interface HistoryRun {
  run_id: string;
  scanned_at: string;
  keyword_count: number;
}

type ActiveTab = 'trends' | 'themes' | 'supplier' | 'price';

/* ── Helpers ── */

const VOLUME_COLORS: Record<string, string> = {
  '급등': 'text-mx-red',
  '상승': 'text-mx-amber',
  '보통': 'text-mx-text-secondary',
};

const URGENCY_COLORS: Record<string, string> = {
  high: 'bg-mx-red/20 text-mx-red',
  medium: 'bg-mx-amber/20 text-mx-amber',
  low: 'bg-mx-blue/20 text-mx-blue',
};

const PRIORITY_COLORS = URGENCY_COLORS;

const CONFIDENCE_COLORS: Record<string, string> = {
  '상': 'text-mx-green',
  '중': 'text-mx-amber',
  '하': 'text-mx-text-muted',
};

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${className}`}>
      {children}
    </span>
  );
}

/* ── Page ── */

export default function MarketingPage() {
  const { toast } = useToast();

  // Tab
  const [tab, setTab] = useState<ActiveTab>('trends');

  // Loading states
  const [scanLoading, setScanLoading] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [dmLoading, setDmLoading] = useState(false);
  const [themeLoading, setThemeLoading] = useState(false);
  const [supLoading, setSupLoading] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(false);

  // Data
  const [runId, setRunId] = useState('');
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [trendSummary, setTrendSummary] = useState('');
  const [matched, setMatched] = useState<MatchedItem[]>([]);
  const [notMatched, setNotMatched] = useState<NotMatchedItem[]>([]);
  const [emails, setEmails] = useState<EmailDraft[]>([]);
  const [instas, setInstas] = useState<InstaDraft[]>([]);
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendItem[]>([]);
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [priceSummary, setPriceSummary] = useState('');
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [histOpen, setHistOpen] = useState(false);

  // Filters for trend scan
  const [filterAge, setFilterAge] = useState('');
  const [filterGender, setFilterGender] = useState('');
  const [filterLiquor, setFilterLiquor] = useState('');

  // Supplier recommend
  const [supBrief, setSupBrief] = useState('');
  const [supMax, setSupMax] = useState(10);
  const [supFilter, setSupFilter] = useState('');

  // Price check
  const [priceInput, setPriceInput] = useState('');

  // DM channels
  const [dmChannels, setDmChannels] = useState<string[]>(['인스타 포스팅', '이메일 뉴스레터']);

  /* ── API calls ── */

  const mktApi = useCallback(async <T = Record<string, unknown>>(body: Record<string, unknown>) => {
    return api<T>('marketing', body);
  }, []);

  const doTrendScan = async () => {
    setScanLoading(true);
    const filters: Record<string, unknown> = {};
    if (filterAge) filters.age = filterAge;
    if (filterGender) filters.gender = filterGender;
    if (filterLiquor) filters.liquor = filterLiquor;

    const res = await mktApi<{ runId: string; trends: TrendItem[]; summary: string }>({
      action: 'trend_scan', filters,
    });
    if (res.ok) {
      setRunId(res.runId);
      setTrends(res.trends);
      setTrendSummary(res.summary);
      // reset downstream
      setMatched([]); setNotMatched([]); setEmails([]); setInstas([]);
      toast('트렌드 스캔 완료', 'success');
    } else {
      toast(('message' in res ? res.message : res.error) || '스캔 실패', 'error');
    }
    setScanLoading(false);
  };

  const doMatch = async () => {
    if (!runId) { toast('트렌드 스캔을 먼저 실행하세요', 'warn'); return; }
    setMatchLoading(true);
    const res = await mktApi<{ matched: MatchedItem[]; notMatched: NotMatchedItem[] }>({
      action: 'match', run_id: runId,
    });
    if (res.ok) {
      setMatched(res.matched);
      setNotMatched(res.notMatched);
      toast('매칭 완료', 'success');
    } else {
      toast(('message' in res ? res.message : res.error) || '매칭 실패', 'error');
    }
    setMatchLoading(false);
  };

  const doDmDraft = async () => {
    if (!runId) { toast('트렌드 스캔을 먼저 실행하세요', 'warn'); return; }
    setDmLoading(true);
    const res = await mktApi<{ emails: EmailDraft[]; instagram: InstaDraft[] }>({
      action: 'dm_draft', run_id: runId, filters: { distChannels: dmChannels },
    });
    if (res.ok) {
      setEmails(res.emails || []);
      setInstas(res.instagram || []);
      toast('DM 초안 생성 완료', 'success');
    } else {
      toast(('message' in res ? res.message : res.error) || 'DM 생성 실패', 'error');
    }
    setDmLoading(false);
  };

  const doThemes = async () => {
    setThemeLoading(true);
    const res = await mktApi<{ themes: ThemeItem[] }>({ action: 'suggest_themes' });
    if (res.ok) {
      setThemes(res.themes);
      toast('기획전 테마 추천 완료', 'success');
    } else {
      toast(('message' in res ? res.message : res.error) || '테마 추천 실패', 'error');
    }
    setThemeLoading(false);
  };

  const doSupplierRecommend = async () => {
    if (!supBrief.trim()) { toast('기획전 조건을 입력하세요', 'warn'); return; }
    setSupLoading(true);
    const res = await mktApi<{ recommendations: RecommendItem[] }>({
      action: 'supplier_recommend', brief: supBrief, maxResults: supMax, supplierFilter: supFilter,
    });
    if (res.ok) {
      setRecommendations(res.recommendations);
      toast('상품 추천 완료', 'success');
    } else {
      toast(('message' in res ? res.message : res.error) || '추천 실패', 'error');
    }
    setSupLoading(false);
  };

  const doPriceCheck = async () => {
    const lines = priceInput.trim().split('\n').filter(Boolean);
    if (!lines.length) { toast('상품명을 입력하세요', 'warn'); return; }
    setPriceLoading(true);
    const products = lines.map(l => {
      const parts = l.split(/[,\t]/);
      return { name: parts[0].trim(), category: parts[1]?.trim() || '' };
    });
    const res = await mktApi<{ prices: PriceItem[]; summary: string }>({
      action: 'price_check', run_id: runId || undefined, products,
    });
    if (res.ok) {
      setPrices(res.prices);
      setPriceSummary(res.summary);
      toast('가격 조사 완료', 'success');
    } else {
      toast(('message' in res ? res.message : res.error) || '가격 조사 실패', 'error');
    }
    setPriceLoading(false);
  };

  const loadHistory = async () => {
    setHistLoading(true);
    const res = await mktApi<{ runs: HistoryRun[] }>({ action: 'get_history', limit: 20 });
    if (res.ok) setHistory(res.runs);
    setHistLoading(false);
  };

  const loadRun = async (rid: string) => {
    setScanLoading(true);
    const res = await mktApi<{
      trends: TrendItem[];
      matches: Array<MatchedItem & NotMatchedItem & { type: string }>;
      drafts: EmailDraft[];
      prices: PriceItem[];
    }>({ action: 'load_run', run_id: rid });
    if (res.ok) {
      setRunId(rid);
      setTrends(res.trends || []);
      const m = (res.matches || []).filter((x: { type: string }) => x.type === 'matched') as unknown as MatchedItem[];
      const nm = (res.matches || []).filter((x: { type: string }) => x.type === 'not_matched') as unknown as NotMatchedItem[];
      setMatched(m);
      setNotMatched(nm);
      setEmails(res.drafts || []);
      setPrices(res.prices || []);
      setTab('trends');
      toast(`${rid} 로드 완료`, 'success');
    } else {
      toast('로드 실패', 'error');
    }
    setScanLoading(false);
  };

  useEffect(() => {
    if (histOpen) loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histOpen]);

  /* ── Tab buttons ── */
  const tabs: { key: ActiveTab; label: string }[] = [
    { key: 'trends', label: '트렌드 스캔' },
    { key: 'themes', label: '기획전 테마' },
    { key: 'supplier', label: '상품 추천' },
    { key: 'price', label: '가격 조사' },
  ];

  const toggleChannel = (ch: string) => {
    setDmChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);
  };

  return (
    <div className="flex gap-4">
      {/* ── Main Content ── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold text-mx-text">마케팅 AI</h1>
          <div className="flex items-center gap-2">
            {runId && (
              <span className="text-[10px] font-mono text-mx-text-muted bg-mx-bg px-2 py-0.5 rounded">
                {runId}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setHistOpen(prev => !prev)}>
              {histOpen ? '히스토리 닫기' : '히스토리'}
            </Button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-mx-border pb-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                tab === t.key
                  ? 'bg-mx-card text-mx-text border border-mx-border border-b-transparent -mb-[1px]'
                  : 'text-mx-text-muted hover:text-mx-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB: Trends ── */}
        {tab === 'trends' && (
          <div className="space-y-4">
            {/* Scan filters */}
            <Card className="p-4">
              <h3 className="text-xs font-bold text-mx-text-secondary mb-3">트렌드 스캔 필터</h3>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-mx-text-muted">
                  연령대
                  <input
                    value={filterAge}
                    onChange={e => setFilterAge(e.target.value)}
                    placeholder="예: 25-35"
                    className="block mt-1 bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-24"
                  />
                </label>
                <label className="text-xs text-mx-text-muted">
                  성별
                  <select
                    value={filterGender}
                    onChange={e => setFilterGender(e.target.value)}
                    className="block mt-1 bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-20"
                  >
                    <option value="">전체</option>
                    <option value="남성">남성</option>
                    <option value="여성">여성</option>
                  </select>
                </label>
                <label className="text-xs text-mx-text-muted">
                  주종
                  <select
                    value={filterLiquor}
                    onChange={e => setFilterLiquor(e.target.value)}
                    className="block mt-1 bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-28"
                  >
                    <option value="">전체</option>
                    <option value="위스키">위스키</option>
                    <option value="사케">사케</option>
                    <option value="소주">소주</option>
                    <option value="매실주">매실주/리큐르</option>
                    <option value="맥주">맥주</option>
                    <option value="와인">와인</option>
                    <option value="RTD">RTD</option>
                  </select>
                </label>
                <Button size="sm" onClick={doTrendScan} disabled={scanLoading}>
                  {scanLoading ? '스캔 중…' : '트렌드 스캔'}
                </Button>
              </div>
            </Card>

            {/* Trend summary */}
            {trendSummary && (
              <div className="text-xs text-mx-text-secondary bg-mx-bg border border-mx-border rounded px-3 py-2">
                {trendSummary}
              </div>
            )}

            {/* Trend cards */}
            {trends.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {trends.map((t, i) => (
                  <Card key={i} className="p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-mx-text">{t.keyword}</p>
                        {t.keyword_ja && <p className="text-[10px] text-mx-text-muted">{t.keyword_ja}</p>}
                      </div>
                      <Badge className="bg-mx-border/50 text-mx-text-secondary">{t.category}</Badge>
                    </div>
                    <p className="text-xs text-mx-text-secondary">{t.reason}</p>
                    <div className="flex items-center gap-2 text-[10px] text-mx-text-muted">
                      <span className={VOLUME_COLORS[t.searchVolume] || ''}>검색: {t.searchVolume}</span>
                      <span>·</span>
                      <span>{t.targetAudience}</span>
                      <span>·</span>
                      <span>{t.season}</span>
                    </div>
                    {t.sources?.length > 0 && (
                      <div className="text-[10px] text-mx-text-muted truncate">
                        {t.sources.map((s, j) => (
                          <a key={j} href={s} target="_blank" rel="noreferrer" className="text-mx-blue hover:underline mr-2">
                            출처{j + 1}
                          </a>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {/* Match + DM section */}
            {trends.length > 0 && (
              <Card className="p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-mx-text-secondary">매칭 & DM</h3>
                  <Button size="sm" variant="outline" onClick={doMatch} disabled={matchLoading}>
                    {matchLoading ? '매칭 중…' : '재고 매칭'}
                  </Button>
                  <div className="flex items-center gap-1 ml-2">
                    {['인스타 포스팅', '이메일 뉴스레터'].map(ch => (
                      <button
                        key={ch}
                        onClick={() => toggleChannel(ch)}
                        className={`px-2 py-0.5 text-[10px] rounded border ${
                          dmChannels.includes(ch)
                            ? 'border-mx-blue text-mx-blue bg-mx-blue/10'
                            : 'border-mx-border text-mx-text-muted'
                        }`}
                      >
                        {ch.includes('인스타') ? '인스타' : '이메일'}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" onClick={doDmDraft} disabled={dmLoading || (!matched.length && !trends.length)}>
                    {dmLoading ? 'DM 생성 중…' : 'DM 초안 생성'}
                  </Button>
                </div>

                {/* Matched products */}
                {matched.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-mx-green mb-2">매칭됨 ({matched.length})</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                            <th className="py-1 pr-3">트렌드</th>
                            <th className="py-1 pr-3">상품</th>
                            <th className="py-1 pr-3 text-right">점수</th>
                            <th className="py-1">DM 앵글</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matched.map((m, i) => (
                            <tr key={i} className="border-b border-mx-border/50">
                              <td className="py-1 pr-3">{m.trend}</td>
                              <td className="py-1 pr-3 text-mx-cyan">{m.product}</td>
                              <td className="py-1 pr-3 text-right font-mono">{m.matchScore}</td>
                              <td className="py-1 text-mx-text-secondary">{m.dmAngle}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Not matched */}
                {notMatched.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-mx-amber mb-2">미보유 트렌드 ({notMatched.length})</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                            <th className="py-1 pr-3">트렌드</th>
                            <th className="py-1 pr-3">카테고리</th>
                            <th className="py-1 pr-3">추천 상품</th>
                            <th className="py-1 pr-3">사유</th>
                            <th className="py-1">긴급도</th>
                          </tr>
                        </thead>
                        <tbody>
                          {notMatched.map((n, i) => (
                            <tr key={i} className="border-b border-mx-border/50">
                              <td className="py-1 pr-3">{n.trend}</td>
                              <td className="py-1 pr-3">{n.category}</td>
                              <td className="py-1 pr-3 text-mx-cyan">{n.suggestedProduct}</td>
                              <td className="py-1 pr-3 text-mx-text-secondary">{n.reason}</td>
                              <td className="py-1">
                                <Badge className={URGENCY_COLORS[n.urgency] || ''}>{n.urgency}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Email drafts */}
                {emails.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-mx-blue mb-2">이메일 초안 ({emails.length})</h4>
                    <div className="space-y-3">
                      {emails.map((e, i) => (
                        <Card key={i} accent="blue" className="p-3 space-y-1">
                          <p className="text-xs font-bold text-mx-text">{e.subject}</p>
                          {e.preview && <p className="text-[10px] text-mx-text-muted">{e.preview}</p>}
                          {e.headline && <p className="text-xs text-mx-cyan font-medium">{e.headline}</p>}
                          <p className="text-xs text-mx-text-secondary whitespace-pre-wrap">{e.body}</p>
                          {e.cta && (
                            <p className="text-xs">
                              <span className="text-mx-text-muted">CTA:</span>{' '}
                              <span className="text-mx-green font-medium">{e.cta}</span>
                            </p>
                          )}
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Instagram drafts */}
                {instas.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-mx-purple mb-2">인스타그램 초안 ({instas.length})</h4>
                    <div className="space-y-3">
                      {instas.map((ig, i) => (
                        <Card key={i} accent="purple" className="p-3 space-y-1.5">
                          <p className="text-xs text-mx-text whitespace-pre-wrap">{ig.caption}</p>
                          {ig.story_text && (
                            <p className="text-[10px] text-mx-text-secondary">
                              <span className="text-mx-text-muted">스토리:</span> {ig.story_text}
                            </p>
                          )}
                          {ig.dm_text && (
                            <p className="text-[10px] text-mx-text-secondary">
                              <span className="text-mx-text-muted">DM:</span> {ig.dm_text}
                            </p>
                          )}
                          {ig.hashtags?.length > 0 && (
                            <p className="text-[10px] text-mx-blue">
                              {ig.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
                            </p>
                          )}
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}

        {/* ── TAB: Themes ── */}
        {tab === 'themes' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={doThemes} disabled={themeLoading}>
                {themeLoading ? '추천 중…' : '기획전 테마 추천'}
              </Button>
              <span className="text-[10px] text-mx-text-muted">AI가 거래처 상품 + 최신 트렌드 기반으로 기획전 테마를 추천합니다</span>
            </div>

            {themes.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {themes.map((t, i) => (
                  <Card key={i} className="p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold text-mx-text">{t.title}</p>
                      <span className={`text-[10px] font-bold ${CONFIDENCE_COLORS[t.confidence] || ''}`}>
                        {t.confidence}
                      </span>
                    </div>
                    <p className="text-xs text-mx-text-secondary">{t.brief}</p>
                    <div className="flex flex-wrap gap-2 text-[10px] text-mx-text-muted">
                      {t.timing && <span>시기: {t.timing}</span>}
                      {t.target && <span>· 타겟: {t.target}</span>}
                      {t.category && <span>· {t.category}</span>}
                    </div>
                    {t.keywords && (
                      <p className="text-[10px] text-mx-blue">{t.keywords}</p>
                    )}
                    {t.reason && (
                      <p className="text-[10px] text-mx-text-muted italic">{t.reason}</p>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Supplier Recommend ── */}
        {tab === 'supplier' && (
          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="text-xs font-bold text-mx-text-secondary mb-3">기획전 상품 추천</h3>
              <div className="space-y-3">
                <label className="text-xs text-mx-text-muted block">
                  기획전 조건 / 브리프
                  <textarea
                    value={supBrief}
                    onChange={e => setSupBrief(e.target.value)}
                    placeholder="예: 여름 하이볼 기획전, 가격대 2-5만원, 위스키+소주 중심"
                    rows={3}
                    className="block mt-1 w-full bg-mx-bg border border-mx-border rounded px-2 py-1.5 text-xs text-mx-text resize-none"
                  />
                </label>
                <div className="flex items-end gap-3">
                  <label className="text-xs text-mx-text-muted">
                    최대 결과
                    <input
                      type="number"
                      value={supMax}
                      onChange={e => setSupMax(Number(e.target.value) || 10)}
                      min={1}
                      max={50}
                      className="block mt-1 bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-16"
                    />
                  </label>
                  <label className="text-xs text-mx-text-muted">
                    거래처 필터 (ID)
                    <input
                      value={supFilter}
                      onChange={e => setSupFilter(e.target.value)}
                      placeholder="비우면 전체"
                      className="block mt-1 bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text w-32"
                    />
                  </label>
                  <Button size="sm" onClick={doSupplierRecommend} disabled={supLoading}>
                    {supLoading ? '추천 중…' : '상품 추천'}
                  </Button>
                </div>
              </div>
            </Card>

            {recommendations.length > 0 && (
              <Card className="p-4">
                <h3 className="text-xs font-bold text-mx-text-secondary mb-3">추천 결과 ({recommendations.length})</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                        <th className="py-1.5 pr-3">상품</th>
                        <th className="py-1.5 pr-3">거래처</th>
                        <th className="py-1.5 pr-3">카테고리</th>
                        <th className="py-1.5 pr-3">가격</th>
                        <th className="py-1.5 pr-3">추천 사유</th>
                        <th className="py-1.5">우선순위</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recommendations.map((r, i) => (
                        <tr key={i} className="border-b border-mx-border/50">
                          <td className="py-1.5 pr-3 text-mx-cyan font-medium">{r.product}</td>
                          <td className="py-1.5 pr-3">{r.supplier}</td>
                          <td className="py-1.5 pr-3">{r.category}</td>
                          <td className="py-1.5 pr-3 font-mono">{r.price}</td>
                          <td className="py-1.5 pr-3 text-mx-text-secondary max-w-[200px] truncate">{r.reason}</td>
                          <td className="py-1.5">
                            <Badge className={PRIORITY_COLORS[r.priority] || ''}>{r.priority}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ── TAB: Price Check ── */}
        {tab === 'price' && (
          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="text-xs font-bold text-mx-text-secondary mb-3">한국 시장 가격 조사</h3>
              <div className="space-y-3">
                <label className="text-xs text-mx-text-muted block">
                  상품 목록 (한 줄에 하나, 쉼표로 카테고리 구분 가능)
                  <textarea
                    value={priceInput}
                    onChange={e => setPriceInput(e.target.value)}
                    placeholder={`예:\n야마자키 12년, 위스키\n잇카몬 사케\n짐빔 하이볼`}
                    rows={5}
                    className="block mt-1 w-full bg-mx-bg border border-mx-border rounded px-2 py-1.5 text-xs text-mx-text font-mono resize-none"
                  />
                </label>
                <Button size="sm" onClick={doPriceCheck} disabled={priceLoading}>
                  {priceLoading ? '조사 중…' : '가격 조사'}
                </Button>
              </div>
            </Card>

            {priceSummary && (
              <div className="text-xs text-mx-text-secondary bg-mx-bg border border-mx-border rounded px-3 py-2">
                {priceSummary}
              </div>
            )}

            {prices.length > 0 && (
              <Card className="p-4">
                <h3 className="text-xs font-bold text-mx-text-secondary mb-3">가격 조사 결과 ({prices.length})</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-mx-border text-left text-mx-text-secondary">
                        <th className="py-1.5 pr-3">상품</th>
                        <th className="py-1.5 pr-3">카테고리</th>
                        <th className="py-1.5 pr-3 text-right">최저가</th>
                        <th className="py-1.5 pr-3 text-right">평균가</th>
                        <th className="py-1.5 pr-3 text-right">경쟁사 수</th>
                        <th className="py-1.5 pr-3">경쟁력</th>
                        <th className="py-1.5 pr-3 text-right">권장 매입가</th>
                        <th className="py-1.5">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prices.map((p, i) => (
                        <tr key={i} className="border-b border-mx-border/50">
                          <td className="py-1.5 pr-3 font-medium">{p.name}</td>
                          <td className="py-1.5 pr-3">{p.category}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{p.korean_retail_min?.toLocaleString()}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{p.korean_retail_avg?.toLocaleString()}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{p.competitor_count}</td>
                          <td className="py-1.5 pr-3">
                            <Badge className={CONFIDENCE_COLORS[p.competitiveness] || 'bg-mx-border/50 text-mx-text-secondary'}>
                              {p.competitiveness}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono text-mx-green">
                            {p.recommended_purchase_price?.toLocaleString()}
                          </td>
                          <td className="py-1.5 text-mx-text-muted max-w-[200px] truncate">{p.verdict || p.import_note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* ── History sidebar ── */}
      {histOpen && (
        <div className="w-56 shrink-0">
          <Card className="p-3 sticky top-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-mx-text-secondary">히스토리</h3>
              <Button variant="ghost" size="sm" onClick={loadHistory} disabled={histLoading}>
                {histLoading ? '…' : '새로고침'}
              </Button>
            </div>
            {history.length === 0 ? (
              <p className="text-[10px] text-mx-text-muted text-center py-4">기록 없음</p>
            ) : (
              <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                {history.map(h => (
                  <button
                    key={h.run_id}
                    onClick={() => loadRun(h.run_id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-[10px] transition-colors ${
                      runId === h.run_id
                        ? 'bg-mx-blue/20 text-mx-blue'
                        : 'text-mx-text-secondary hover:bg-mx-border/30'
                    }`}
                  >
                    <p className="font-mono truncate">{h.run_id}</p>
                    <p className="text-mx-text-muted">
                      {h.scanned_at?.substring(0, 16)} · {h.keyword_count}개
                    </p>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
