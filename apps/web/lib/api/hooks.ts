'use client';
/** TanStack Query hooks over the API contract. Query keys are stable and invalidated by actions. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DealDetailSchema, DealSummarySchema, HealthSchema, StatsSchema, TrackingSnapshotSchema } from '@qafila/shared';
import { apiGet, ApiRequestError } from './client';
import {
  AgentLogSchema,
  CharityLedgerSchema,
  EventFeedSchema,
  ImporterDealDetailSchema,
  ImporterDealSchema,
  KycQueueSchema,
  MeSchema,
  OpsDealDetailSchema,
  OpsQueueItemSchema,
  PolicySchema,
  PortfolioSchema,
  ReportResponseSchema,
  TradeFileSchema,
  PurchaseOrderSchema,
} from './schemas';
import { useWallet } from '../wallet/provider';

export const keys = {
  me: (addr: string | null) => ['me', addr] as const,
  deals: ['deals'] as const,
  deal: (id: string) => ['deal', id] as const,
  tracking: (id: string) => ['tracking', id] as const,
  report: (id: string) => ['report', id] as const,
  portfolio: (addr: string | null) => ['portfolio', addr] as const,
  importerDeals: (addr: string | null) => ['importer-deals', addr] as const,
  importerDeal: (id: string) => ['importer-deal', id] as const,
  opsQueue: ['ops-queue'] as const,
  opsDeal: (id: string) => ['ops-deal', id] as const,
  opsKyc: ['ops-kyc'] as const,
  opsAgent: ['ops-agent'] as const,
  opsPolicy: ['ops-policy'] as const,
  stats: ['stats'] as const,
  events: ['events'] as const,
  charity: ['charity'] as const,
  health: ['health'] as const,
  tradefile: (id: string) => ['tradefile', id] as const,
  purchaseOrder: (id: string) => ['purchase-order', id] as const,
};

export function useMe() {
  const { address, status } = useWallet();
  return useQuery({ queryKey: keys.me(address), queryFn: () => apiGet('/me', MeSchema), enabled: status === 'connected' && Boolean(address), retry: (n, e) => !(e instanceof ApiRequestError && [401, 403, 501].includes(e.status)) && n < 1 });
}

export function useDeals() {
  return useQuery({ queryKey: keys.deals, queryFn: () => apiGet('/deals', DealSummarySchema.array()), refetchInterval: 10_000 });
}

export function useDeal(id: string, opts?: { live?: boolean }) {
  return useQuery({ queryKey: keys.deal(id), queryFn: () => apiGet(`/deals/${id}`, DealDetailSchema), refetchInterval: opts?.live === false ? false : 10_000 });
}

export function useTracking(id: string, enabled = true) {
  return useQuery({ queryKey: keys.tracking(id), queryFn: () => apiGet(`/deals/${id}/tracking`, TrackingSnapshotSchema), enabled, refetchInterval: 30_000, retry: false });
}

export function useReport(id: string, enabled = true) {
  return useQuery({ queryKey: keys.report(id), queryFn: () => apiGet(`/deals/${id}/report`, ReportResponseSchema), enabled, retry: false });
}

export function usePortfolio() {
  const { address, status } = useWallet();
  return useQuery({ queryKey: keys.portfolio(address), queryFn: () => apiGet('/me/portfolio', PortfolioSchema), enabled: status === 'connected' && Boolean(address), refetchInterval: 10_000 });
}

export function useImporterDeals() {
  const { address, status } = useWallet();
  return useQuery({ queryKey: keys.importerDeals(address), queryFn: () => apiGet('/importer/deals', ImporterDealSchema.array()), enabled: status === 'connected' && Boolean(address), refetchInterval: 10_000 });
}

export function useImporterDeal(id: string) {
  const { address, status } = useWallet();
  return useQuery({ queryKey: keys.importerDeal(id), queryFn: () => apiGet(`/importer/deals/${id}`, ImporterDealDetailSchema), enabled: status === 'connected' && Boolean(address), refetchInterval: 8_000 });
}

export function useOpsQueue() {
  const { address, status } = useWallet();
  return useQuery({ queryKey: keys.opsQueue, queryFn: () => apiGet('/ops/queue', OpsQueueItemSchema.array()), enabled: status === 'connected' && Boolean(address), refetchInterval: 10_000 });
}

export function useOpsDeal(id: string) {
  const { address, status } = useWallet();
  return useQuery({ queryKey: keys.opsDeal(id), queryFn: () => apiGet(`/ops/deals/${id}`, OpsDealDetailSchema), enabled: status === 'connected' && Boolean(address), refetchInterval: 8_000 });
}

export function useOpsKyc() {
  const { address, status } = useWallet();
  return useQuery({ queryKey: keys.opsKyc, queryFn: () => apiGet('/ops/kyc', KycQueueSchema), enabled: status === 'connected' && Boolean(address), refetchInterval: 15_000 });
}

export function useOpsAgent() {
  const { address, status } = useWallet();
  return useQuery({ queryKey: keys.opsAgent, queryFn: () => apiGet('/ops/agent', AgentLogSchema), enabled: status === 'connected' && Boolean(address), refetchInterval: 10_000 });
}

export function useOpsPolicy() {
  const { address, status } = useWallet();
  return useQuery({ queryKey: keys.opsPolicy, queryFn: () => apiGet('/ops/policy', PolicySchema), enabled: status === 'connected' && Boolean(address) });
}

export function useStats() {
  return useQuery({ queryKey: keys.stats, queryFn: () => apiGet('/stats', StatsSchema), refetchInterval: 10_000 });
}

export function useEvents(limit = 12) {
  return useQuery({ queryKey: [...keys.events, limit], queryFn: () => apiGet(`/events?limit=${limit}`, EventFeedSchema), refetchInterval: 8_000 });
}

export function useCharity() {
  return useQuery({ queryKey: keys.charity, queryFn: () => apiGet('/charity', CharityLedgerSchema), refetchInterval: 15_000 });
}

export function useHealth() {
  return useQuery({ queryKey: keys.health, queryFn: () => apiGet('/health', HealthSchema), refetchInterval: 15_000 });
}

export function useTradeFile(id: string, enabled: boolean) {
  return useQuery({ queryKey: keys.tradefile(id), queryFn: () => apiGet(`/deals/${id}/tradefile`, TradeFileSchema), enabled, retry: false });
}

export function usePurchaseOrder(id: string) {
  return useQuery({ queryKey: keys.purchaseOrder(id), queryFn: () => apiGet(`/deals/${id}/purchase-order`, PurchaseOrderSchema), retry: false });
}

/** Invalidate everything that a deal action can change. */
export function useRefreshDeal() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: keys.deals });
    void qc.invalidateQueries({ queryKey: ['portfolio'] });
    void qc.invalidateQueries({ queryKey: ['importer-deals'] });
    void qc.invalidateQueries({ queryKey: keys.opsQueue });
    void qc.invalidateQueries({ queryKey: keys.stats });
    void qc.invalidateQueries({ queryKey: keys.events });
    void qc.invalidateQueries({ queryKey: keys.charity });
    if (id) {
      void qc.invalidateQueries({ queryKey: keys.deal(id) });
      void qc.invalidateQueries({ queryKey: keys.importerDeal(id) });
      void qc.invalidateQueries({ queryKey: keys.opsDeal(id) });
      void qc.invalidateQueries({ queryKey: keys.report(id) });
    }
  };
}
