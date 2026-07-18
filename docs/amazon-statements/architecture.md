# Amazon Statement Import Architecture

## Scope

This subsystem should import Amazon Relay weekly settlement artifacts, reconcile them against operational trip data and fuel-card data, and prepare reviewed load and expense records for the existing settlement module. It must not create settlements directly. The current settlement engine, workflow helpers, link-table accounting lanes, and PDF route remain authoritative for settlement creation and locking.

## Current System Boundaries

The existing settlement system has these important boundaries:

- `lib/settlement/engine.ts` is a pure config-driven calculation engine. Payment model numbers are not hardcoded.
- `app/(app)/settlements/actions.ts` builds a server-side preview, refetches selected rows, recomputes the result, and persists through the service-only `create_settlement_with_links_atomic` RPC.
- `settlement_load_links` and `settlement_expense_links` are the authoritative usage locks for settlement accounting lanes. Legacy `loads.settlement_id` and `expenses.settlement_id` are compatibility fields only.
- `finalized`, `paid`, and `void` settlement financial values are database-guarded against mutation.
- Existing uploads use private Storage buckets and org-scoped paths. Signed URL access checks both path ownership and an RLS-visible row.

The Amazon subsystem should sit before settlement creation:

```mermaid
flowchart LR
  A["Uploaded Amazon files"] --> B["Parser layer"]
  B --> C["Normalized import tables"]
  C --> D["Matching and reconciliation layer"]
  D --> E["Manual review inbox"]
  E --> F["Approved load and expense creation"]
  F --> G["Existing settlement preview"]
  G --> H["Existing atomic settlement RPC"]
```

## Authority Rules

- `PAYMENT.xlsx` is the authority for actual Amazon revenue.
- `Trips.csv` is the authority for operational assignment, driver, unit, route, planned/actual stop timing, equipment, and trip/load execution status.
- Fuel-card source Amount is the authority for actual fuel deduction.
- `Load ID` is the primary match key.
- `Trip ID` is the secondary match key.
- Parent trip rows and child load rows must never both be counted as independent revenue for the same statement line.
- Fuel transaction headers and product lines must remain separate. A single invoice can contain both DEF and ULSD lines.
- Every calculated number must trace to source file, sheet/page, row, parser version, rule version, and template version.

## Approved Business Decisions

1. Team-driver split is never assumed. Missing split configuration creates a blocking review issue.
2. Revenue grouping key is `invoice_id + trip_id` when `trip_id` exists, otherwise `invoice_id + load_id`.
3. One grouped canonical revenue item will eventually become one projected load.
4. Parent trip rows and child load financial components are consolidated under the grouping key and must not become separate visible settlement revenue lines.
5. Fuel transactions and fuel product lines remain separate.
6. DEF and ULSD under the same invoice remain separate product lines.
7. Default fuel inclusion policy is transaction date within the statement period. Source report period and manual selection can be supported later.
8. The canonical vehicle is `public.vehicles.id`. Amazon tractor IDs, Amazon units, and fuel-card units are external identifiers mapped to the internal vehicle.
9. `PAYMENT.xlsx` is actual revenue authority, `Trips.csv` is operational assignment authority, and fuel charged Amount is fuel deduction authority.
10. Imports never create settlements directly.

## Proposed Domain Model

Use import-owned tables as a staging ledger. Existing `loads`, `expenses`, `settlements`, `settlement_items`, `settlement_load_links`, and `settlement_expense_links` should not be extended until a row is approved.

Core foundation tables:

- `amazon_import_batches`: one user upload session/week. Stores org, status, source file metadata, parser versions, rule version, template version, period, invoice number, payment status, created/reviewed audit fields.
- `amazon_import_files`: one row per uploaded source file. Stores bucket path, original filename, MIME, size, SHA-256, source type (`amazon_payment`, `amazon_trips`, `fuel_card`, `statement_reference`), parse status, and parse diagnostics. Duplicate active file protection is scoped by organization, source type, and file hash.
- `amazon_import_raw_rows`: generic source-lineage rows from any parser stage. Stores sheet/page/group/row, raw JSON, normalized JSON, parse status, and warning text. Source lineage uniqueness is scoped by organization, batch, file, and source coordinates so every derived value can be traced to one source location.
- `amazon_import_issues`: durable parser/reconciliation/review issues with severity and resolution audit fields.
- `amazon_import_reconciliations`: generic reconciliation observations for counts and amounts.
- `amazon_import_review_decisions`: append-only audit trail of manual decisions.
- `amazon_external_vehicle_identifiers`: date-ranged mapping from external provider identifiers to `public.vehicles.id`, using half-open effective ranges so one vehicle assignment can end on the same date the next begins.

Parser-specific tables such as payment rows, trip rows, fuel transactions, and fuel product lines are intentionally deferred to parser stages. The core foundation stores generic raw/normalized rows and review metadata only.

All tables must include `organization_id`, RLS with `current_org_id()`, writer-gated mutations, same-org foreign keys, indexes on `(organization_id, batch_id)`, and source keys such as `(organization_id, load_id)` or `(organization_id, trip_id)` where appropriate.

## Module Boundaries

Keep these modules separate:

- Parser: reads source bytes and returns typed normalized records plus diagnostics. It does not match, calculate, or write production `loads`/`expenses`.
- Normalizer: coerces money, dates, row roles, product types, route tokens, driver names, unit ids, and source references.
- Matching engine: links payment/trip/fuel rows to internal vehicles, people, fuel cards, and existing loads/expenses.
- Reconciliation engine: decides proposed load/expense rows, prevents double counting, and produces traceable totals.
- Review workflow: exposes proposed actions and lets a human accept, reject, or override mappings.
- Settlement adapter: after approval, creates normal `loads` and `expenses`; existing settlement preview consumes them unchanged.
- Statement renderer: generates Amazon-style owner/operator statements from reviewed normalized data and existing settlement results. It does not recompute business truth.

## Integration Points

- Existing `loads`: approved Amazon revenue creates or updates rows with `load_source = 'amazon_relay'`, `gross_amount` from payment authority, operational fields from Trips.csv, and source metadata in notes or future source columns.
- Existing `expenses`: approved fuel product lines create expense rows by product/category, with actual deduction amount from fuel source Amount and targeting flags set by review/mapping.
- Existing `settlements` UI: add an import-assisted entry path that filters reviewed Amazon rows, then passes selected `load_ids` and `expense_ids` into the current preview/create flow.
- Existing PDF generation: preserve the current generic settlement PDF. Add a separate Amazon statement renderer only for Amazon-style statements, sourced from approved import rows and existing settlement totals.
- Existing Storage: use a private bucket and org-scoped paths. Prefer a new `amazon-imports` bucket or namespaced paths in `imports`; do not sign files without a row ownership check.

## Invariants

- Imports never immediately create settlements.
- Ambiguous or unmatched rows go to review.
- Parent and child payment rows are reconciled by role before totals are eligible for approval.
- Link-table settlement lanes remain the only authority for whether a load/expense has already been consumed by a non-void settlement.
- Approved imported rows must be idempotent by source hash plus source row identity.
- Parser, rule, and template versions must be stored with each batch and propagated into approved record source metadata.
