/**
 * ShipsGo container tracking (PLAN 5.4, SP8). API v1.2 as published on shipsgo.com/api-documentation:
 *   POST https://shipsgo.com/api/v1.2/ContainerService/PostContainerInfo  (form: authCode, containerNumber, shippingLine) -> requestId; consumes a credit
 *   GET  https://shipsgo.com/api/v1.2/ContainerService/GetContainerInfo/?authCode=..&requestId=..&mapPoint=true -> [ContainerInfo]; free
 * StatusId: Booked 30, Loaded 35, Sailing 40, Arrived 45, Discharged 50, Untracked 60.
 * Data may be empty right after creation, so the caller polls. No key exists yet
 * (Sun 25 Oct), so SP8 is recorded as mock-only: fixtures in data/fixtures/shipsgo/<CONTAINER>.json
 * follow the v1.2 response shape. The live request shape is written from the public docs and is
 * UNVERIFIED until a key arrives (docs/SPIKES-intel.md).
 */
import { z } from 'zod';
import type { TrackingSnapshot } from '@qafila/shared';
import { SHIPSGO_STATUS } from '@qafila/shared';
import { defineAdapter } from './base.js';
import { HttpError } from '../lib/retry.js';

const DateField = z.object({ Date: z.string().nullable(), IsActual: z.boolean().nullable().optional() }).or(z.string()).nullable().optional();

export const ShipsgoContainerSchema = z.object({
  Message: z.string().nullable().optional(),
  Status: z.string().nullable().optional(),
  StatusId: z.number().int().nullable().optional(),
  ShippingLine: z.string().nullable().optional(),
  ContainerNumber: z.string().nullable().optional(),
  ContainerType: z.string().nullable().optional(),
  FromCountry: z.string().nullable().optional(),
  Pol: z.string().nullable().optional(),
  LoadingDate: DateField,
  DepartureDate: DateField,
  ToCountry: z.string().nullable().optional(),
  Pod: z.string().nullable().optional(),
  ArrivalDate: DateField,
  DischargeDate: DateField,
  Vessel: z.string().nullable().optional(),
  VesselIMO: z.string().nullable().optional(),
  VesselVoyage: z.string().nullable().optional(),
  VesselLatitude: z.union([z.string(), z.number()]).nullable().optional(),
  VesselLongitude: z.union([z.string(), z.number()]).nullable().optional(),
  ETA: z.string().nullable().optional(),
  FirstETA: z.string().nullable().optional(),
  BLReferenceNo: z.string().nullable().optional(),
  LiveMapUrl: z.string().nullable().optional(),
  TSPorts: z
    .array(z.object({ Port: z.string().nullable().optional(), ArrivalDate: DateField, DepartureDate: DateField, Vessel: z.string().nullable().optional(), VesselIMO: z.string().nullable().optional(), VesselVoyage: z.string().nullable().optional() }))
    .nullable()
    .optional(),
});
export const ShipsgoGetSchema = z.array(ShipsgoContainerSchema);
export type ShipsgoContainer = z.infer<typeof ShipsgoContainerSchema>;

export interface LoadingEvent {
  port: string | null;
  vessel: string | null;
  imo: string | null;
  voyage: string | null;
  date: string | null;
  isActual: boolean;
}

export interface Tracking extends TrackingSnapshot {
  loadingEvent: LoadingEvent | null;
  transshipments: LoadingEvent[];
  raw: ShipsgoContainer | null;
}

const dateOf = (d: z.infer<typeof DateField>): { date: string | null; actual: boolean } => {
  if (!d) return { date: null, actual: false };
  if (typeof d === 'string') return { date: d, actual: true };
  return { date: d.Date, actual: d.IsActual ?? false };
};

const STATUS_NAME: Record<number, string> = Object.fromEntries(Object.entries(SHIPSGO_STATUS).map(([k, v]) => [v, k]));

export function mapShipsgo(raw: ShipsgoContainer[], mode: 'live' | 'mock', requested: string[]): Tracking {
  const first = raw[0];
  if (!first) {
    return { mode, statusCode: null, status: null, vessel: null, imo: null, pol: null, pod: null, departure: null, arrival: null, containers: [], events: [], lastPolledAt: new Date().toISOString(), loadingEvent: null, transshipments: [], raw: null };
  }
  const loading = dateOf(first.LoadingDate);
  const departure = dateOf(first.DepartureDate);
  const arrival = dateOf(first.ArrivalDate);
  const discharge = dateOf(first.DischargeDate);
  const events: TrackingSnapshot['events'] = [];
  if (loading.date) events.push({ at: loading.date, location: first.Pol ?? null, description: 'Loaded on vessel', vessel: first.Vessel ?? null, voyage: first.VesselVoyage ?? null, isActual: loading.actual });
  if (departure.date) events.push({ at: departure.date, location: first.Pol ?? null, description: 'Vessel departed', vessel: first.Vessel ?? null, voyage: first.VesselVoyage ?? null, isActual: departure.actual });
  const transshipments: LoadingEvent[] = [];
  for (const ts of first.TSPorts ?? []) {
    const a = dateOf(ts.ArrivalDate);
    const d = dateOf(ts.DepartureDate);
    if (a.date) events.push({ at: a.date, location: ts.Port ?? null, description: 'Arrived at transshipment port', vessel: null, voyage: null, isActual: a.actual });
    if (d.date) events.push({ at: d.date, location: ts.Port ?? null, description: 'Departed transshipment port', vessel: ts.Vessel ?? null, voyage: ts.VesselVoyage ?? null, isActual: d.actual });
    transshipments.push({ port: ts.Port ?? null, vessel: ts.Vessel ?? null, imo: ts.VesselIMO ?? null, voyage: ts.VesselVoyage ?? null, date: d.date, isActual: d.actual });
  }
  if (arrival.date) events.push({ at: arrival.date, location: first.Pod ?? null, description: arrival.actual ? 'Arrived at port of discharge' : 'Estimated arrival', vessel: null, voyage: null, isActual: arrival.actual });
  if (discharge.date) events.push({ at: discharge.date, location: first.Pod ?? null, description: 'Discharged', vessel: null, voyage: null, isActual: discharge.actual });
  const statusCode = first.StatusId ?? null;
  return {
    mode,
    statusCode,
    status: first.Status ?? (statusCode !== null ? STATUS_NAME[statusCode] ?? null : null),
    vessel: first.Vessel ?? null,
    imo: first.VesselIMO ?? null,
    pol: first.Pol ?? null,
    pod: first.Pod ?? null,
    departure: departure.date,
    arrival: arrival.date,
    containers: raw.map((r) => r.ContainerNumber).filter((c): c is string => Boolean(c)).length ? raw.map((r) => r.ContainerNumber).filter((c): c is string => Boolean(c)) : requested,
    events,
    lastPolledAt: new Date().toISOString(),
    loadingEvent: loading.date || first.Vessel ? { port: first.Pol ?? null, vessel: first.Vessel ?? null, imo: first.VesselIMO ?? null, voyage: first.VesselVoyage ?? null, date: loading.date, isActual: loading.actual } : null,
    transshipments,
    raw: first,
  };
}

export interface ShipsgoConfig {
  apiKey?: string;
  baseUrl?: string;
}

export function makeShipsgo(cfg: ShipsgoConfig) {
  const base = (cfg.baseUrl ?? 'https://shipsgo.com/api/v1.2').replace(/\/$/, '');

  const createTracking = defineAdapter<{ containerNumber: string; shippingLine: string; blNumber?: string }, { requestId: string }, { requestId: string }>({
    name: 'shipsgo-create',
    keyOf: (i) => ({ container: i.containerNumber.toUpperCase(), line: i.shippingLine }),
    fixtureName: (i) => `create-${i.containerNumber.toUpperCase()}`,
    cacheable: true,
    ttlMs: 30 * 24 * 60 * 60 * 1000,
    live: async (i, signal) => {
      if (!cfg.apiKey) throw new Error('SHIPSGO_API_KEY missing');
      const body = new URLSearchParams({ authCode: cfg.apiKey, containerNumber: i.containerNumber.toUpperCase(), shippingLine: i.shippingLine, ...(i.blNumber ? { blContainersRef: i.blNumber } : {}) });
      const res = await fetch(`${base}/ContainerService/PostContainerInfo`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text, 'shipsgo PostContainerInfo');
      const id = text.replace(/["\s]/g, '');
      return { requestId: id };
    },
    schema: z.object({ requestId: z.string().min(1) }),
    map: (r) => r,
    costOf: () => 0.5,
    mockFallback: (i) => ({ requestId: `mock-${i.containerNumber.toUpperCase()}` }),
  });

  const getTracking = defineAdapter<{ requestId: string; containers: string[] }, ShipsgoContainer[], Tracking>({
    name: 'shipsgo',
    keyOf: (i) => ({ requestId: i.requestId, minute: new Date().toISOString().slice(0, 16) }),
    fixtureName: (i) => (i.containers[0] ?? i.requestId).toUpperCase(),
    cacheable: false,
    live: async (i, signal) => {
      if (!cfg.apiKey) throw new Error('SHIPSGO_API_KEY missing');
      const res = await fetch(`${base}/ContainerService/GetContainerInfo/?authCode=${encodeURIComponent(cfg.apiKey)}&requestId=${encodeURIComponent(i.requestId)}&mapPoint=true`, { signal });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text, 'shipsgo GetContainerInfo');
      return JSON.parse(text) as unknown;
    },
    schema: ShipsgoGetSchema,
    map: (raw, i) => mapShipsgo(raw, 'live', i.containers),
    mockFallback: () => [],
  });

  return { createTracking, getTracking };
}
