import { cn } from '../../lib/cn';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Spinner';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Hide on small screens — tables stay readable on a phone. */
  hideOnMobile?: boolean;
}

/**
 * Data table used by every admin screen.
 * Loading → skeleton rows. Empty → EmptyState. Errors are handled by the caller
 * with <ErrorState /> so each screen can offer the right recovery action.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  isLoading,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  onRowClick,
  page,
  pageSize,
  total,
  onPageChange,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
}) {
  const totalPages = page && pageSize && total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : undefined;

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50/70">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-500',
                    column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                    column.hideOnMobile && 'hidden md:table-cell',
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-ink-100 last:border-0">
                    {columns.map((column) => (
                      <td key={column.key} className={cn('px-4 py-3.5', column.hideOnMobile && 'hidden md:table-cell')}>
                        <Skeleton className="h-4 w-full max-w-[160px]" />
                      </td>
                    ))}
                  </tr>
                ))
              : (rows ?? []).map((row) => (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'border-b border-ink-100 last:border-0 transition-colors',
                      onRowClick && 'cursor-pointer hover:bg-ink-50',
                    )}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          'px-4 py-3.5 align-middle text-ink-700',
                          column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                          column.hideOnMobile && 'hidden md:table-cell',
                          column.className,
                        )}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {!isLoading && (rows ?? []).length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}

      {totalPages && totalPages > 1 && page && onPageChange && (
        <div className="flex items-center justify-between gap-3 border-t border-ink-200 px-4 py-3">
          <p className="text-xs text-ink-500">
            Page {page} of {totalPages}
            {total !== undefined && ` · ${total} records`}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
