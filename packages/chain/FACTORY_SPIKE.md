# Share-token factory, live run on testnet (M2 / PLAN 3.1)

Run at about 15:05 WET, Sun 25 Oct 2026, with `pnpm share-token --deal 1 --admin <probe contract> --home-domain qafila.dev`.
The admin is the probe contract `CD7JYELMF6W5LLWINWJ7XO6BYAMDFBYLJ4VTMTOZ3LWCFH2MZ7MQWXZP` (SP1 to SP3 evidence; the real deploy passes the Qafila contract id).

| Step (PLAN 3.1) | Result | Tx |
|---|---|---|
| 1 issuer keypair in memory | `GAC75JLFH5QPHGJMVWXZVWXKY53K3RW73FAVBC3FVQBMOYYQRAABJMI4` (secret discarded) | |
| 2 funder creates issuer with 2 XLM | ok | `f3c60afe2463e272388ddbd2e9c843e82761c360324df13bb374d63fd02b18b8` |
| 3 flags AUTH_REQUIRED, AUTH_REVOCABLE, AUTH_CLAWBACK_ENABLED, home domain qafila.dev | ok | `2ebf3e7f2a688f7b544f2355988c67c430ed5a58b1ed48784d7571885fb68cb8` |
| 4 deploy SAC `QF00000001:GAC75JL...` | `CC5BR6EQVM3EWUMW2CNEGSBLN6F3FDDTASRXKNHXEF6VCNSLGBDZKKPA` | `2423e39a9d49d07a58921227e30979371aa76db4b4dc9bba53cb1c987a0215be` |
| 5 issuer signs SAC `set_admin(contract)` | ok, `admin()` now returns the probe contract | `d1731f17b2fe472d8a677379180988fc9982e5715edae980bdd91db370c9d376` |
| 6 master weight 0 | ok | `2349443ebb89204615d15632df2b909edeb25eb720da9c481467611816368376` |
| 7 Horizon check | flags true/true/true, one signer with weight 0, home domain set | |

Explorer: https://stellar.expert/explorer/testnet/tx/<hash>

Finding: a 2 XLM issuer cannot pay the SAC deploy resource fee (`txINSUFFICIENT_BALANCE`, first attempt
`d1ffd06ab4d5a9acabdddaa5ed363a036cb2039ea15fc3aa1dda4bd7a083d967`). Deploying a SAC needs no issuer
signature, so the funder is now the source of that transaction; the issuer only signs the flags, `set_admin`
and the lock. A stray issuer from the failed attempt exists (`GAIL3JTSZ4B3M24YNPENIWQZ7ZPY5YT4MKASLCWSQDSRYQ6VYIZXYYN6`, flags set, not locked, no SAC); it is unused.

This share token (`CC5BR6EQ...`) can be used directly for SP1 to SP3: the probe contract is its admin and the issuer is locked.
