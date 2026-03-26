/**
 * Date utilities — Asia/Tokyo timezone (consistent with GAS appsscript.json)
 */

const TZ = 'Asia/Tokyo';

export function tokyoNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
}

export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('ko-KR', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function formatDateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('ko-KR', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toISODateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function elapsedDays(from: Date | string): number {
  const start = typeof from === 'string' ? new Date(from) : from;
  const now = tokyoNow();
  return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}
