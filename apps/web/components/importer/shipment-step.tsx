'use client';
/** PLAN 9.2 shipment step: upload the B/L, carrier, containers; live tracking appears. */
import { zodResolver } from '@hookform/resolvers/zod';
import { Ship } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { InlineError } from '@/components/ui/states';
import { apiPost, describeError } from '@/lib/api/client';
import { useRefreshDeal } from '@/lib/api/hooks';
import { ShipmentResponseSchema, type ImporterDealDetail } from '@/lib/api/schemas';
import { DocumentUpload } from './document-upload';

const Form = z.object({
  carrier: z.string().min(2, 'Name the carrier, e.g. Maersk.'),
  blNumber: z.string().min(3, 'Enter the bill of lading number.'),
  containers: z.string().min(11, 'Enter at least one container number.'),
});
type Form = z.infer<typeof Form>;

export function ShipmentStep({ deal }: { deal: ImporterDealDetail }) {
  const refresh = useRefreshDeal();
  const bl = deal.documents.find((d) => d.type === 'bill_of_lading' && d.status === 'uploaded');
  const [docId, setDocId] = useState<string | null>(bl?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Form>({ resolver: zodResolver(Form), defaultValues: { carrier: '', blNumber: '', containers: '' } });

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    if (!docId) {
      setError('Upload the bill of lading first.');
      return;
    }
    const containers = v.containers.toUpperCase().split(/[\s,;]+/).filter(Boolean);
    const bad = containers.find((c) => !/^[A-Z]{4}\d{7}$/.test(c));
    if (bad) {
      setError(`${bad} is not a container number (4 letters and 7 digits).`);
      return;
    }
    try {
      await apiPost(`/deals/${deal.id}/shipment`, { carrier: v.carrier.trim(), blNumber: v.blNumber.trim(), containers, documentId: docId }, ShipmentResponseSchema);
      refresh(deal.id);
    } catch (e) {
      setError(describeError(e));
    }
  });

  return (
    <Card data-testid="shipment-step">
      <CardHeader eyebrow="Step 9" title="The goods have shipped" action={<Ship className="size-5 text-indigo" aria-hidden />} />
      <CardBody className="space-y-4">
        <Callout tone="indigo">
          <p>
            The bill of lading must be made out to the order of <strong>Qafila Trade, deal {deal.number}</strong> with you as notify party. The agent checks it against the invoice, the packing list and the carrier&apos;s loading event, then pays the supplier the balance.
          </p>
        </Callout>
        <DocumentUpload dealId={deal.id} type="bill_of_lading" existing={bl ?? deal.documents.find((d) => d.type === 'bill_of_lading')} onUploaded={(id) => { setDocId(id); refresh(deal.id); }} />
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Carrier" htmlFor="carrier" error={form.formState.errors.carrier?.message}>
            <Input id="carrier" placeholder="Maersk" {...form.register('carrier')} data-testid="ship-carrier" />
          </Field>
          <Field label="Bill of lading number" htmlFor="bl" error={form.formState.errors.blNumber?.message}>
            <Input id="bl" placeholder="MAEU2260031845" {...form.register('blNumber')} data-testid="ship-bl" />
          </Field>
          <Field label="Container numbers" htmlFor="containers" hint="One or more, separated by spaces or commas." error={form.formState.errors.containers?.message} className="sm:col-span-2">
            <Input id="containers" placeholder="MSKU9070323" {...form.register('containers')} data-testid="ship-containers" />
          </Field>
          {error ? <div className="sm:col-span-2"><InlineError>{error}</InlineError></div> : null}
          <div className="sm:col-span-2">
            <Button type="submit" loading={form.formState.isSubmitting} data-testid="ship-submit">
              Start tracking
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
