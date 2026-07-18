# Amazon Statement Implementation Plan

This is a planning document. The core import foundation is intentionally small; parser-specific stages come later.

## Phase 1 - Read-Only Parser Spike

No database changes.

Proposed modules:

- `lib/amazon-statements/types.ts`
- `lib/amazon-statements/payment-parser.ts`
- `lib/amazon-statements/trips-parser.ts`
- `lib/amazon-statements/fuel-parser.ts`
- `lib/amazon-statements/source-trace.ts`

Parser interfaces:

```ts
type ParserInput = {
  bytes: Uint8Array;
  fileName: string;
  sourceHash: string;
  parserVersion: string;
};

type ParsedArtifact<T> = {
  rows: T[];
  diagnostics: string[];
  source: {
    fileName: string;
    sourceHash: string;
    parserVersion: string;
  };
};
```

Dependencies to evaluate:

- Existing app has `unpdf` and `@react-pdf/renderer`.
- No production Excel/CSV parser is currently present.
- Add a spreadsheet parser only after evaluating bundle/serverless impact. Candidate: `xlsx` for XLSX plus a lightweight CSV parser, or server-only parsing with Web APIs where practical.

Tests:

- Fixture tests for `PAYMENT.xlsx`, `Trips.csv`, and `fuel.pdf`.
- Snapshot normalized JSON for row role classification and source traces.
- Reconciliation checks against invoice total `30665.09` and sample owner-operator subset `9291.84`.

## Phase 2 - Core Staging Schema

Core migration:

1. `amazon_import_batches`, `amazon_import_files`, `amazon_import_raw_rows`.
2. `amazon_import_issues`, `amazon_import_reconciliations`, `amazon_import_review_decisions`.
3. `amazon_external_vehicle_identifiers`.

Deferred parser-stage migrations:

1. Payment-specific normalized rows and summaries.
2. Trips-specific normalized rows.
3. Fuel transaction and fuel product-line tables.
4. Matching/review projection tables.
5. Team-driver split and statement template tables.

Migration dependencies:

- Depends on existing `organizations`, `profiles`, `vehicles`, `people`, `loads`, `expenses`, and settings/RLS helpers.
- Same-org foreign keys should follow the pattern already used in migrations.
- RLS must be enabled before exposing rows to app routes.
- Writer roles should gate inserts/updates/deletes; viewers select only.
- Imports never create settlements directly.
- `public.vehicles.id` is the canonical vehicle key; external unit/card identifiers map to it.

Indexes:

- `(organization_id, batch_id)` on every child import table.
- `(organization_id, source_type, sha256_hash)` partial unique index for duplicate active file detection while status is `uploaded`, `parsing`, or `parsed`; `failed` and `archived` imports must be retryable.
- source-lineage uniqueness for raw rows across `organization_id`, `batch_id`, `file_id`, sheet/page/group/row, including nullable-source sentinels that cannot appear in real source values.
- overlap protection for external vehicle identifier provider/type/value effective dates using half-open `[effective_from, effective_to)` ranges so adjacent assignments are allowed.

## Phase 3 - Matching and Reconciliation

Proposed modules:

- `lib/amazon-statements/classify-payment-row.ts`
- `lib/amazon-statements/match.ts`
- `lib/amazon-statements/reconcile-revenue.ts`
- `lib/amazon-statements/reconcile-fuel.ts`
- `lib/amazon-statements/confidence.ts`
- `lib/amazon-statements/review-actions.ts`

Reconciliation rules:

- Never count `summary_or_noise`.
- For parent trips, count parent base plus child accessorial columns, not parent gross plus child gross blindly.
- For standalone loads, count the standalone row gross.
- Use revenue grouping key `invoice_id + trip_id` when `trip_id` exists and `invoice_id + load_id` otherwise.
- One grouped canonical revenue item eventually becomes one projected load.
- Prefer `PAYMENT.xlsx` actual amounts over `Trips.csv` estimated cost.
- Use Trips.csv driver/unit/route/status fields for operational assignment.
- Use fuel PDF line Amount for expense amount.
- Preserve each fuel product line as a separate proposed expense or expense source line. Do not collapse DEF and ULSD into one source row.
- Include fuel by transaction date within statement period by default.
- Detect active `settlement_load_links` and `settlement_expense_links`; block updates to already consumed production rows.

Confidence rules:

- Exact load id plus compatible unit/date can auto-propose.
- Exact trip id with complete child reconciliation can auto-propose.
- Team-driver rows, semicolon-delimited driver names, missing split configuration, missing unit mappings, and duplicate candidates require review.
- Fuel cards without valid date-range assignment require review.

## Phase 4 - Review UI

Proposed routes:

- `app/(app)/amazon-imports/page.tsx`: batch list.
- `app/(app)/amazon-imports/new/page.tsx`: upload multiple source files.
- `app/(app)/amazon-imports/[id]/page.tsx`: batch dashboard, totals, parse diagnostics.
- `app/(app)/amazon-imports/[id]/review/page.tsx`: review queue.
- `app/(app)/amazon-imports/settings/page.tsx`: fuel card mappings, team-driver rules, template versions.

UI requirements:

- Show source file, row/page, original value, normalized value, and proposed production field.
- Show exact reason for manual review.
- Let reviewer map driver, team split, vehicle, fuel card, owner/investor, and expense target lane.
- Require explicit confirmation before creating production `loads` or `expenses`.
- Make approved rows discoverable from the existing settlement page.

## Phase 5 - Production Row Creation

Proposed server actions:

- `parseAmazonImportBatch`
- `reconcileAmazonImportBatch`
- `approveAmazonReviewItem`
- `applyAmazonApprovedRows`
- `voidAmazonImportBatch`

Production writes:

- Insert `loads` only after review or high-confidence approval.
- Insert `expenses` only after fuel-card mapping and target lane are known.
- Store enough source trace in import tables; production rows can reference import review item ids if a migration adds optional source columns later.
- Do not write `settlements` or settlement link tables from the Amazon subsystem.

## Phase 6 - Amazon Statement Renderer

Proposed modules:

- `lib/amazon-statements/statement-model.ts`
- `lib/amazon-statements/statement-renderer.tsx`
- `app/api/amazon-imports/[id]/statement/pdf/route.ts`

Renderer rules:

- Use reviewed revenue lines and existing settlement totals.
- Keep same Trip ID rows consolidated when configured.
- Display source totals: gross, company fee, insurance/ELD, fuel/DEF, net.
- Show fuel product lines separately.
- Show notes explaining route simplification, team splits, missing weights, and source authority.
- Store `template_version` with generated statements.

## Testing Strategy

- Parser unit tests with the provided fixtures.
- Row role tests for parent trip, child load, standalone load, and summary/noise rows.
- Reconciliation tests for no double counting.
- Fuel tests proving one invoice can create multiple product lines.
- Team-driver tests for semicolon-delimited names and explicit split rules.
- RLS/schema text tests matching existing migration-test style.
- Server action tests for no settlement creation during import.
- Regression tests for existing settlement engine numbers: `322.14`, `391.56`, `6360.98`, `1306.85`, `6421.19`.

## Risks to Current Settlement System

- Double counting Amazon parent and child rows could inflate gross revenue.
- Creating settlements directly would bypass preview revision checks and link-table locks.
- Updating linked `loads` or `expenses` could mutate finalized settlement history.
- Treating `Trips.csv` estimated cost as financial authority could override actual Amazon payments.
- Collapsing fuel product lines could erase DEF/ULSD auditability.
- Implicit team-driver parsing could assign revenue to the wrong payee.
- Adding broad CRUD allowlist entries for import tables could expose unsafe writes.
- Storage signing without org-row verification would reintroduce cross-tenant file access risk.
