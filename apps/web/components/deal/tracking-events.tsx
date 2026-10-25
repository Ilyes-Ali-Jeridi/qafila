import { Anchor } from 'lucide-react';
import type { TrackingSnapshot } from '@qafila/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KV } from '@/components/ui/kv';
import { Timeline } from '@/components/ui/timeline';
import { formatDateTime } from '@/lib/utils';

export function TrackingEvents({ tracking }: { tracking: TrackingSnapshot }) {
  const items = [...tracking.events]
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
    .map((e, i) => ({
      key: `${e.at}-${i}`,
      title: e.description,
      body: [e.location, e.vessel ? `${e.vessel}${e.voyage ? ` ${e.voyage}` : ''}` : null].filter(Boolean).join(' · '),
      when: e.at ? formatDateTime(e.at) : undefined,
      tone: e.isActual ? ('success' as const) : ('default' as const),
    }));
  return (
    <Card>
      <CardHeader
        eyebrow="Carrier tracking"
        title={tracking.vessel ? `${tracking.vessel}${tracking.imo ? ` (IMO ${tracking.imo})` : ''}` : 'Containers'}
        action={
          <div className="flex items-center gap-2">
            {tracking.status ? <Badge tone="indigo">{tracking.status}</Badge> : null}
            {tracking.mode === 'mock' ? <Badge tone="warning">Recorded data</Badge> : <Badge tone="success" dot>Live</Badge>}
          </div>
        }
      />
      <CardBody className="space-y-4">
        <KV
          dense
          rows={[
            { k: 'Containers', v: tracking.containers.join(', ') || 'none yet' },
            { k: 'Loading port', v: tracking.pol ?? 'unknown' },
            { k: 'Discharge port', v: tracking.pod ?? 'unknown' },
            { k: 'Departure', v: formatDateTime(tracking.departure) },
            { k: 'Arrival', v: tracking.arrival ? `${formatDateTime(tracking.arrival)} (estimate)` : 'unknown' },
            { k: 'Last checked', v: formatDateTime(tracking.lastPolledAt) },
          ]}
        />
        {items.length ? (
          <Timeline items={items} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Anchor className="size-4" /> No carrier events yet. Tracking fills in once the container is booked.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
