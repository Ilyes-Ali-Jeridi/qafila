'use client';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  title: string;
  body?: ReactNode;
}

const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const reduce = useReducedMotion();
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === 'error' ? 9000 : 6000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  const icons = { success: <CheckCircle2 className="size-5 text-success" />, error: <XCircle className="size-5 text-danger" />, info: <Info className="size-5 text-teal" /> };
  const edge = { success: 'before:bg-success', error: 'before:bg-danger', info: 'before:bg-teal' };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div aria-live="polite" className="safe-bottom pointer-events-none fixed inset-x-3 bottom-14 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:items-end">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout={!reduce}
              initial={{ opacity: 0, y: reduce ? 0 : 12, scale: reduce ? 1 : 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: reduce ? 0 : 8, scale: reduce ? 1 : 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className={`glass-strong pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-card p-3 before:absolute before:inset-y-0 before:left-0 before:w-0.5 ${edge[t.tone]}`}
            >
              {icons[t.tone]}
              <div className="min-w-0 text-sm">
                <p className="font-medium">{t.title}</p>
                {t.body ? <div className="mt-0.5 break-words text-ink-muted">{t.body}</div> : null}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
