# SP6: agent smart account with an ed25519 signer restricted to one contract

**Result: PASS** (testnet, protocol 29, 2026-10-25 ~16:05 WET). Explorer prefix: https://stellar.expert/explorer/testnet/tx/

## What was proven

An OpenZeppelin smart account (smart-account-kit protocol-27 artifacts, live on protocol 29) with
- rule 0 `Default`: signers = [`External(ed25519Verifier, ADMIN raw pubkey)`] (ops administers the account)
- rule 1 `CallContract(TARGET)`: signers = [`External(ed25519Verifier, AGENT_SIGNER raw pubkey)`]

lets the agent key call `TARGET` and nothing else:

| Test | Signer / rule | Result | Evidence |
|---|---|---|---|
| A | agent, rule 1, `TARGET.ping(caller = smart account)` | SUCCESS | `1eaf1b1af6c918d5706b04b75ad8c7cc9d75ef13b96e879ebc9172ea0b6f81fb` |
| B1 | agent, rule 1, `qUSD.transfer(smart account -> faucet, 1 qUSD)` | FAIL at simulation | `Error(Contract, #3002) UnvalidatedContext` (rule 1 is `CallContract(TARGET)`, qUSD does not match) |
| B2 | agent, rule 0, same transfer | FAIL at simulation | `#3002 UnvalidatedContext` (agent is not a signer of the Default rule) |
| C (control) | admin, rule 0, same transfer | SUCCESS | `2f8514fb559a1de46d9dfe70bde33ca121c5676a805768031e44f797cdcb9724` |
| D (control) | agent, rule 0, `TARGET.ping` | FAIL | `#3002 UnvalidatedContext` |

So the agent key alone cannot move tokens and cannot act outside the one allowed contract; the ops key keeps full control.

## Ids and hashes

| Item | Value | Tx |
|---|---|---|
| Smart account WASM hash (`SMART_ACCOUNT_WASM_HASH`) | `1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a` | verified live with `stellar contract info interface --wasm-hash` |
| WebAuthn verifier (`WEBAUTHN_VERIFIER_ADDRESS`) | `CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F` | live |
| Ed25519 verifier (`ED25519_VERIFIER_ADDRESS`, new env key) | `CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4` | live |
| Example policies (threshold / spending limit / weighted) | `CB3FATQKCIRIQOCYRUPCQ2KREQ7T4RPKS7EAEOZWPEPUKWEDRVROBCEG` / `CABXBYJNZ7IUW4G3D6BND5YCAQF3ASSDMDAOKQQ63UYFSO7WUU2TIP5G` / `CCMZ6X4KM3RC7HXWCZDTH7CMWIJXFPN6HLGKJBM63MCOW2AJ2V5W7YXY` | from `demo/.env.example` |
| SDF testnet relayer proxy | `https://smart-account-relayer-proxy.sdf-ecosystem.workers.dev` | from `demo/.env.example` |
| SP6 target contract (`contracts/spikes/sp6/ping`, `ping(caller)` = require_auth only, like the agent-callable Qafila functions) | `CDQN2BBF2LANDZNSZ3SG5KJFGJRCMXDTJBKRWCLGZXX3UJ6333DL3TW6` | upload `2bcb3378ae79c2018e072540176730891532023512472567a32e4fa58d21322c`, deploy `c12b0d91080cf27d0fa2bd18ae869ba2737439ec1c5b3530a15b41ad281f5fe2` |
| Agent smart account (`AGENT_SMART_ACCOUNT_ID`) | `CBNWSWHDEJ5X2BXJBQHT5SVIZQSEGD3WMWAMKPXOKEJV3XU4L6GJIXFR` | deploy `aa51a2d040748661fd3bbb264e9e48075a251c4c52ef2be6425eb77d0aa6f164` (deployer and fee payer: relayer G key) |
| Fund with 100 qUSD (faucet -> smart account, SAC transfer) | | `a1a18a56b03ada3a838ea61e17c973526bdbc0886e7fd170e1f9c24d9f4f57b5` |
| `add_context_rule(CallContract(TARGET), "qafila-agent", None, [agent], {})` signed by admin under rule 0 | rule id 1 | `0f47d66ea6b896ffbc3693be55be3783c6440c73036bd30f430f41861f64c21c` |

Sources: smart-account-kit 0.8.0 `README.md`, GitHub `docs/deployments-protocol-27-2026-07-09.md` (the only deployments doc; no protocol-28/29 doc exists) and `demo/.env.example`. No testnet reset has happened since: all ids resolve on-chain today.

## How to do it (what Track B and Track C copy)

Script: `contracts/spikes/sp6/agent-account.mts` (`NODE_OPTIONS=--dns-result-order=ipv4first npx tsx contracts/spikes/sp6/agent-account.mts deploy|rule|test [smartAccountId]`).
Prerequisite in a fresh clone: `ln -sfn ../../../node_modules/.pnpm/node_modules contracts/spikes/sp6/node_modules` (git-ignored) so the ESM script resolves `@stellar/stellar-sdk`, which is not hoisted to the root.

1. **Deploy** with the raw SDK, not `kit.createWallet` (that path needs a WebAuthn passkey):
   `Operation.createCustomContract({ address: deployerG, wasmHash, salt, constructorArgs: [scvVec([signerToScVal(adminEd25519.signer)]), scvMap([])] })`, simulate, assemble, sign with the deployer G key, send. The constructor creates rule 0 (`Default`) with those signers; the return value is the account address.
2. **Add the agent rule** by invoking the account's own `add_context_rule(context_type, name, valid_until, signers, policies)` with
   `context_type = scvVec([scvSymbol("CallContract"), Address(TARGET).toScVal()])`, `name = scvString("qafila-agent")` (<= 20 bytes), `valid_until = scvVoid()`, `signers = scvVec([signerToScVal(agentEd25519.signer)])`, `policies = scvMap([])`. This is a wallet mutation: the account self-authorizes, so sign its auth entry with the admin ed25519 key under rule 0.
3. **Sign any smart-account auth entry** (ed25519 External signer, one rule id per auth context):
   - simulate with `auth: []`; take `sim.result.auth[]`; clone each entry (`fromXDR(toXDR())`); set `signatureExpirationLedger = latest + 100` on `entry.credentials.addressV2` (CAP-71 ADDRESS_V2 is what simulation returns for contract addresses);
   - `signature_payload = sha256(HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress({ networkId, nonce, signatureExpirationLedger, invocation: rootInvocation, address }).toXDR())` for V2 credentials (plain `envelopeTypeSorobanAuthorization` without `address` for legacy V1);
   - `auth_digest = sha256(signature_payload ++ scvVec(context_rule_ids as u32).toXDR())` (verified byte for byte against the digest the deployed account passed to the verifier);
   - `signature = ed25519.sign(auth_digest)` (`Ed25519Signer.fromSecret(secret, ED25519_VERIFIER).signAuthDigest(digest)`);
   - `credentials.signature = scvMap({ context_rule_ids: scvVec([u32...]), signers: scvMap({ signerToScVal(signer): scvBytes(signature) }) })` (keys in that order; with several signers sort the inner map in host order, see the kit's `compareScVal`);
   - re-simulate with `Operation.invokeHostFunction({ func, auth: signedEntries })`, `rpc.assembleTransaction`, sign with the fee payer G key (relayer), send.
   The number of contexts in one entry is `1 + sub-invocations`; for the Qafila agent functions (`pay_supplier_deposit`, `confirm_shipment`) it is 1, because the contract pays the supplier from its own balance, never from the agent.
4. For the production agent account: rule 1 = `CallContract(QAFILA_CONTRACT_ID)`; `set_agent(<smart account id>)` on the contract; the API signs with `AGENT_SIGNER_SECRET` exactly as in step 3 and pays fees with the relayer key (or posts `{func, auth}` to a relayer proxy).

## Gotchas

- **smart-account-kit 0.8.0 is written for @stellar/stellar-sdk 16** (README: "do not install version 17"). pnpm resolved its peer to the workspace's 17.4.0, whose js-xdr 5 objects have plain fields instead of accessor methods, so `computeEntryAuthDigest`, `resimulateAndAssemble`, `buildDirectTokenTransfer`, `kit.multiSigners.*` and every kit path that touches auth entries throw `entry.credentials is not a function`. Safe to use from the kit under SDK 17: `Ed25519Signer`, `signerToScVal`, `createEd25519Signer`, `createCallContractContext`, constants, error registry. Track C's browser app must pin `@stellar/stellar-sdk` 16.3.x for the passkey kit (own package, not the workspace's 17.4.0) or reimplement the signing as above. Flagged in the fork report; the integrator decides.
- `kit.createWallet`/`connectWallet` need a WebAuthn passkey; a server-side ed25519-only account is deployed with the raw SDK (step 1).
- The kit's documented digest formula (`sha256(payload ++ rule_ids xdr)`) is the one the deployed wasm uses; OpenZeppelin's `main` branch has moved to an `AuthDigestPreimage{account, signature_payload, context_rule_ids}` struct, which does NOT match this deployment. Do not update to newer OZ account wasm without re-running this spike.
- The package exports only `import` conditions: scripts that import `smart-account-kit` must be ESM (`.mts`, or `"type": "module"`).
- Smart account error codes: 3000 ContextRuleNotFound, 3002 UnvalidatedContext, 3003 ExternalVerificationFailed; `Error(Crypto, InvalidInput)` from the ed25519 verifier means the signed digest did not match (wrong preimage type, expiration or rule ids).
- The probe contract (`probe(caller, token, to, amount)`) is a bad SP6 target: it transfers from the caller, so the smart account's auth entry carries two contexts (probe call + token transfer), and the token-transfer context can only be satisfied by a rule that matches the token contract. That is why the spike target is `sp6_ping`.
