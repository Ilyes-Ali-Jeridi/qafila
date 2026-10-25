import { rpc, xdr, Address, TransactionBuilder, BASE_FEE, Keypair, Operation, SorobanDataBuilder } from '@stellar/stellar-sdk';
const s = new rpc.Server('https://soroban-testnet.stellar.org');
const latest = (await s.getLatestLedger()).sequence;
const codeHex = '709b27ab93b8215ad84bea4274ee34ecfc2ff643dd936acc677f83a993998764';
const codeKey = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(codeHex, 'hex') }));
const ce = (await s.getLedgerEntries(codeKey)).entries[0];
console.log('qafila code liveUntil', ce?.liveUntilLedgerSeq, 'ttl days', ((ce?.liveUntilLedgerSeq ?? 0) - latest) / 17280);
const admin = Keypair.fromSecret(process.env['ADMIN_SECRET']!);
const acc = await s.getAccount(admin.publicKey());
for (const ext of [121000, 125000, 138240, 172800, 259200]) {
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: 'Test SDF Network ; September 2015' })
    .addOperation(Operation.extendFootprintTtl({ extendTo: ext }))
    .setSorobanData(new SorobanDataBuilder().setReadOnly([codeKey]).build())
    .setTimeout(30)
    .build();
  const sim = await s.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(sim)) console.log('extend 50KB code to', ext, 'ledgers -> fee XLM', Number(sim.minResourceFee) / 1e7);
  else console.log('sim err', (sim as rpc.Api.SimulateTransactionErrorResponse).error.slice(0, 200));
}
