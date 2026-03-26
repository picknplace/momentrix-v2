'use client';

import { ReactNode } from 'react';

interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'center' | 'right';
  mono?: boolean;
  render?: (row: T, idx: number) => ReactNode;
  width?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  emptyText?: string;
  className?: string;
  onRowClick?: (row: T, idx: number) => void;
  stickyHeader?: boolean;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  emptyText = '데이터 없음',
  className = '',
  onRowClick,
  stickyHeader = false,
}: TableProps<T>) {
  const alignClass = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  return (
    <div className={`overflow-auto ${className}`}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className={stickyHeader ? 'sticky top-0 z-10' : ''}>
            {columns.map(col => (
              <th
                key={col.key}
                className={`
                  px-3 py-2 bg-mx-topbar text-mx-text-secondary font-medium
                  border-b border-mx-border text-xs uppercase tracking-wider
                  ${alignClass[col.align || 'left']}
                `}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-mx-text-muted"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row, idx) => (
              <tr
                key={idx}
                className={`
                  border-b border-mx-border/50
                  ${idx % 2 === 1 ? 'bg-mx-bg/30' : ''}
                  ${onRowClick ? 'cursor-pointer hover:bg-mx-border/20' : ''}
                `}
                onClick={() => onRowClick?.(row, idx)}
              >
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={`
                      px-3 py-2
                      ${alignClass[col.align || 'left']}
                      ${col.mono ? 'font-mono' : ''}
                    `}
                  >
                    {col.render
                      ? col.render(row, idx)
                      : (row[col.key] as ReactNode) ?? '-'}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
