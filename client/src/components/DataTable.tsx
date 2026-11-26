import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PageMeta } from '../types/api';
import { cn } from '../utils/format';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: ReactNode;
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  /** Card layout for phones — owners run the property from a phone, so tables must not side-scroll. */
  renderMobile?: (row: T) => ReactNode;
  meta?: PageMeta | undefined;
  onPageChange?: (page: number) => void;
  caption?: string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({ columns, rows, rowKey, loading, error, empty, renderMobile, meta, onPageChange, caption, onRowClick }: DataTableProps<T>) {
  if (loading && !rows) return <LoadingSkeleton variant="table" count={5} label={caption ? `Loading ${caption}` : 'Loading'} />;
  if (error) return <div className="card">{error}</div>;
  if (!rows?.length) {
    return (
      <div className="card">
        <EmptyState icon={<Inbox className="size-6" />} title={empty?.title ?? 'Nothing here yet'} description={empty?.description} action={empty?.action} />
      </div>
    );
  }

  return (
    <div className={cn('card overflow-hidden', loading && 'opacity-70 transition-opacity')}>
      <table className={cn('w-full border-collapse text-left', renderMobile && 'hidden md:table')}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-parchment-alt">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-4 py-3 font-serif text-label-md uppercase tracking-wide text-slate',
                  c.align === 'right' && 'text-right',
                  c.align === 'center' && 'text-center',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn('align-middle transition-colors', onRowClick && 'cursor-pointer hover:bg-forest-50')}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('px-4 py-3.5 text-body-sm', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {renderMobile && (
        <ul className="divide-y divide-line md:hidden">
          {rows.map((row) => (
            <li key={rowKey(row)} className="p-4">
              {renderMobile(row)}
            </li>
          ))}
        </ul>
      )}

      {meta && onPageChange && meta.totalPages > 1 && (
        <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-3" aria-label="Pagination">
          <p className="text-body-sm text-slate">
            Page <span className="num font-semibold">{meta.page}</span> of <span className="num">{meta.totalPages}</span> ·{' '}
            <span className="num">{meta.total}</span> total
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onPageChange(meta.page - 1)}
              disabled={meta.page <= 1}
              className="inline-flex size-9 items-center justify-center rounded-full border border-line text-forest disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onPageChange(meta.page + 1)}
              disabled={meta.page >= meta.totalPages}
              className="inline-flex size-9 items-center justify-center rounded-full border border-line text-forest disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
