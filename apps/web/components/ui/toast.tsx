'use client';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  title: string;
  body?: ReactNode;
}

const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === 'error' ? 9000 : 6000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  const icons = { success: <CheckCircle2 className="size-5 text-success" />, error: <XCircle className="size-5 text-danger" />, info: <Info className="size-5 text-indigo" /> };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-14 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end">
        {items.map((t) => (
          <div key={t.id} className={cn('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-line bg-surface p-3 shadow-pop rise')}>
            {icons[t.tone]}
            <div className="min-w-0 text-sm">
              <p className="font-medium">{t.title}</p>
              {t.body ? <div className="mt-0.5 break-words text-ink-muted">{t.body}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
