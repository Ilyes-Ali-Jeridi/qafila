'use client';
import { useQuery } from '@tanstack/react-query';
import type { ZodType } from 'zod';
import { apiGet, ApiRequestError } from '@/lib/api/client';
import { ErrorState, Skeleton } from '@/components/ui/states';

/**
 * Scaffold-stage data screen: loads `path`, shows loading, error and the real error
 * for routes the API has not implemented yet. Track C replaces each usage with the
 * real screen. No placeholder buttons (CLAUDE.md UI rules).
 */
export function ApiScreen<T>({ path, schema, render }: { path: string; schema: ZodType<T>; render: (data: T) => React.ReactNode }) {
  const q = useQuery({ queryKey: [path], queryFn: () => apiGet(path, schema) });
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) {
    const e = q.error;
    const notBuilt = e instanceof ApiRequestError && e.status === 501;
    return <ErrorState title={notBuilt ? 'This screen is not available yet' : 'Could not load'} body={notBuilt ? 'The API route behind it is still being built.' : e.message} onRetry={() => void q.refetch()} />;
  }
  return <>{render(q.data)}</>;
}
