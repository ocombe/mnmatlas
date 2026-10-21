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
| `test-review-f4.mjs` | R2-1 through R2-10: empty notes, map-switch sync, links, recovery, chips, classes, published data, timestamps, shares and follow receipts |
| `test-desk-forms-f3.mjs` | All approval paths, failed reloads, full Undo, dirty refresh, class chips, typed mobs and Gives quests |
| `test-desk-speed.mjs` | B30: per-step request budgets, incremental queue merging and fallback, pagination, coalesced reads, conditional files, parallel floors, throttled focus and safe note sync during travel |
| `test-request-budget.mjs` | B31: signed-in visitor requests, shared visibility/focus throttle, lazy cached renown, conditional edition files, world and floor skips, combined notes reads, unchanged merges, concurrent saves and remote deletions |

The visitor budget uses empty, unchanged notes and two-floor maps. It records reads,
writes, RPCs, manifest HEADs and data fetch cache modes at each step. The baseline
below runs the same fixture against the preceding revision; totals exclude page
code, fonts and tiles.

| Step | Database calls before → after | Data fetches before → after | HEADs before → after |
| --- | --- | --- | --- |
| Signed-in map load | 15 → 6 | 7 → 6 | 2 → 1 |
| Floor switch | 11 → 0 | 4 → 2 | 1 → 0 |
| First map switch | 11 → 4 | 4 → 4 | 1 → 0 |
| Second map switch | 11 → 4 | 4 → 4 | 1 → 0 |
| First return | 7 → 4 | 1 → 0 | 1 → 0 |
| Second return within five minutes | 7 → 0 | 1 → 0 | 1 → 0 |
| Third return within five minutes | 7 → 0 | 1 → 0 | 1 → 0 |
| Account menu | 0 → 1 | 0 → 0 | 0 → 0 |
| Bell, then Your suggestions | 2 → 1 | 0 → 0 | 0 → 0 |
| Unchanged edition tick | 0 → 0 | 2 → 0 | 1 → 1 |

The account menu's one call is its first visible renown lookup; the bell reuses
that value. All unchanged notes steps have zero writes. Marker, label, chronicle
and publish-log reads use `no-cache`; credits retain their existing cache mode.
The safety cases also cover unreadable combined reads, a local save while that
read is pending, and local or remote changes after a skipped floor sync.

`community-harness.mjs` reuses the existing community suite's browser helpers.
It loads the actual browser scripts. An optional fixture flag exposes existing
community closures for observation; it replaces no production function.
`publisher-harness.mjs` follows the existing publisher test's fake REST backend
and runs the actual publishing script in disposable directories under `scripts/`.
All requests use its local listener.

Preview comparisons deliberately include every property. Both the ledger and
publication use `marker-schema.js`; a new marker has no `removed:false` property.
The fixtures load that script before its consumers, just as the page does.

The apply phase stages `.publish/applied.json` and `.publish/held.json` without
changing suggestion statuses. The post-push `--mark-published` phase acknowledges
the applied rows and returns the held versions to review. A separate
`--return-holds .publish/held.json` phase also runs after a failed push, except
on dry runs, so held rows receive their review note independently. The older publisher
suite finalizes only holds after its simulated push, keeping its acknowledgement
race checks separate. The job contract suite checks both phases explicitly,
including failed writes, version misses and continued processing of other rows.

Publisher and ledger expectations were corrected to match the field contract:
unknown fields are held rather than discarded; private marker types are held;
null and empty optional arrays mean absence; clears remove keys. Valid additions
remain separate fixtures for formatting and preview checks. Ledger wiki fixtures
use valid addresses and provide `URL`. Browser fixtures use the complete trade
and arrow choices rather than a short subset.

Recovery entries retain their old envelope and add an optional `version` with the
applied content, without account ids or author names. Older entries remain
readable. Recovery tests check the exact applied shape and travel values and the
complete correction baseline. Empty and all-held runs preserve data and the log;
credit rebuilding is tested during an actual publication. Failed status writes
now require an error annotation and a nonzero exit, including acknowledgement
version misses. The older publisher assertions were updated accordingly.

The empty-run case checks that no data or recovery-log change can trigger
publication; it executes no commit or workflow. The updown case checks the client
and publisher contract, without mirroring or executing database constraints.
Database coverage belongs to a separate run.

The F3 round trips also cover Gives quests on new markers, edits and type switches,
plus typed mob names. The follow suite adds the new field to its coverage check.
Older community expectations that put wiki levels in names, mixed later rows into
cards or approved Personal markers were corrected to follow the public field rules.
The Blacktide Bay desk fixture now supplies valid empty published files for reloads.

For an offline browser preview, run `python scripts/preview-offline.py 8783` and
open `http://127.0.0.1:8783/?map=night-harbor`. This server disables accounts and
external requests; review decisions are exercised by the local browser fixtures.

The R2 regressions scan every published marker, label and chip, except Personal
markers awaiting separate retyping. Legacy exit tiers and class spellings stay
editable. A recovery acknowledgement failure emits an error annotation without
blocking the apply phase. Receipts are retried for seven days; rows already in
the recovery log do not create fresh receipts or re-enter the apply batch.
Queued note uploads retain the original map configuration and storage key,
including tileRevision, and save the merged local list before advancing the base.
