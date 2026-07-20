# Amazon Statement Subsystem Audit

Date: 2026-07-19
Branch: `audit/amazon-settlement-hardening`
Baseline: latest `origin/main` after the PDF validation and weekly fuel posting-grace changes were merged.

## Scope

This audit covers the Amazon statement import and settlement flow from file registration through PDF output. It focuses on production runtime risks: authorization, tenant isolation, accounting correctness, idempotency, replay/concurrency behavior, parser reliability, and automation readiness.

## Current Architecture

1. Browser server actions in `app/(app)/settlements/amazon-imports/actions.ts` derive the actor with `requireAmazonImportActor`, then call server workflow services.
2. `lib/amazon-statements/server/file-service.ts` validates source type, stores uploads in the `imports` Supabase Storage bucket, and creates `amazon_import_files` rows.
3. `lib/amazon-statements/server/parse-service.ts` routes files to source-specific parsers:
   - `amazon_payment`: XLSX payment parser.
   - `amazon_trips`: CSV trip parser.
   - `fuel_card`: Octane fuel PDF/text parser.
   - `statement_reference`: currently registered but not parsed into settlement data.
4. `lib/amazon-statements/server/persistence-service.ts` persists parser output through `persist_amazon_source_atomic`, preserving raw-row lineage, parser versions, schema signatures, normalized rows, and issues.
5. Reconciliation services match payment rows to trips, resolve references, and prepare revenue/fuel projection inputs.
6. Projection application uses revision-checked RPCs for Amazon-controlled links to `loads` and `expenses`.
7. `lib/amazon-statements/server/final-workflow-service.ts` prepares reviewed statement candidates from selected revenue and fuel projection rows, validates payee/lane and source revisions, then saves candidate snapshots.
8. `lib/amazon-statements/server/candidate-service.ts` applies candidate approval and archive status changes with preview revision checks.
9. `lib/amazon-statements/server/conversion-service.ts` calls `convert_amazon_candidate_atomic` to create one settlement exactly once from an approved candidate.
10. `lib/amazon-statements/server/pdf-service.ts` renders statement PDFs from persisted settlement/candidate snapshots instead of reparsing source files.

## Security Findings

| ID | Severity | Finding | Evidence | Production impact | Fix plan |
| --- | --- | --- | --- | --- | --- |
| SEC-01 | High | Uploaded files are fully buffered in the server action before file size validation. | `registerAmazonImportFileAction` calls `file.arrayBuffer()` before `assertAmazonFileSecurity` can run. | Oversized uploads can consume memory before the workflow rejects them. | Add envelope validation before buffering and keep deep signature checks after bytes are available. |
| SEC-02 | Medium | Service-role storage downloads do not re-check that the stored path matches the org, batch, source type, and hash at parse time. | `downloadAmazonImportFile` checks `organization_id` but downloads `file.storage_path` directly. | A corrupted or incorrectly written DB row could make the service client read an unexpected object path. | Reuse `assertExpectedAmazonStoragePath` before every service-role download. |
| SEC-03 | Medium | Duplicate file detection is scoped by org/source/hash, not batch. | `registerAmazonImportFile` duplicate query omits `batch_id`. | A repeated file in a later weekly batch can return a file id from a previous batch, leaving the new batch without its own file record. | Scope duplicate idempotency to the current batch. |
| SEC-04 | Low | Some UI detail reads rely on RLS and batch ownership rather than explicit org filters on every child query. | `ui-read-service.ts` uses several batch-scoped queries. | RLS should protect these reads, but explicit org filters would make future service-client refactors safer. | Add defense-in-depth org filters in a later UI read hardening PR. |

## Accounting Findings

| ID | Severity | Finding | Evidence | Production impact | Fix plan |
| --- | --- | --- | --- | --- | --- |
| ACC-01 | Low | Settlement engine rules remain config-driven and are not coupled to Amazon parsing. | Amazon conversion calls shared settlement creation; core settlement tests remain separate. | Low risk to the existing five settlement models if the shared creator contract is preserved. | Keep settlement engine untouched; add integration checks around Amazon conversion. |
| ACC-02 | Medium | Candidate source selection is revision-aware, but automation can still be manually sequenced out of order. | Preview/save/approve/convert require preview/source revisions, but actions are separate user-triggered calls. | Users can leave a batch partially processed without a clear single job result. | Add a single weekly workflow orchestrator with stage summaries and retry policy. |
| ACC-03 | Low | Fuel posting grace is intentionally one day only for transaction-date policy. | `candidate-source-selector-fuel-period.test.ts` verifies one day after period end passes and two days after fails. | Matches the latest weekly fuel handling requirement. | Keep test as regression coverage. |

## Reliability Findings

| ID | Severity | Finding | Evidence | Production impact | Fix plan |
| --- | --- | --- | --- | --- | --- |
| REL-01 | Medium | `parseAmazonImportBatch` can persist earlier files, then fail on a later file. | Batch parsing loops files and persists each file through an atomic RPC. | Data can be partially parsed while the batch status is failed; retry behavior depends on idempotent source persistence. | Add job-level stage summaries and explicit retry tests. |
| REL-02 | Medium | Payment/trip parse service appears to inspect through the parser registry and then invoke concrete parsers again. | `parseAmazonImportFile` routes payment/trips through `selectAmazonStatementParser` and source-specific parser calls. | Extra CPU and potential parser-selection drift if parser registry evolves. | Refactor parser registry to return a single parse artifact per source. |
| REL-03 | Medium | No synthetic weekly E2E workflow test currently proves upload through conversion and PDF validation in one run. | Existing tests are strong static/unit guardrails but not a complete weekly scenario. | Regression risk remains across service boundaries. | Add a synthetic workflow simulation after orchestration is introduced. |

## Automation Gaps

| Gap | Current state | Required upgrade |
| --- | --- | --- |
| Weekly single-command processing | Browser actions expose individual stages. | A server-side `processAmazonWeeklyBatch` should run inspect, parse, reconcile, reference checks, projection preview/application, candidate preparation, and final status reporting with idempotent stage checkpoints. |
| Operational telemetry | Errors return workflow shapes, but there is no durable job summary for the full weekly run. | Persist or emit a stage summary with retryable/non-retryable failure classes. |
| Synthetic E2E smoke | Simulation scripts exist, but no one test proves the current weekly happy path plus guarded failure paths. | Add fixture-backed weekly simulations for duplicate upload, projection revision conflict, conversion replay, and PDF validation failure. |
| PR separation | Main contains multiple historical Amazon migrations/features. | Future hardening should be split into small PRs with one risk class per PR. |

## PR Plan

| PR | Theme | Contents | Migration required |
| --- | --- | --- | --- |
| A | Upload and storage hardening | Pre-buffer envelope validation, per-batch duplicate idempotency, service-role path assertion, regression tests, this audit. | No |
| B | Read-model defense in depth | Add explicit org filters to Amazon UI child queries; add source tests for every read-model query touching tenant data. | No |
| C | Parser pipeline reliability | Remove double parse path, add parser registry contract tests, add bad-header and schema-drift fixtures. | No |
| D | Weekly orchestration | Add `processAmazonWeeklyBatch`, durable stage summary, retry policy, and synthetic weekly E2E simulation. | Possibly, if durable job summaries are stored. |
| E | Production operations | Add cron/admin trigger, smoke checklist, alerting hooks, and runbook updates. | Possibly, if automation jobs/locks are persisted. |

## Risk Assessment

The subsystem has strong foundational controls: server-derived actors, org-scoped batch reads, RLS-backed tables, transactional persistence/conversion RPCs, preview/source revision checks, and immutable converted candidates. The main production gaps are not settlement math defects; they are operational hardening gaps around upload memory pressure, service-role storage path trust, batch-local file identity, and lack of a single durable weekly orchestration layer.

PR A is safe to ship first because it does not alter parser output, settlement calculations, candidate formulas, database schema, or PDF rendering. It tightens acceptance boundaries around data that the rest of the workflow already expects.
