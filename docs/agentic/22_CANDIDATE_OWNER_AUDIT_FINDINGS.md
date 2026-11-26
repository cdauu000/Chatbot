# J COLLECTION — V3.0 FINAL
## CANDIDATE OWNER ACCEPTANCE & AUDIT FINDINGS REPORT

- **Frozen Production Baseline (Port 3000):** `main` branch · Commit `dc11876` · Tag `v3.0.0-final-policy-v1.4.6` · Effective Policy `V1.4.6`
- **Audited Candidate Branch:** `feat/v3-final-grounding-eval-hardening` (Isolated Preview on Port `3100` · DB `artifacts/candidate-runtime/candidate_dashboard.db`)
- **Architecture:** Reasoning-first · Tool-driven · Business-controlled (Agentic V3.0 FINAL — unchanged cognitive core, zero new intent routers / planners / regex NLU / templates)
- **Live Quota Policy:** Respected strictly — **zero live LLM calls** executed during this audit and remediation cycle.

---

## 1. Executive Summary

Independent audit verification against raw source code, canonical room datasets (66 rooms across 3 properties), policy JSON artifacts, and saved Gate 2 / Gate 3 live transcripts confirmed four genuine system gaps (**Findings A, C, D, E**), one pre-existing Agent hardcoded example defect (**Finding B** inside `jcollection-agent.ts:1074` caught immediately by the new relational validator), and two factual reporting inaccuracies inside [21_BUSINESS_GROUNDING_AND_EVALUATION_INTEGRITY.md](file:///C:/Chatbot/docs/agentic/21_BUSINESS_GROUNDING_AND_EVALUATION_INTEGRITY.md) lines 92 and 95.

All five systemic findings (**A–E**) plus safe SQLite WAL Online Backup, metric disambiguation, and non-destructive offline re-audit have been implemented, verified offline across **57 offline Vitest suites (762/762 tests passed)**, compiled cleanly into the isolated candidate runtime (`artifacts/candidate-runtime/dist`), and relaunched on **Port 3100** while leaving **Port 3000 (`dc11876`)** untouched.

---

## 2. Root Causes & Structural Fixes (Findings A–E)

| Finding | Confirmed Root Cause | Architectural / Code Fix | Verification Evidence |
| :--- | :--- | :--- | :--- |
| **A. Category Pricing Completeness** | At `jacayl-ha-dong`, category `Concept` splits on extra-hour rates: `101-long-chim` = `100.000đ/h` (`4h`: `599k` / `649k`) vs `601-50-sac-thai` & `602-playboy` = `200.000đ/h` (`4h`: `799k` / `849k`). Previously: `search_rooms` lacked a category variance summary; `jcollection-agent.ts` only printed `min2h`/`minOvernight`; `business-evidence.ts` only formatted `min`; `claim-validator.ts` matched only the first room on a line and allowed en-dashes `(T2–T6)` to mimic a price range. | Added `category_pricing_summary` (ranges + `room_rate_variants` when non-uniform) in [agent-tools.ts](file:///C:/Chatbot/src/agent/agent-tools.ts); surfaced `[EXTRA_HOUR_VARIES]` & per-room `extra=` in [jcollection-agent.ts](file:///C:/Chatbot/src/agent/jcollection-agent.ts); printed `[min–max]` in [business-evidence.ts](file:///C:/Chatbot/src/conversation/grounding/business-evidence.ts); enforced `checkHeterogeneousCategoryCompleteness()` (with multi-line header inheritance and explicit range matching) in [claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts). | Test 25 in [v3-business-grounding-and-eval-integrity.test.ts](file:///C:/Chatbot/tests/v3-business-grounding-and-eval-integrity.test.ts); offline re-audit now catches `REPLAY-SCENARIO-039` (`599k/649k` citing `101, 601`) and `REPLAY-SCENARIO-041 T1` (`599k/649k` citing `Lồng Chim, 50 Sắc Thái, Playboy`). |
| **B. Room ↔ Category Relationship** | `validateRoomIdentity` only checked `validRoomCodes.has(code)` (entity existence), allowing misattributed room-category pairs. Furthermore, [jcollection-agent.ts](file:///C:/Chatbot/src/agent/jcollection-agent.ts#L1074) contained a hardcoded example calling `201 La Casta` (`Standard`) a `Deluxe` room, and Report `21` L95 misquoted `REPLAY-SCENARIO-041 T2` (the actual live JSON at [gate2-critical-replay.json](file:///C:/Chatbot/artifacts/eval-integrity/gate2-critical-replay.json) correctly said *"hoặc hạng Standard như **305 — Yêu I**"*). | Added canonical relational attribution check `validateRoomCategoryRelations()` against every `phong.hang` across all 66 rooms in [claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts); fixed `201 La Casta` -> `202 Grand Canyon` at [jcollection-agent.ts](file:///C:/Chatbot/src/agent/jcollection-agent.ts#L1074) (caught when running `STD-28`). | `STD-28` (`100/100` in [agentic-100-blind-benchmark.test.ts](file:///C:/Chatbot/tests/agentic-100-blind-benchmark.test.ts)) + Test 26 (`302` Deluxe vs `305` Standard) passed. |
| **C. Holiday Policy Provenance** | `data/j_collection_business_policy_v1_4_3.json` holds confirmed `OWNER_CONFIRMED_DIRECTIVE` (`status: OWNER_CONFIRMED_ACTIVE`, `holiday_policy.has_holiday_surcharge: false`), superseding `v1_4_2` (`UNCONFIRMED_HOLIDAY_POLICY`). However, `agent-tools.ts` returned a static string and `claim-validator.ts` checked hardcoded `"V1.4.3"` or the `V1.4.6` addendum object (`addendum?.source_metadata`) instead of `holiday_policy` provenance. | Added dynamic provenance evaluator `getHolidayPolicyProvenance()` in [pricing-policy-loader.ts](file:///C:/Chatbot/src/data-loader/pricing-policy-loader.ts); wired provenance records (`holidayZeroConfirmed`, `holidayProvenance`) through [agent-contracts.ts](file:///C:/Chatbot/src/agent/agent-contracts.ts), [agent-tools.ts](file:///C:/Chatbot/src/agent/agent-tools.ts), [business-evidence.ts](file:///C:/Chatbot/src/conversation/grounding/business-evidence.ts), and [claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts). Unconfirmed configs resolve strictly to `UNKNOWN` and reject `0đ` / *"không phụ thu"*. | Test 27 in [v3-business-grounding-and-eval-integrity.test.ts](file:///C:/Chatbot/tests/v3-business-grounding-and-eval-integrity.test.ts) passed (verifies both `OWNER_CONFIRMED_ACTIVE` and synthetic `UNCONFIRMED` rejection). |
| **D. Amenity Knowledge (`TRUE / FALSE / UNKNOWN`)** | Dataset omissions in `j-village.json` (`202-neon`) and `jacayl-tran-khat-chan.json` (`302-kimochi`, `503-long-chim`, `701-50-sac-thai`) were encoded at M0 boundary in `transformer.ts:68,74` as `CONFIRMED_FALSE` (`"Không có ghi nhận..."`), and `agent-tools.ts`, `advisory-composer.ts`, and `jcollection-agent.ts` collapsed everything non-`CONFIRMED_TRUE` to `'FALSE'` / *"không có bồn tắm"*. | Added runtime tri-state resolver `resolveTriStateAmenity()` (website omission `"không có ghi nhận"` → `'UNKNOWN'`) in [agent-tools.ts](file:///C:/Chatbot/src/agent/agent-tools.ts), [advisory-composer.ts](file:///C:/Chatbot/src/conversation/advisory-composer.ts), [jcollection-agent.ts](file:///C:/Chatbot/src/agent/jcollection-agent.ts), [business-evidence.ts](file:///C:/Chatbot/src/conversation/grounding/business-evidence.ts), and `validateAmenityProvenance()` in [claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts). Preserved `src/domain/transformer.ts:68,74` at the M0 ingestion layer strictly to avoid breaking frozen M0 regression suites (`tests/transformer.test.ts` and `tests/room-search.test.ts`, 61 items). | Test 28 passed; `transformer.test.ts` (7/7) & `room-search.test.ts` (9/9) intact; offline re-audit caught `UNKNOWN` *"không có"* claims on Gate 2 (`201-la-casta`, `202-neon`) and Gate 3 (`SCENARIO-255`, `SCENARIO-258`, `SCENARIO-270`). |
| **E. Unconditional Real-Time Vacancy Guard** | `claim-validator.ts` previously bypassed rejection of *"đang còn trống"* / *"còn trống"* whenever a disclaimer (*"liên hệ lễ tân"*) appeared in the same sentence/text. | Removed disclaimer bypass in `validateRoomIdentity` ([claim-validator.ts](file:///C:/Chatbot/src/conversation/grounding/claim-validator.ts)); affirmative stock assertions remain unconditionally rejected unless negated as an inability to verify live PMS availability. | Test 29 in [v3-business-grounding-and-eval-integrity.test.ts](file:///C:/Chatbot/tests/v3-business-grounding-and-eval-integrity.test.ts) + `SCENARIO-120` in Checkpoint 54 offline re-audit. |

---

## 3. Evaluation Integrity, Metric Clarification & Post-Audit Reconciliation

Historical live artifacts ([live-500-checkpoint.json](file:///C:/Chatbot/artifacts/live-500-batches/live-500-checkpoint.json), [gate2-critical-replay.json](file:///C:/Chatbot/artifacts/eval-integrity/gate2-critical-replay.json), [gate3-stratified-results.json](file:///C:/Chatbot/artifacts/eval-integrity/gate3-stratified-results.json)) were read-only inputs and were **not overwritten or mutated**. Revised post-audit results are exported to separate reconciliation artifacts.

### 3.1 Clarified Turn-Level Grounding Metric Units
- `first_attempt_clean_turns`: Count of evaluated turns passing initial Draft + ClaimValidator cleanly (`groundingGateRepairs === 0 && !groundingBlocked && rejectedClaims.length === 0`).
- `grounding_repairs`: **Sum of repair retry attempts** invoked by `GROUNDING_GATE` across all turns (a single turn retrying twice adds `+2`).
- `repaired_turns` (`repaired_turns_accepted`): **Count of distinct turns** where `groundingGateRepairs > 0 && !groundingBlocked` (successfully repaired and delivered). Added to [live-candidate-gate2-replay.ts](file:///C:/Chatbot/scripts/live-candidate-gate2-replay.ts), [live-candidate-gate3-stratified.ts](file:///C:/Chatbot/scripts/live-candidate-gate3-stratified.ts), and reconciliation reports.
- `grounding_blocks`: Count of turns blocked (`groundingBlocked === true`) after exhausting max repair attempts.
- **Exact turn conservation identity:** `total_turns = first_attempt_clean_turns + repaired_turns_accepted + grounding_blocks + blocked_turns`.

### 3.2 Historical Provenance & Commit Attribution
- **Gate 2 & Gate 3 Live Artifacts (`gate2-critical-replay.json`, `gate3-stratified-results.json`):** Executed on workspace state built from `gitCommit = 1365f33` plus uncommitted Gate 1 fixes that were subsequently committed as `d5b5bdb` / `398f5ed` (they do **not** reflect the later A–E code fixes added on top of `398f5ed`).
- **A/B Comparison Restriction:** Gate 3 (`17/18` initial, `14/18` post-audit) vs prior Live 500 `dc11876` (`5/12`) use different scenarios, different prompt cleaning, and different commit snapshots; they must **not** be treated as a direct controlled A/B delta.
- **Outside-500 Denominator Clarification:** Gate 3 consists of **17** scenarios from `immutable_500_catalog` plus **1** supplementary scenario (`PILOT-TKC-FAQ-001`, `source: supplementary_tkc_faq`), which must remain outside the 500-scenario Live Pilot denominator.

### 3.3 Post-Audit Reconciliation Tables

| Dataset (Historical Artifact) | Scenarios / Turns | Turn Identity Conservation | Strict Post-Audit Outcomes (`CONFIRMED_PASS` / `CONFIRMED_FAIL` / `PENDING_HUMAN_REVIEW` / `BLOCKED`) | Newly Flagged / False-PASS Cases |
| :--- | :---: | :--- | :---: | :--- |
| **Live 500 Checkpoint 54**<br>[offline-reevaluation-54.json](file:///C:/Chatbot/artifacts/eval-integrity/offline-reevaluation-54.json) | 54 / 96 | 94 `LIVE_COMPLETED` + 2 `BLOCKED` | **30 / 17 / 5 / 2** (`17` False-PASSes) | Newly catches Finding A Concept 4h omissions (`005, 009, 015, 023, 031, 033`), Finding D (`202-neon`, `205`, `503`), and Finding E (`120`). |
| **Gate 2 Critical Replay**<br>[gate2-post-audit-reconciliation.json](file:///C:/Chatbot/artifacts/eval-integrity/gate2-post-audit-reconciliation.json) | 9 / 17 | `13` clean + `1` repaired (`4` repair attempts) + `2` grounding-blocked + `1` API-blocked = `17` | **2 / 6 / 0 / 1** (`4` False-PASSes) | `REPLAY-SCENARIO-039` & `REPLAY-SCENARIO-041` (Finding A Concept 4h `599k/649k` citing `601`/`602`); `REPLAY-QUOTE-REUSE-RETRACT` & `REPLAY-MEDIA-CACHE` (Finding D *"không có bồn tắm"* on `201`/`202`). *(Note: `033` & `035` were pre-flagged DEGRADED grounding blocks).* |
| **Gate 3 Stratified 3x6**<br>[gate3-post-audit-reconciliation.json](file:///C:/Chatbot/artifacts/eval-integrity/gate3-post-audit-reconciliation.json) | 18 (17+1) / 31 | `27` clean + `3` repaired (`5` repair attempts) + `1` grounding-blocked + `0` API-blocked = `31` | **14 / 4 / 0 / 0** (`4` False-PASSes) | `SCENARIO-255` (`302-kimochi` `UNKNOWN`), `SCENARIO-258` (`701-50-sac-thai` `UNKNOWN`), `SCENARIO-270` (`503-long-chim` `UNKNOWN`), plus `SCENARIO-382` (`DEGRADED` grounding block). |

*(Note on Report 21 L92 & L95 discrepancies: Report 21 L92 wrote `799.000đ / 849.000đ` while raw `gate2-critical-replay.json` for `REPLAY-SCENARIO-039 T1` actually output `599.000đ / 649.000đ` alongside `101 Lồng Chim, 601 Sắc Thái`; Report 21 L95 omitted `"hoặc hạng Standard như **305 — Yêu I**"` present verbatim in `REPLAY-SCENARIO-041 T2`.)*

---

## 4. SQLite WAL Online Backup & Non-Destructive Rollback Procedure

1. **Online Backup API Implemented:** Added `SqliteStore.createOnlineBackup(destinationPath)` in [sqlite-store.ts](file:///C:/Chatbot/src/staff/persistence/sqlite-store.ts) backed by Node's built-in `node:sqlite#backup()` API so consistent SQLite snapshots complete safely even with `PRAGMA journal_mode = WAL` and active transactions (never raw `.db` file copy without `-wal`/`-shm` checkpointing).
2. **Schema Compatibility Verified:** `git diff dc11876 HEAD -- src/staff/persistence/migrations.ts` is empty (Schema version `1` identical between `dc11876` and candidate).
3. **Rollback Data-Preservation Rule:** Before any future promotion of candidate to production:
   - Take a consistent pre-promote snapshot via `store.createOnlineBackup(...)` into an archive path.
   - If rolling back code after promotion (`git checkout dc11876` + rebuild production `dist`), **rollback switches only the application binary (`dist`) and points it at the live `data/staff_dashboard.db`**. Never overwrite a post-promote production DB with the pre-promote snapshot; preserve post-promote customer conversations and staff takeover state intact (export an extra diagnostic snapshot via `createOnlineBackup` first if forensic comparison is needed).
4. **Verified by Test:** `tests/m4-persistence-recovery.test.ts` test #4 verifies WAL-active `createOnlineBackup()`, `PRAGMA integrity_check === 'ok'`, pre-promote vs post-promote row isolation, and untouched retention of post-promote rows.

---

## 5. Offline Verification Results (Post-Final-Edit)

- **TypeScript Build Check (`npx.cmd tsc --noEmit`):** Exit code `0` (0 errors).
- **Offline Vitest Regression (`RUN_REAL_API_TESTS=false`, zero live LLM calls):**
  - **56 / 56 sandboxed test suites passed (`755 / 755` tests passed)** across all domain, grounding, benchmark (`STD-28` fixed -> `100/100` blind benchmark), Finding A–E unit tests (`25–29`), M4 persistence/recovery (`4/4`), and M4 auth/takeover suites.
  - **1 / 1 localhost REST API socket suite passed (`tests/m4-invariants-regression.test.ts`, `7 / 7` tests passed, mock LLM gateway).**
  - **Combined Offline Verification:** **57 / 57 offline suites — 762 / 762 tests PASSED** (live suites `live-acceptance-20.test.ts`, `real-api-live-verification.test.ts`, `free-api-smoke.test.ts` and browser `tests/e2e/**` excluded).
- **Isolated Runtime Deployment Status:**
  - `npx.cmd tsc --outDir artifacts/candidate-runtime/dist` compiled cleanly (`0` errors).
  - **Port 3000 (`dc11876`):** Running untouched.
  - **Port 3100 (`feat/v3-final-grounding-eval-hardening`):** Restarted with updated `artifacts/candidate-runtime/dist` + isolated `artifacts/candidate-runtime/candidate_dashboard.db`. Both endpoints respond and enforce auth guard (`GET /api/telemetry` -> `401` pre-login).
