'use client';
/** B-1: the Sharia board edits the halal goods policy and thresholds; ops reads it. */
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { OpsShell, useIsSharia } from '@/components/ops/ops-shell';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ErrorState, InlineError, InlineNotice, SkeletonCard } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { apiPut, describeError } from '@/lib/api/client';
import { useOpsPolicy } from '@/lib/api/hooks';
import { PolicySchema, type Policy } from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/utils';

export function OpsPolicy() {
  return (
    <OpsShell title="Halal policy" lead="Categories the screening may use and the thresholds behind review and reject. Only the Sharia board can change them.">
      <Inner />
    </OpsShell>
  );
}

function Inner() {
  const q = useOpsPolicy();
  const sharia = useIsSharia();
  const toast = useToast();
  const [edited, setEdited] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (q.isPending) return <SkeletonCard lines={8} />;
  if (q.isError) return <ErrorState title="Could not load the policy" body={describeError(q.error)} onRetry={() => void q.refetch()} />;
  // The draft starts from the server copy and diverges only once the board edits something.
  const draft: Policy = edited ?? q.data;
  const ro = !sharia;
  const set = (p: Partial<Policy>) => setEdited({ ...draft, ...p });
  async function save() {
    if (!draft) return;
    setError(null);
    setSaving(true);
    try {
      const { version: _v, updatedBy: _u, updatedAt: _a, ...body } = draft;
      void _v;
      void _u;
      void _a;
      const r = await apiPut('/ops/policy', body, PolicySchema);
      setEdited(null);
      void r;
      toast.push({ tone: 'success', title: `Policy version ${r.version} saved` });
      void q.refetch();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      {ro ? <InlineNotice>Read-only: your wallet has the ops role, not the Sharia board role.</InlineNotice> : null}
      <Card>
        <CardHeader eyebrow={`Version ${draft.version} · ${draft.updatedBy ?? 'unknown'} · ${formatDateTime(draft.updatedAt)}`} title="Goods categories" />
        <CardBody>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Category</th>
                <th className="py-1 pr-2 font-medium">Verdict</th>
                <th className="py-1 font-medium">Note</th>
                {!ro ? <th /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {draft.categories.map((c, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2">{ro ? c.name : <Input value={c.name} onChange={(e) => set({ categories: draft.categories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />}</td>
                  <td className="py-1.5 pr-2">
                    {ro ? (
                      <span className={c.verdict === 'prohibited' ? 'text-danger' : c.verdict === 'review' ? 'text-warning' : 'text-success'}>{c.verdict}</span>
                    ) : (
                      <Select value={c.verdict} onChange={(e) => set({ categories: draft.categories.map((x, j) => (j === i ? { ...x, verdict: e.target.value as typeof c.verdict } : x)) })} className="w-36">
                        <option value="permitted">permitted</option>
                        <option value="review">review</option>
                        <option value="prohibited">prohibited</option>
                      </Select>
                    )}
                  </td>
                  <td className="py-1.5 text-ink-muted">{ro ? c.note : <Input value={c.note} onChange={(e) => set({ categories: draft.categories.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} />}</td>
                  {!ro ? (
                    <td className="py-1.5 pl-2">
                      <button type="button" aria-label="Remove" onClick={() => set({ categories: draft.categories.filter((_, j) => j !== i) })} className="rounded p-1 text-ink-muted hover:text-danger">
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {!ro ? (
            <Button variant="outline" size="sm" className="mt-3" icon={<Plus className="size-4" />} onClick={() => set({ categories: [...draft.categories, { name: '', verdict: 'review', note: '' }] })}>
              Add a category
            </Button>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader eyebrow="Decision policy (PLAN 5.6)" title="Thresholds" />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          {(
            [
              ['priceRatioLow', 'Price ratio: review below'],
              ['priceRatioHigh', 'Price ratio: review above'],
              ['weightReviewPct', 'Weight gap % for review'],
              ['weightRejectPct', 'Weight gap % for reject'],
              ['sanctionsReview', 'Sanctions score: review from'],
              ['sanctionsReject', 'Sanctions score: reject from'],
              ['keyFieldMinConfidence', 'Key field confidence minimum'],
            ] as Array<[keyof Policy['thresholds'], string]>
          ).map(([k, label]) => (
            <label key={k} className="text-xs text-ink-muted">
              {label}
              {ro ? <span className="tabular mt-1 block text-base text-ink">{draft.thresholds[k]}</span> : <Input inputMode="decimal" value={String(draft.thresholds[k])} onChange={(e) => set({ thresholds: { ...draft.thresholds, [k]: Number(e.target.value) || 0 } })} className="mt-1" />}
            </label>
          ))}
        </CardBody>
      </Card>
      {error ? <InlineError>{error}</InlineError> : null}
      {!ro ? (
        <Button onClick={save} loading={saving}>
          Save as version {draft.version + 1}
        </Button>
      ) : null}
    </div>
  );
}
