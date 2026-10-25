/**
 * Carrier tracking (PLAN 5.2, 6 Job 2): ShipsGo events for the B/L containers, then
 * the deterministic comparison: a B/L container appears in tracking; the carrier's
 * loading event at the B/L port of loading names the B/L vessel (IMO exact when both
 * sides have one, the LLM only judges name variants); status Loaded or later.
 * Transshipment later in the voyage is normal and never a mismatch.
 */
import { z } from 'zod';
import type { BillOfLading, Check, TrackingSnapshot } from '@qafila/shared';
import { SHIPSGO_STATUS } from '@qafila/shared';
import type { Adapters } from '../adapters/index.js';
import type { Tracking } from '../adapters/shipsgo.js';
import { normaliseContainer, normalisePort, normaliseVessel } from './normalise.js';
import { loadPrompt } from './prompts/index.js';
import type { DealContext, ModelCall } from './types.js';
import { WEIGHTS } from './validators.js';

export interface TrackingStageResult {
  tracking: TrackingSnapshot | null;
  raw: Tracking | null;
  checks: Check[];
  models: ModelCall[];
  fixtures: string[];
  facts: { available: boolean; containerPresent: boolean; loadingVesselMatch: 'yes' | 'no' | 'unsure' | 'n/a'; statusLoaded: boolean };
}

const NameJudge = z.object({ match: z.enum(['yes', 'no', 'unsure']), reason: z.string(), evidence_a: z.string(), evidence_b: z.string() });

export async function fetchTracking(containers: string[], carrier: string, blNumber: string | undefined, adapters: Adapters): Promise<{ raw: Tracking | null; fixtures: string[]; error: string | null; cost: number }> {
  const first = containers[0];
  if (!first) return { raw: null, fixtures: [], error: 'no container number', cost: 0 };
  const fixtures: string[] = [];
  const created = await adapters.shipsgo.createTracking({ containerNumber: first, shippingLine: carrier, blNumber }, adapters.ctx.shipsgo);
  if (created.fixture) fixtures.push(created.fixture);
  if (created.status !== 'ok' || !created.data) return { raw: null, fixtures, error: created.error ?? 'tracking request failed', cost: created.cost };
  const got = await adapters.shipsgo.getTracking({ requestId: created.data.requestId, containers }, adapters.ctx.shipsgo);
  if (got.fixture) fixtures.push(got.fixture);
  if (got.status !== 'ok' || !got.data) return { raw: null, fixtures, error: got.error ?? 'tracking fetch failed', cost: created.cost + got.cost };
  return { raw: got.data, fixtures, error: null, cost: created.cost + got.cost };
}

export async function trackingStage(bl: BillOfLading | null, ctx: DealContext, adapters: Adapters): Promise<TrackingStageResult> {
  const checks: Check[] = [];
  const models: ModelCall[] = [];
  const blContainers = (bl?.containers ?? []).map((c) => normaliseContainer(c.number.value)).filter(Boolean);
  const containers = blContainers.length ? blContainers : (ctx.containers ?? []).map(normaliseContainer);
  const carrier = bl?.carrier.value ?? ctx.carrier ?? '';
  const none = { available: false, containerPresent: false, loadingVesselMatch: 'n/a' as const, statusLoaded: false };
  if (!containers.length) {
    return { tracking: null, raw: null, checks: [{ name: 'tracking.availability', status: 'unavailable', severity: 'critical', detail: 'No container number to track.', weight: WEIGHTS.critical, document: 'bill_of_lading', field: 'containers' }], models, fixtures: [], facts: none };
  }
  const t = await fetchTracking(containers, carrier, bl?.bl_number.value ?? ctx.blNumber, adapters);
  if (!t.raw) {
    return { tracking: null, raw: null, checks: [{ name: 'tracking.availability', status: 'unavailable', severity: 'critical', detail: `Carrier tracking is not available (${t.error}).`, weight: WEIGHTS.critical }], models, fixtures: t.fixtures, facts: none };
  }
  const snap = t.raw;
  const label = snap.mode === 'mock' ? 'carrier tracking (mock fixture)' : 'carrier tracking';
  const { raw: _raw, loadingEvent, transshipments, ...tracking } = snap;
  void _raw;
  if (!snap.events.length && snap.statusCode === null) {
    return { tracking, raw: snap, checks: [{ name: 'tracking.availability', status: 'unavailable', severity: 'critical', detail: `${label}: no events yet for ${containers[0]} (the carrier may not have published the loading yet).`, weight: WEIGHTS.critical, fix: 'Wait for the carrier to publish the loading event; ops is alerted after 72 hours.' }], models, fixtures: t.fixtures, facts: none };
  }
  checks.push({ name: 'tracking.availability', status: 'pass', severity: 'info', detail: `${label}: ${snap.events.length} event(s), status ${snap.status ?? snap.statusCode}.`, weight: 0 });

  // 1. Container appears in tracking.
  const tracked = snap.containers.map(normaliseContainer);
  const present = containers.some((c) => tracked.includes(c));
  checks.push(present
    ? { name: 'tracking.container_present', status: 'pass', severity: 'critical', detail: `Container ${containers.find((c) => tracked.includes(c))} appears in ${label}.`, weight: WEIGHTS.critical, evidence: { bl: containers, tracked } }
    : { name: 'tracking.container_present', status: 'fail', severity: 'critical', detail: `None of the B/L containers (${containers.join(', ')}) appear in ${label} (${tracked.join(', ') || 'none'}).`, weight: WEIGHTS.critical, evidence: { bl: containers, tracked }, document: 'bill_of_lading', field: 'containers', fix: 'The container on the B/L is not the one the carrier is moving.' });

  // 2. Loading event at the B/L port of loading names the B/L vessel.
  let vesselMatch: 'yes' | 'no' | 'unsure' | 'n/a' = 'n/a';
  const blVessel = bl?.vessel.value ?? null;
  const blImo = (bl?.imo.value ?? '').replace(/\D/g, '') || null;
  const ev = loadingEvent;
  if (!ev || (!ev.vessel && !ev.imo)) {
    checks.push({ name: 'tracking.loading_vessel', status: 'unavailable', severity: 'critical', detail: `${label} has no loading event yet.`, weight: WEIGHTS.critical, fix: 'Wait for the carrier to publish the loading event.' });
  } else if (!blVessel && !blImo) {
    checks.push({ name: 'tracking.loading_vessel', status: 'review', severity: 'critical', detail: 'The B/L shows no vessel to compare with the loading event.', weight: WEIGHTS.critical, document: 'bill_of_lading', field: 'vessel' });
    vesselMatch = 'unsure';
  } else {
    const portOk = !bl?.port_of_loading.value || !ev.port || normalisePort(ev.port).split(' ')[0] === normalisePort(bl.port_of_loading.value).split(' ')[0];
    const evImo = (ev.imo ?? '').replace(/\D/g, '') || null;
    let reason = '';
    if (blImo && evImo) {
      vesselMatch = blImo === evImo ? 'yes' : 'no';
      reason = `IMO ${blImo} vs ${evImo} (exact comparison)`;
    } else if (blVessel && ev.vessel) {
      if (normaliseVessel(blVessel) === normaliseVessel(ev.vessel)) {
        vesselMatch = 'yes';
        reason = 'vessel names equal after normalisation';
      } else {
        const prompt = loadPrompt('name_match');
        const res = await adapters.llm.structured({ stage: 'tracking.vessel_match', tier: 'fast', promptVersion: prompt.version, system: prompt.text, user: [{ text: `Entity kind: vessel\nName A (bill of lading): ${blVessel}\nName B (carrier loading event): ${ev.vessel}${ev.voyage ? ` ${ev.voyage}` : ''}` }], schema: NameJudge, toolName: 'record_name_match', toolDescription: 'Record whether the two names are the same vessel.', maxTokens: 400 }, adapters.ctx.llm);
        models.push({ stage: 'tracking.vessel_match', provider: res.provider, model_id: res.modelId, prompt_version: res.promptVersion, tokens_in: res.tokensIn, tokens_out: res.tokensOut, latency_ms: res.latencyMs, cost_usd: res.costUsd });
        if (res.fixture) t.fixtures.push(res.fixture);
        vesselMatch = res.ok && res.data ? res.data.match : 'unsure';
        reason = res.data?.reason ?? 'name judge unavailable';
      }
    } else vesselMatch = 'unsure';
    const evidence = { bl_vessel: blVessel, bl_imo: blImo, loading_vessel: ev.vessel, loading_imo: ev.imo, loading_port: ev.port, loading_date: ev.date, bl_port_of_loading: bl?.port_of_loading.value ?? null, transshipments, reason };
    if (vesselMatch === 'yes' && portOk) checks.push({ name: 'tracking.loading_vessel', status: 'pass', severity: 'critical', detail: `${label}: loaded on ${ev.vessel ?? ev.imo} at ${ev.port ?? 'the port of loading'} on ${ev.date ?? 'n/a'}, matching the B/L vessel ${blVessel ?? blImo} (${reason}).${transshipments.length ? ` Transshipment later in the voyage: ${transshipments.map((x) => `${x.vessel ?? '?'} at ${x.port ?? '?'}`).join('; ')}.` : ''}`, weight: WEIGHTS.critical, evidence });
    else if (vesselMatch === 'no') checks.push({ name: 'tracking.loading_vessel', status: 'fail', severity: 'critical', detail: `${label}: the loading event at ${ev.port ?? 'the port of loading'} names ${ev.vessel ?? ev.imo}, but the B/L says ${blVessel ?? blImo} (${reason}).`, weight: WEIGHTS.critical, evidence, document: 'bill_of_lading', field: 'vessel', fix: 'The B/L vessel does not match the carrier record; the shipment cannot be confirmed.' });
    else if (!portOk) checks.push({ name: 'tracking.loading_vessel', status: 'fail', severity: 'critical', detail: `${label}: the container was loaded at ${ev.port}, not at the B/L port of loading ${bl?.port_of_loading.value}.`, weight: WEIGHTS.critical, evidence, document: 'bill_of_lading', field: 'port_of_loading', fix: 'The loading port does not match the carrier record.' });
    else checks.push({ name: 'tracking.loading_vessel', status: 'review', severity: 'critical', detail: `${label}: the loading vessel (${ev.vessel ?? ev.imo}) could not be matched to the B/L vessel (${blVessel ?? blImo}) with confidence (${reason}).`, weight: WEIGHTS.critical, evidence, document: 'bill_of_lading', field: 'vessel', fix: 'Ops compares the vessel names.' });
  }

  // 3. Status Loaded or later.
  const code = snap.statusCode ?? 0;
  const loaded = code >= SHIPSGO_STATUS.Loaded && code !== SHIPSGO_STATUS.Untracked;
  checks.push(loaded
    ? { name: 'tracking.status', status: 'pass', severity: 'high', detail: `${label}: status ${snap.status ?? code} (${code}), loaded or later.`, weight: WEIGHTS.high }
    : { name: 'tracking.status', status: 'review', severity: 'high', detail: `${label}: status ${snap.status ?? code} (${code}) is before Loaded.`, weight: WEIGHTS.high, fix: 'The shipment is confirmed once the carrier reports the container loaded.' });

  return { tracking, raw: snap, checks, models, fixtures: t.fixtures, facts: { available: true, containerPresent: present, loadingVesselMatch: vesselMatch, statusLoaded: loaded } };
}
