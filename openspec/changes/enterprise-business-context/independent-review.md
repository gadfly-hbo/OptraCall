# 企业业务资料完整候选非作者复核

以下为独立复核 Agent `/root/enterprise_independent_review` 的原报告，原样保存。证据根为本工作树 `.local/enterprise-business-context/complete-independent-review/`；报告原文 SHA-256：`ae73db732fc842e5d2bc799a76d8f087dd65dc64f6f1a17b58697b7f625610bc`。下文相对证据路径均相对此证据根。

# Enterprise business context complete independent review

Status: PASS_WITH_LIMITS — final local engineering review complete. No open actionable findings in the fixed source/test candidate.

Fixed identity: branch `codex/host-context`, unchanged HEAD/baseline `c00bd7dc9a8f954abc24d792b826b1e10a8ce74e`; 32 production/test files in `../implementation/full-source-manifest.json`. Manifest SHA-256: `7304fcd3cb35fecc7cfdc0dbe1934df88247ff921e904d3daa5b73e6c86dd395`. Final independent readback (`manifest-final-check.json`) found zero hash mismatches and zero unlisted changed production/test files. This is a WIP candidate, not a Git commit or hosted-CI result.

Reviewer is independent of all implementation authors. Read-only source review against baseline `c00bd7dc9a8f954abc24d792b826b1e10a8ce74e`, EB01–EB16, confirmed five-A structure decisions, engineering workflow v1.1 and Interface v1 IN01–IN07. Review includes tracked changes and all new production/test files. Graph discovery used the indexed baseline; newly added files were absent from that graph, so their exact paths were read directly.

## Findings identified during implementation

All eight P2 findings are closed in the final candidate; their original failures remain in the evidence.

1. Error contract: `enterprise-materials-client.ts:22`/`:44` reads `error`/`code` and controlled server guidance. Independent invalid UTF-8 UI and final client tests passed.
2. Case character total: `EnterpriseMaterialPicker.tsx:20` includes selected Case supplement text, with stale-version disclosure. Independent Case UTF-16 count passed; author's browser also checks combined overflow and explicit reselection.
3. Async editor race: `EnterpriseMaterialsPage.tsx:31` blocks New while busy; version selection also stays disabled during operations. Independent held-GET browser check passed and the editor reenabled after completion.
4. Optional-library boundary: `project-runtime.ts:111` accepts the separately bounded Host envelope; Host still validates original question length and preflights total context before marking a run. Independent original failure and repaired HTTP 202/one-synthetic-request check both retained; corrupt library bytes were not reset and no enterprise receipt was invented.
5. System permission conflict: `project-session.ts:126` explicitly permits Host-announced authorized shared business materials while retaining 010's soft restriction and Agent method autonomy. Independent provider-system-message assertion passed; fixed-draft workspace policy is unchanged.
6. Exact revision readability: picker selection starts with explicit location-only mode at `EnterpriseMaterialPicker.tsx:17`; exact selected revision controls full/excerpt availability. Summary readability now uses the active revision where present (`enterprise-materials-store.ts:189`). Independent file-only r1 versus draft and Case r1 versus active r2 paths passed.
7. Historical source readback: `project-history.ts:40` projects existing native v1 receipts, keeping owner/session filtering and absent evidence unknown. Historical UI labels request identity, reopens exact old enterprise sources, and shows recorded RAP/SAP/Case fields without current-version backfill. Independent two-turn history UI, native readback and restart tests passed. Hash-matched original-question annotation changes read projections only; full native context remains available collapsed.
8. Native fork selector: `project-session.ts:210` projects original question display labels through the same hash-checked adapter while retaining actual SDK entry IDs and fork actions. Independent unchanged SM11 exact-selector/parent-lineage/restart test passed on the refrozen candidate (`fork-compat-final.log`).

## Independent checks so far

- `git diff --check`: passed on the reviewed working tree.
- `store-adversarial.log`: passed immutable old revision readback; injected pre-index-rename failure preserves authoritative index bytes and active pointer; sidecar stale revision rejection; Case-store identity mismatch rejection; Case SQLite and marker byte preservation; original source-file hash mismatch rejection without replacement.
- `unavailable-library-max-message.log`: preserved the actual P2 failure before the author's repair. Test used an isolated synthetic Host and local synthetic provider.
- Read author RED/GREEN evidence for the two Host/runtime repairs: `implementation/review-system-unavailable-{red,green}.log`; GREEN contains 2 passed tests, no failures/cancellations/skips.
- Independently reran the original unavailable-library failure against the repaired source: `unavailable-library-max-message-green.log` passed HTTP 202, one synthetic provider request, no invented enterprise receipt, original corrupt bytes preserved, and shared-source authorization present in the provider's system message.
- A fresh-context nonauthor standards-axis helper reviewed the full current source diff against documented rules and Fowler heuristics: 0 additional actionable findings. It ran no tests or source mutations.
- Independent browser interactions on separate synthetic UI 4186 passed real save/enable and old revision readback; a held GET proved New is disabled during reads and reenabled after settlement; invalid UTF-8 import displayed the precise controlled error and preserved the draft. `ui-library-{first,repairs}.log`.
- Independent browser rechecks passed file-only r1 versus an unpublished nonempty draft, then Case-preferred file-only r1 while r2 with a body was active; selected Case supplement text contributed exactly 9 UTF-16 characters. `ui-exact-revision-picker-settled.log`, `ui-case-exact-revision-count-recheck.log`.
- Independent browser history used two actual SDK turns against a local synthetic provider. Ordinary bubbles showed exact original questions with full native context still available collapsed; the old request retained its exact ID, revision and body, and fixed revision readback worked after the newer turn. Missing historical RAP/SAP/Case fields stayed unknown. `ui-history-{fixture,old-revision}.log`.
- Independent browser 390/320 light and 320 dark picker checks had document width equal to viewport width. `ui-picker-responsive.log` and `ui-picker-mobile-dark.png`.
- First frozen 32-file source/test manifest verified all hashes and exactly matched the changed production/test file set. `manifest-first-check.json`. Independent focused public/native EB tests passed 21/21 with no failures, cancellations or skips (`final-targeted-tests.log`).

## Preserved validation failures

- The original optional-library 20k boundary failure is retained separately from its repaired PASS.
- A first immediate option-disabled assertion failed; its exact cause was not conclusively established. The later settled DOM and complete exact-revision flow passed. The first probe remains failed in `ui-exact-revision-picker.log` and is not counted as a PASS or a causal product RED.
- A generic dialog-detached wait followed replacement of the create dialog by a Case detail dialog, and a subsequent Case-continue probe omitted the existing background confirmation dialog. Both tool/flow precondition failures were inspected; the complete product flow then passed. Logs remain.
- Root full check first failed its import boundary before product tests ran; tests were relocated into existing approved native-reader test files, preserving test bodies and the original failure log.
- The first complete test execution passed 512/514. One requirement test inherited repository AGENTS because the retention TMPDIR was placed inside the repo (harness contamination); the same requirement tests passed at the normal OS temp location without changing product code or weakening assertions. The other failure exposed the native `/fork` selector issue above and received the product repair. Original full failures remain retained; neither was waived.

## Standards

0 open hard rule violations; 0 material heuristic findings. The reviewer and a fresh-context nonauthor helper checked the complete diff and the later native-history/presentation additions. Interface v1 lifecycle, owner/profile separation, fixed-draft capability scope, business authority and ordinary-tool policy remain within IN01–IN07. No new SDK constructor, busy ledger, analysis loop, Host business calculation or method/template gate was introduced.

## Spec

0 open actionable findings against EB01–EB16 and the confirmed five-A package after the eight repairs above. Storage identity/revision/source retention, Case dual-store binding/CAS, explicit range and cap semantics, no-Case autonomous native discovery, optional receipts/history and existing project/session/file compatibility were reviewed and exercised at the stated deterministic seams. No old database, project schema, RAP/SAP publication or native-history migration was added.

## Final verification and conclusion

Independent execution: 21/21 focused EB public/native tests passed with zero failures/cancellations/skips, plus the unchanged SM11 compatibility test passed 1/1 after the fork repair. Adversarial storage and actual browser checks are listed above. Reviewer-owned UI 4186, Host, Vite, synthetic provider and Playwright session are closed; fixture bytes and logs remain.

Author execution, independently read back: final `npm run check` exited 0 in `../implementation/full-check-final.log`; import boundary passed, 514/514 tests passed, zero failures/cancellations/skips/todos, TypeScript and Vite build passed. The earlier full-check failure logs remain separate. The build retains its >500 kB chunk-size notice. Independent `git diff --check` passed and final manifest readback still matched all 32 files.

Conclusion: PASS_WITH_LIMITS for the fixed local engineering candidate. Standards: 0 open findings; Spec: 0 open findings. This review does not assert real-provider/model quality or business benefit, hosted CI, Git delivery/merge, deployment adoption or user Product Acceptance. Prior quality failures and UNKNOWNs remain outside this new local-engineering conclusion. Final result-document status/count updates can cite these actual results; they do not change the frozen production/test bytes.
- Own temporary Host/UI fixture was stopped after the probe. No real provider, business data, credentials, MacBook, production service, or Git delivery used.

## Scope notes

No new SDK constructor, lifecycle/busy ledger, analysis loop, fixed method/analysis template, host-side business computation, or ordinary-tool restriction found in the source pass. New storage remains independent of Case SQLite, project schemas, RAP/SAP contracts and native history migration. Fixed-draft resources remain outside the enterprise-materials path.

The eventual result is an engineering review of a fixed local candidate and deterministic synthetic paths. It cannot establish real-model quality, comparison benefit, hosted CI, Git delivery, deployment adoption or Product Acceptance.
