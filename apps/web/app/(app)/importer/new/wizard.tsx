'use client';
/** New deal wizard, step 1 (PLAN 9.2): supplier and goods. Creates the draft, then the deal workspace continues with documents, terms, report and promise. */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { INCOTERMS_2020 } from '@qafila/shared';
import { RequireWallet } from '@/components/require-wallet';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { InlineError } from '@/components/ui/states';
import { apiPost, describeError } from '@/lib/api/client';
import { useRefreshDeal } from '@/lib/api/hooks';
import { CreateDealResponseSchema } from '@/lib/api/schemas';
import { COUNTRIES } from '@/lib/countries';

const DAY = 86_400;
const Form = z.object({
  supplierNameEn: z.string().min(2, 'Enter the supplier name as on the licence.'),
  supplierNameZh: z.string().optional(),
  uscc: z.string().regex(/^[0-9A-HJ-NP-RTUWXY]{18}$/, '18 characters, as printed on the business licence.').or(z.literal('')),
  payoutAddress: z.string().regex(/^G[A-Z2-7]{55}$/, 'A Stellar G address.').or(z.literal('')),
  goodsSummary: z.string().min(3, 'Describe the goods in one line.').max(200),
  incoterms: z.string(),
  originPort: z.string().min(2),
  destinationPort: z.string().min(2),
  destinationCountry: z.string().length(2),
  tenorDays: z.string().regex(/^\d+$/),
});
type Form = z.infer<typeof Form>;

export function NewDealWizard() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader eyebrow="New deal, step 1 of 5" title="Supplier and goods" lead="Who you are buying from and what. Next: documents, terms, screening, your promise." />
      <RequireWallet title="Connect to start a deal">
        <Inner />
      </RequireWallet>
    </div>
  );
}

function Inner() {
  const router = useRouter();
  const refresh = useRefreshDeal();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Form>({
    resolver: zodResolver(Form),
    defaultValues: { supplierNameEn: '', supplierNameZh: '', uscc: '', payoutAddress: '', goodsSummary: '', incoterms: 'FOB', originPort: 'Shenzhen (Yantian)', destinationPort: 'Lagos (Apapa)', destinationCountry: 'NG', tenorDays: '90' },
  });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await apiPost(
        '/deals',
        {
          supplier: { nameEn: v.supplierNameEn.trim(), nameZh: v.supplierNameZh?.trim() || undefined, uscc: v.uscc || undefined, country: 'CN', payoutAddress: v.payoutAddress || undefined },
          goodsSummary: v.goodsSummary.trim(),
          incoterms: v.incoterms,
          originPort: v.originPort.trim(),
          destinationPort: v.destinationPort.trim(),
          destinationCountry: v.destinationCountry,
          tenorSecs: Number(v.tenorDays) * DAY,
        },
        CreateDealResponseSchema,
      );
      refresh();
      router.push(`/importer/${r.id}`);
    } catch (e) {
      setError(describeError(e));
    }
  });
  const err = form.formState.errors;
  return (
    <Card>
      <form onSubmit={submit} className="space-y-5 p-6" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier name (English)" htmlFor="sEn" error={err.supplierNameEn?.message} className="sm:col-span-2">
            <Input id="sEn" {...form.register('supplierNameEn')} placeholder="Shenzhen Brightwave Technology Co., Ltd." data-testid="nd-supplier" />
          </Field>
          <Field label="Supplier name (Chinese, optional)" htmlFor="sZh">
            <Input id="sZh" {...form.register('supplierNameZh')} placeholder="深圳市亮波科技有限公司" lang="zh" />
          </Field>
          <Field label="Unified Social Credit Code (optional)" htmlFor="uscc" hint="18 characters on the business licence; checked against the registry." error={err.uscc?.message}>
            <Input id="uscc" {...form.register('uscc')} placeholder="91440300MA5F8KQX3W" className="font-mono uppercase" />
          </Field>
          <Field label="Supplier payout address (optional now)" htmlFor="payout" hint="The Stellar address the supplier gives you; the supplier confirms it before any payment." error={err.payoutAddress?.message} className="sm:col-span-2">
            <Input id="payout" {...form.register('payoutAddress')} placeholder="G..." className="font-mono" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Goods, in one line" htmlFor="goods" error={err.goodsSummary?.message} className="sm:col-span-2">
            <Input id="goods" {...form.register('goodsSummary')} placeholder="4,000 phone cases and tempered-glass screen protectors" data-testid="nd-goods" />
          </Field>
          <Field label="Incoterms" htmlFor="inco">
            <Select id="inco" {...form.register('incoterms')}>
              {INCOTERMS_2020.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tenor (days to pay after you sign the sale)" htmlFor="tenor" error={err.tenorDays?.message}>
            <Select id="tenor" {...form.register('tenorDays')}>
              {[30, 45, 60, 75, 90, 120].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Port of loading" htmlFor="pol" error={err.originPort?.message}>
            <Input id="pol" {...form.register('originPort')} />
          </Field>
          <Field label="Port of discharge" htmlFor="pod" error={err.destinationPort?.message}>
            <Input id="pod" {...form.register('destinationPort')} />
          </Field>
          <Field label="Destination country" htmlFor="dc" error={err.destinationCountry?.message}>
            <Select id="dc" {...form.register('destinationCountry')}>
              {COUNTRIES.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error ? <InlineError>{error}</InlineError> : null}
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} data-testid="nd-submit">
          Save and add documents
        </Button>
      </form>
    </Card>
  );
}
