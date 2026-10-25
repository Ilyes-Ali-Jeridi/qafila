'use client';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Native <dialog> modal: focus trapping and Escape come from the browser. */
export function Dialog({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn('m-auto w-[calc(100vw-2rem)] max-w-lg rounded-card border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-transparent', className)}
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="-m-1 rounded-md p-1 text-ink-muted hover:bg-sand-200 hover:text-ink">
          <X className="size-5" />
        </button>
      </div>
      <div className="px-5 pb-5 pt-3">{children}</div>
    </dialog>
  );
}
