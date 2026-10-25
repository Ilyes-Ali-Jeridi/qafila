Eval 2026-10-25T16:05:25.471Z, llm=live

| # | Expected | Actual | Stage | Risk | Latency | Cost (USD) | Result |
|---|---|---|---|---|---|---|---|
| 01 | approve | approve | listing | 100 | 60.2 s | 0.0170 | pass |
| 02 | approve | approve | listing | 100 | 60.2 s | 0.0201 | pass |
| 03 | approve | approve | shipment | 100 | 87.9 s | 0.0257 | pass |
| 04 | reject | reject | listing | 60 | 44.6 s | 0.0154 | pass |
| 05 | review | review | listing | 75 | 51.0 s | 0.0160 | pass |
| 06 | reject | reject | listing | 60 | 34.7 s | 0.0127 | pass |
| 07 | reject | review | listing | 0 | 1241.3 s | 0.0105 | FAIL extraction.invoice:u documents.required:f structure.buyer:r halal.screen:u fingerprint.listing:r |
| 08 | reject | reject | listing | 57 | 48.7 s | 0.0152 | pass |
| 09 | reject | approve | listing | 100 | 63.4 s | 0.0162 | FAIL MISSING:sanctions.supplier |
| 10 | reject | reject | shipment | 60 | 82.8 s | 0.0208 | pass |
| 11 | reject | reject | listing | 57 | 50.4 s | 0.0164 | pass |
| 12 | review | review | listing | 0 | 50.2 s | 0.0155 | pass |
| | | | | | 1875.5 s | 0.2016 | 10 of 12 |
