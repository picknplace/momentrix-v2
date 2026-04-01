'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import * as XLSX from 'xlsx';

/* ── Column auto-detection keys ── */
const PLAT_KEYS = ['판매중개자명', '플랫폼', 'platform', '판매자', '마켓'];
const ORDER_KEYS = ['비고', 'REF INFO1', 'AU', 'REMARK', 'remark'];
const TRACK_KEYS = ['HAWB No', 'HAWB NO', 'HAWB', '국내택배', '운송장', '송장', 'tracking'];
const PANTOS_KEYS = ['ORDER NO.', 'ORDER NO', 'ORDER_NO', 'OrdId', 'ordId'];
const HAWB_KEYS = ['HAWB No', 'HAWB NO', 'HAWB'];
const SHIP_DATE_KEYS = ['발송일', 'SHIP DATE', '출고일', 'ship_date'];

interface ParsedRow {
  market_id: string;
  order_id: string;
  tracking_no: string;
  ship_date: string;
  pantos_ord_id: string;
  hawb_no: string;
}

interface ShipUploadProps {
  onClose: () => void;
  onDone: () => void;
}

function detectCol(cols: string[], keys: string[]): string {
  for (const k of keys) {
    const found = cols.find(c => c.toUpperCase().includes(k.toUpperCase()));
    if (found) return found;
  }
  return cols[0] || '';
}

function today8() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function dlBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ShipUpload({ onClose, onDone }: ShipUploadProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // Raw rows from file
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');

  // Column mapping
  const [platCol, setPlatCol] = useState('');
  const [orderCol, setOrderCol] = useState('');
  const [trackCol, setTrackCol] = useState('');

  // Platform value mapping
  const [dsVal, setDsVal] = useState('데일리샷');
  const [khVal, setKhVal] = useState('키햐');

  // Parsed results
  const [dsItems, setDsItems] = useState<ParsedRow[]>([]);
  const [khItems, setKhItems] = useState<ParsedRow[]>([]);
  const [dmItems, setDmItems] = useState<ParsedRow[]>([]);
  const [processed, setProcessed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');

  /* ── File load ── */
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setProcessed(false);
    setStatus('파일 읽는 중…');

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

        if (!rows.length) { setStatus('빈 파일입니다.'); return; }

        const colNames = Object.keys(rows[0]);
        const colStr = colNames.join('|');

        // Validate it's a shipping file
        if (!colStr.includes('HAWB') && !colStr.includes('발송일') && !colStr.includes('MAWB') && !colStr.includes('SHIP DATE')) {
          setStatus('배송사 운송장 파일이 아닙니다. (HAWB/발송일 컬럼 필요)');
          return;
        }

        setCols(colNames);
        setRawRows(rows);

        // Auto-detect columns
        setPlatCol(detectCol(colNames, PLAT_KEYS));
        setOrderCol(detectCol(colNames, ORDER_KEYS));
        setTrackCol(detectCol(colNames, TRACK_KEYS));

        // Detect platform values
        const platValues = [...new Set(rows.map(r => String(r[detectCol(colNames, PLAT_KEYS)] || '').trim()).filter(Boolean))];
        setStatus(`${rows.length}행 로드 완료. 플랫폼: ${platValues.join(' / ')}`);
      } catch (err) {
        setStatus('파일 파싱 오류: ' + (err as Error).message);
      }
    };
    reader.readAsArrayBuffer(f);
  };

  /* ── Process ── */
  const processFile = () => {
    if (!rawRows.length) { setStatus('파일을 먼저 업로드하세요.'); return; }

    const pantosCol = detectCol(cols, PANTOS_KEYS);
    const hawbCol = detectCol(cols, HAWB_KEYS);
    const shipDateCol = detectCol(cols, SHIP_DATE_KEYS);

    const ds: ParsedRow[] = [];
    const kh: ParsedRow[] = [];
    const dm: ParsedRow[] = [];
    let skipped = 0;

    const dsIds = new Set<string>();
    const khIds = new Set<string>();
    const dmIds = new Set<string>();

    for (const row of rawRows) {
      const plat = String(row[platCol] || '').trim();
      const orderId = String(row[orderCol] || '').trim();
      const trackNo = String(row[trackCol] || '').trim();
      if (!orderId || !trackNo) { skipped++; continue; }

      const shipDate = String(row[shipDateCol] || '').trim().substring(0, 10);
      const pantosOrdId = pantosCol ? String(row[pantosCol] || '').trim() : '';
      const hawbNo = hawbCol ? String(row[hawbCol] || '').trim() : '';

      const item: ParsedRow = { market_id: '', order_id: orderId, tracking_no: trackNo, ship_date: shipDate, pantos_ord_id: pantosOrdId, hawb_no: hawbNo };

      if (plat === dsVal) {
        if (!dsIds.has(orderId)) { item.market_id = 'dailyshot'; ds.push(item); dsIds.add(orderId); }
      } else if (plat === khVal) {
        if (!khIds.has(orderId)) { item.market_id = 'kihya'; kh.push(item); khIds.add(orderId); }
      } else if (orderId.match(/^J\d/)) {
        if (!dmIds.has(orderId)) { item.market_id = 'dmonkey'; dm.push(item); dmIds.add(orderId); }
      }
    }

    setDsItems(ds);
    setKhItems(kh);
    setDmItems(dm);
    setProcessed(true);

    const skipMsg = skipped ? ` (빈행 제외: ${skipped}건)` : '';
    setStatus(`DS ${ds.length}건 | KH ${kh.length}건 | 드몽 ${dm.length}건 완료${skipMsg}`);
  };

  /* ── Upload to DB ── */
  const uploadToDB = async () => {
    const allItems = [...dsItems, ...khItems, ...dmItems];
    if (!allItems.length) { toast('업로드할 데이터가 없습니다.', 'warn'); return; }

    setUploading(true);
    setStatus('DB 업데이트 중…');

    const updates = allItems.map(item => ({
      order_id: item.order_id,
      sub_order_id: item.market_id === 'kihya' ? item.order_id : undefined,
      tracking_no: item.tracking_no,
      ship_date: item.ship_date || undefined,
    }));

    const res = await api<{ ok: boolean; message: string }>('shipping', { updates });
    setUploading(false);

    if (res?.ok) {
      setStatus(`DB 업데이트 완료: ${res.message}`);
      toast(res.message, 'success');
      onDone();
    } else {
      setStatus('업데이트 실패: ' + (res?.message || ''));
      toast(res?.message || '실패', 'error');
    }
  };

  /* ── Downloads ── */
  const dlDsCsv = () => {
    if (!dsItems.length) return;
    const csv = '\uFEFF주문번호,택배사(이름),송장번호\n' +
      dsItems.map(r => `${r.order_id},판토스,${r.tracking_no}`).join('\n');
    dlBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `dailyshot_송장등록_${today8()}.csv`);
    toast(`DS ${dsItems.length}건 CSV 다운로드`, 'success');
  };

  const dlKhXlsx = () => {
    if (!khItems.length) return;
    const hdr = ['공급사명', '주문일자', '주문 번호', '상품주문번호', '모델명', '상품 코드', '상품명',
      '상품수량', '매입가', '수취인 이름', '통관고유부호', '수취인 전화번호', '수취인 핸드폰 번호',
      '수취인 우편번호', '수취인 전체주소', '주문시 남기는 글', '송장번호', '비고'];
    const rows: (string | number)[][] = [hdr];
    khItems.forEach(r => {
      rows.push(['드렁큰몽키', '', '', r.order_id, '', '', '', '', '', '', '', '', '', '', '', '', r.tracking_no, '정상']);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 30 },
      { wch: 6 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 6 }];
    XLSX.utils.book_append_sheet(wb, ws, '금일 출고건');
    XLSX.writeFile(wb, `KH_DMONKEY_shipment_${today8()}.xlsx`);
    toast(`KH ${khItems.length}건 엑셀 다운로드`, 'success');
  };

  const dlDmXlsx = () => {
    if (!dmItems.length) return;
    const rows: string[][] = [['송장번호', '묶음번호']];
    dmItems.forEach(r => { rows.push([r.tracking_no, r.order_id]); });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 22 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `basic_upload_delivery_number_${today8()}.xls`);
    toast(`드몽 ${dmItems.length}건 엑셀 다운로드`, 'success');
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 pt-10 overflow-y-auto">
      <div className="bg-mx-card border border-mx-border rounded-lg w-[700px] max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mx-border sticky top-0 bg-mx-card z-10">
          <h2 className="text-sm font-bold text-mx-text">운송장 파일 업로드</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>닫기</Button>
        </div>

        <div className="p-4 space-y-4">
          {/* File input */}
          <div className="flex items-center gap-3">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFileChange} className="hidden" />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>파일 선택</Button>
            <span className="text-xs text-mx-text-secondary">{fileName || '판토스 운송장 엑셀 파일'}</span>
          </div>

          {/* Column mapping */}
          {cols.length > 0 && (
            <Card className="!p-3 space-y-2">
              <h3 className="text-xs font-bold text-mx-text">컬럼 매핑</h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-mx-text-secondary mb-0.5">플랫폼</label>
                  <select value={platCol} onChange={e => setPlatCol(e.target.value)}
                    className="w-full bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text">
                    {cols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-mx-text-secondary mb-0.5">주문번호</label>
                  <select value={orderCol} onChange={e => setOrderCol(e.target.value)}
                    className="w-full bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text">
                    {cols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-mx-text-secondary mb-0.5">송장번호</label>
                  <select value={trackCol} onChange={e => setTrackCol(e.target.value)}
                    className="w-full bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text">
                    {cols.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-mx-text-secondary mb-0.5">DS 플랫폼값</label>
                  <input value={dsVal} onChange={e => setDsVal(e.target.value)}
                    className="w-full bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
                </div>
                <div>
                  <label className="block text-[10px] text-mx-text-secondary mb-0.5">KH 플랫폼값</label>
                  <input value={khVal} onChange={e => setKhVal(e.target.value)}
                    className="w-full bg-mx-bg border border-mx-border rounded px-2 py-1 text-xs text-mx-text" />
                </div>
              </div>
              <Button variant="primary" size="sm" onClick={processFile}>처리</Button>
            </Card>
          )}

          {/* Status */}
          {status && (
            <p className={`text-xs px-3 py-2 rounded ${status.includes('완료') || status.includes('로드') ? 'bg-green-900/30 text-green-300' : status.includes('오류') || status.includes('실패') ? 'bg-red-900/30 text-red-300' : 'bg-blue-900/30 text-blue-300'}`}>
              {status}
            </p>
          )}

          {/* Results */}
          {processed && (
            <div className="space-y-3">
              {/* DS */}
              <Card className="!p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-blue-400">데일리샷 {dsItems.length}건</h3>
                  <Button variant="outline" size="sm" onClick={dlDsCsv} disabled={!dsItems.length}>CSV 다운로드</Button>
                </div>
                {dsItems.length > 0 && (
                  <div className="overflow-x-auto max-h-[120px]">
                    <table className="w-full text-[10px]">
                      <thead><tr className="text-mx-text-secondary border-b border-mx-border">
                        <th className="py-1 pr-2 text-left">No</th><th className="py-1 pr-2 text-left">주문번호</th><th className="py-1 pr-2 text-left">송장번호</th>
                      </tr></thead>
                      <tbody>{dsItems.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-b border-mx-border/30">
                          <td className="py-0.5 pr-2">{i + 1}</td><td className="py-0.5 pr-2 font-mono">{r.order_id}</td><td className="py-0.5 pr-2 font-mono">{r.tracking_no}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                    {dsItems.length > 20 && <p className="text-[10px] text-mx-text-secondary mt-1">+{dsItems.length - 20}건 더</p>}
                  </div>
                )}
              </Card>

              {/* KH */}
              <Card className="!p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-green-400">키하 {khItems.length}건</h3>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={dlKhXlsx} disabled={!khItems.length}>출고리스트 다운로드</Button>
                  </div>
                </div>
                {khItems.length > 0 && (
                  <div className="overflow-x-auto max-h-[120px]">
                    <table className="w-full text-[10px]">
                      <thead><tr className="text-mx-text-secondary border-b border-mx-border">
                        <th className="py-1 pr-2 text-left">No</th><th className="py-1 pr-2 text-left">주문번호</th><th className="py-1 pr-2 text-left">송장번호</th>
                      </tr></thead>
                      <tbody>{khItems.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-b border-mx-border/30">
                          <td className="py-0.5 pr-2">{i + 1}</td><td className="py-0.5 pr-2 font-mono">{r.order_id}</td><td className="py-0.5 pr-2 font-mono">{r.tracking_no}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                    {khItems.length > 20 && <p className="text-[10px] text-mx-text-secondary mt-1">+{khItems.length - 20}건 더</p>}
                  </div>
                )}
              </Card>

              {/* DM */}
              <Card className="!p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-orange-400">드몽 {dmItems.length}건</h3>
                  <Button variant="outline" size="sm" onClick={dlDmXlsx} disabled={!dmItems.length}>송장등록 다운로드</Button>
                </div>
                {dmItems.length > 0 && (
                  <div className="overflow-x-auto max-h-[120px]">
                    <table className="w-full text-[10px]">
                      <thead><tr className="text-mx-text-secondary border-b border-mx-border">
                        <th className="py-1 pr-2 text-left">No</th><th className="py-1 pr-2 text-left">주문번호</th><th className="py-1 pr-2 text-left">송장번호</th>
                      </tr></thead>
                      <tbody>{dmItems.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-b border-mx-border/30">
                          <td className="py-0.5 pr-2">{i + 1}</td><td className="py-0.5 pr-2 font-mono">{r.order_id}</td><td className="py-0.5 pr-2 font-mono">{r.tracking_no}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                    {dmItems.length > 20 && <p className="text-[10px] text-mx-text-secondary mt-1">+{dmItems.length - 20}건 더</p>}
                  </div>
                )}
              </Card>

              {/* Upload button */}
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={uploadToDB} disabled={uploading || (!dsItems.length && !khItems.length && !dmItems.length)}>
                  {uploading ? 'DB 업데이트 중…' : `DB 운송장 업데이트 (${dsItems.length + khItems.length + dmItems.length}건)`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
