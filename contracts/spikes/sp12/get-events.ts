/**
 * SP12 (PLAN 3.2): `getEvents` filtered by contract id, paged with the cursor.
 * Run: NODE_OPTIONS=--dns-result-order=ipv4first npx tsx contracts/spikes/sp12/get-events.ts [contractId] [lookbackLedgers]
 * Track B's indexer can copy `pageEvents` as is.
 */
import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';

const RPC_URL = process.env['STELLAR_RPC_URL'] ?? 'https://soroban-testnet.stellar.org';
const contractId = process.argv[2] ?? 'CB7WLKU45NHMLECCZGP5H6RH5IHMSHJXA7U4JSNM4MQT7WT46LZMC3KZ'; // qUSD SAC
const lookback = Number(process.argv[3] ?? 10_000);

interface ParsedEvent {
  id: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  contractId: string;
  topics: unknown[];
  value: unknown;
  pagingToken: string;
}

function parse(ev: rpc.Api.EventResponse): ParsedEvent {
  return {
    id: ev.id,
    ledger: ev.ledger,
    ledgerClosedAt: ev.ledgerClosedAt,
    txHash: ev.txHash,
    contractId: ev.contractId?.toString() ?? '',
    topics: ev.topic.map((t: xdr.ScVal) => {
      try {
        return scValToNative(t);
      } catch {
        return t.toXDR('base64');
      }
    }),
    value: (() => {
      try {
        return scValToNative(ev.value);
      } catch {
        return ev.value.toXDR('base64');
      }
    })(),
    pagingToken: ev.pagingToken,
  };
}

/** One page of events. Pass `cursor` (from the previous page) OR `startLedger`, never both. */
async function pageEvents(
  server: rpc.Server,
  contractIds: string[],
  opts: { startLedger?: number; cursor?: string; limit: number },
): Promise<{ events: ParsedEvent[]; cursor: string; latestLedger: number }> {
  const req: rpc.Server.GetEventsRequest = {
    filters: [{ type: 'contract', contractIds }],
    limit: opts.limit,
    ...(opts.cursor ? { cursor: opts.cursor } : { startLedger: opts.startLedger }),
  };
  const res = await server.getEvents(req);
  return { events: res.events.map(parse), cursor: res.cursor, latestLedger: res.latestLedger };
}

async function main(): Promise<void> {
  const server = new rpc.Server(RPC_URL);
  const health = await server.getHealth();
  const latest = await server.getLatestLedger();
  const oldest = health.oldestLedger;
  const startLedger = Math.max(oldest, latest.sequence - lookback);
  console.log(JSON.stringify({ rpc: RPC_URL, contractId, oldestLedger: oldest, latestLedger: latest.sequence, retentionLedgers: latest.sequence - oldest, startLedger }));

  let total = 0;
  let pages = 0;
  let cursor: string | undefined;
  let first: ParsedEvent | undefined;
  let last: ParsedEvent | undefined;
  const txHashes = new Set<string>();
  for (;;) {
    const page = await pageEvents(server, [contractId], cursor ? { cursor, limit: 10 } : { startLedger, limit: 10 });
    pages += 1;
    for (const ev of page.events) {
      total += 1;
      txHashes.add(ev.txHash);
      first ??= ev;
      last = ev;
    }
    console.log(`page ${pages}: ${page.events.length} events, next cursor=${page.cursor}`);
    if (page.events.length < 10) {
      cursor = page.cursor;
      break;
    }
    cursor = page.cursor;
    if (pages > 50) break; // bounded
  }
  console.log(JSON.stringify({ totalEvents: total, pages, distinctTxs: txHashes.size, finalCursor: cursor, firstEvent: first, lastEvent: last }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  // Follow-up poll from the final cursor must return 0 new events immediately (cursor semantics = "after this id")
  const tail = await pageEvents(server, [contractId], { cursor: cursor ?? '', limit: 10 });
  console.log(`tail poll from final cursor: ${tail.events.length} events (expected 0), cursor=${tail.cursor}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
