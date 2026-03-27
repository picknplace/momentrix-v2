/**
 * Shared parser utilities — ported from Code.gs findHeader / parseDateFromFileName
 */

export function findHeader(headers: string[], candidates: string[]): number {
  // 정확 일치
  for (const c of candidates) {
    const idx = headers.indexOf(c);
    if (idx !== -1) return idx;
  }
  // 부분 일치
  for (const c of candidates) {
    for (let k = 0; k < headers.length; k++) {
      if (headers[k].includes(c)) return k;
    }
  }
  return -1;
}

export function str(row: unknown[], idx: number): string {
  if (idx < 0 || idx >= row.length) return '';
  return String(row[idx] ?? '').trim();
}

export function num(row: unknown[], idx: number): number {
  if (idx < 0 || idx >= row.length) return 0;
  return parseFloat(String(row[idx] ?? '').replace(/[^0-9.\-]/g, '')) || 0;
}

export function int(row: unknown[], idx: number): number {
  if (idx < 0 || idx >= row.length) return 0;
  return parseInt(String(row[idx] ?? '').replace(/[^0-9\-]/g, ''), 10) || 0;
}

/**
 * 파일명에서 날짜 추출
 * - YYYY-MM-DD, YYYY_MM_DD
 * - YYYYMMDD
 * - MMDD (현재 연도 기준)
 */
export function parseDateFromFileName(fileName: string): string | null {
  // YYYY-MM-DD or YYYY_MM_DD
  let m = fileName.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // YYYYMMDD
  m = fileName.match(/(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const mm = parseInt(m[2], 10);
    const dd = parseInt(m[3], 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
  }

  // MMDD (current year)
  m = fileName.match(/(\d{2})(\d{2})/);
  if (m) {
    const mm = parseInt(m[1], 10);
    const dd = parseInt(m[2], 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const yr = new Date().getFullYear();
      return `${yr}-${m[1]}-${m[2]}`;
    }
  }

  return null;
}

export function generateImportId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'IMP_';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export function nowKST(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace('T', ' ');
}
