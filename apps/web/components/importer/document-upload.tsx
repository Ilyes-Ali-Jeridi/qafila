'use client';
/** One document slot: pick a file, hash it, register it (signed URL), upload it. */
import { CheckCircle2, FileText, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { RegisterDocumentRequest, type DocumentType } from '@qafila/shared';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/states';
import { apiPost, describeError, sha256File, uploadToSignedUrl } from '@/lib/api/client';
import { RegisterDocumentResponseSchema, type DocumentRecord } from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/utils';

export const DOC_LABEL: Record<DocumentType, string> = {
  invoice: 'Pro-forma or commercial invoice',
  packing_list: 'Packing list',
  business_licence: 'Supplier business licence',
  bill_of_lading: 'Bill of lading',
  kyb: 'Company registration',
};

export function DocumentUpload({ dealId, type, existing, onUploaded, hint }: { dealId: string; type: DocumentType; existing?: DocumentRecord | null; onUploaded: (id: string) => void; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploaded = existing?.status === 'uploaded' ? existing : null;

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('The file is over 15 MB.');
      const mime = file.type === 'application/pdf' || file.type === 'image/jpeg' || file.type === 'image/png' ? file.type : null;
      if (!mime) throw new Error('Use a PDF, JPG or PNG.');
      const body = RegisterDocumentRequest.parse({ type, filename: file.name, mime, size: file.size, sha256: await sha256File(file) });
      const r = await apiPost(`/deals/${dealId}/documents`, body, RegisterDocumentResponseSchema);
      await uploadToSignedUrl(r.uploadUrl, r.method, r.headers, file);
      onUploaded(r.documentId);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`doc-${type}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${uploaded ? 'bg-success-100 text-success' : 'bg-indigo-50 text-indigo'}`}>{uploaded ? <CheckCircle2 className="size-4" /> : <FileText className="size-4" />}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{DOC_LABEL[type]}</p>
          {uploaded ? (
            <p className="truncate text-xs text-ink-muted">
              {uploaded.filename} · {Math.round(uploaded.size / 1024)} KB · {formatDateTime(uploaded.uploadedAt)}
            </p>
          ) : (
            <p className="text-xs text-ink-muted">{hint ?? 'PDF, JPG or PNG, up to 15 MB.'}</p>
          )}
          {error ? <div className="mt-1"><InlineError>{error}</InlineError></div> : null}
        </div>
      </div>
      <div className="shrink-0">
        <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" id={`file-${type}`} onChange={(e) => pick(e.target.files?.[0])} />
        <Button variant={uploaded ? 'outline' : 'primary'} size="sm" loading={busy} onClick={() => input.current?.click()} icon={<Upload className="size-4" />}>
          {uploaded ? 'Replace' : 'Upload'}
        </Button>
      </div>
    </div>
  );
}
