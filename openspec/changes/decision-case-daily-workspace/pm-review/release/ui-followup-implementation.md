# Issue149 / FUI-02 FUI-03 UI follow-up

Base: 6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb. Isolated branch/worktree: codex/issue149-ui-followup at /workspace/OptraCall-issue149-ui-followup. The fixed /workspace/OptraCall-issue149-final source stays untouched. Dependencies are a read-only-use symlink to that tree's existing node_modules; no install or dependency mutation.

Authorization: root assigned the two confirmed actual-UI defects after independent real Host/Chromium receipt `.local/pm-final/historical-request/receipt.json` and ui-response-followup-review.md. Minimal UI reuse only: exact historical request revision and explicit historical confirmation; request entry focus limited to original issue. No backend eligibility/runtime/demo changes.

Checklist:
- [x] Read independent actual product receipt/report and original IssueWork/source API/allowHistorical contract.
- [ ] Retain meaningful failing component behavior tests against the exact original baseline.
- [ ] Minimal CaseIssuePanel fix and permanent regression.
- [ ] Focused checks, source manifest, diff handoff; no commit/push.

Boundary: existing readCaseDecisionRevision supplies exact original ref/current lifecycle; existing choice API keeps all source/current-choice/version/permission checks. The UI must not substitute latest, answer a different request, or build an independent request status. Pi1.4.0/Interface v3 unchanged; opening a record stays read-only and never runs a model.

## Completed / frozen handoff

Only product file `src/host/ui/CaseIssuePanel.tsx` changed, plus the new permanent `tests/case-request-response-ui.test.ts`; exact hashes/base are in `manifest.json`. No CaseBoard/App/backend/Runtime/demo/dependency change was needed. The untracked node_modules symlink is test infrastructure and must not be staged or copied into the candidate.

- FUI-02: selected original choose request triggers the existing exact-revision read. The UI checks exact Case/store/record/revision/issue and active current lifecycle, keeps current head and original history as separate `recordId@revision` options, shows original/current versions and requires explicit historical confirmation before passing `allowHistorical:true`. It preserves the original request ref and original expected choice chain; denial/archive/mismatched owner never silently uses latest for that request. Switching versions resets historical confirmation. Normal current-version choices require no extra confirmation.
- FUI-03: original request entry is limited to its real issue in both parent and IssueWork, using explicit request issue or original entry issue/loaded exact request. A sidebar switch to B therefore uses B's existing exact single-request match; it never carries A's response ref across.
- Exact source reads keep active/cleanup protection; incoming source data does not replace a user-touched plan selection. Reason text remains through failed reads and confirmation edits. Opening stays read-only, no model request.

Validation:
- Before-product meaningful RED on actual baseline component: `request-response-ui-red.log` (no exact historical read; actual CaseIssuePanel switch submitted no original B request). Earlier test-only harness adjustments were not counted as product RED.
- 5/5 permanent new UI tests PASS: `request-response-ui-green-final.log`. Initial implemented candidate's missing response ref on manual historical re-selection was caught and retained in `request-response-ui-green-first.log`, then corrected; no failure erased.
- Final Node25 affected suite 11/11 PASS: `targeted-final.log` (`case-request-response-ui`, original `case-agent-entry-ui`, `case-request-plan-qualification`, `case-decision-client`).
- `npm run typecheck` PASS: `typecheck-final.log`.
- Original exported source integration boundary PASS: `source-agent-boundary.log`.
- Scoped `git diff --check` PASS.
- Full `npm run check:agent-sessions` in this isolated tree FAILS pinned material physical-path checks because the user-authorized dependency symlink resolves to another tree (`agent-boundary.log`, `request-response-ui-boundary.log`). This is a reported environment limitation, not a skipped/changed checker or a passing full check. Root's newly fixed candidate with physical official deps must run the full check.

No commit/push. Product and test writes stopped. Root owns integration into a new fixed candidate, full official-package check/CI, and the independent real Host/Chromium FUI-02/03 recheck. The original independent UI FAIL remains in the unchanged 6bc7 fixed source and is not reclassified by component tests.
