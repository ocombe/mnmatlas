# Edit and review regressions

Run all existing and new tests with Node 24:

```sh
node scripts/run-edit-review-tests.mjs
```

New suites assert the intended behavior. They continue after failures, print one
PASS/FAIL line with the bug id per case, summarize results, list failing ids, and
exit nonzero on failure. Run a suite directly to narrow the output. Set
`ATLAS_TEST_STACKS=1` for assertion details.

| File | Coverage |
| --- | --- |
| `test-roundtrip.mjs` | Shared fields, note payloads, edits, clears and exact preview/publication parity |
| `test-job-contract.mjs` | Unknown fields, private types, same-value rows, nulls, floors, namespaces, empty runs, write failures and corrections |
| `test-notes-sync.mjs` | Two devices, interleaved saves/deletions, approved-note following and retirement |
| `test-desk-flow.mjs` | Card isolation, reversions, stale approval, review notes, undo, bulk failures, wiki picks and type-specific forms |

`community-harness.mjs` reuses the existing community suite's browser helpers.
It loads the actual browser scripts. An optional fixture flag exposes existing
community closures for observation; it replaces no production function.
`publisher-harness.mjs` follows the existing publisher test's fake REST backend
and runs the actual publishing script in disposable directories under `scripts/`.
All requests use its local listener.

New-marker preview comparisons deliberately include every property. The current
preview adds `removed:false`, which publication omits. These exact parity checks
therefore fail even where all marker content survives publication.

The empty-run case checks that no data or recovery-log change can trigger
publication; it executes no commit or workflow. The updown case checks the client
and publisher contract, without mirroring or executing database constraints.
Database coverage belongs to a separate run.
