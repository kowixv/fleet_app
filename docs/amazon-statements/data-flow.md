# Amazon Statement Data Flow

## End-to-End Flow

1. Upload files into an Amazon import batch.
2. Store files in private Storage with org-scoped paths and SHA-256 hashes.
3. Parse each file into staging tables with source row/page references.
4. Parser-specific stages classify payment rows into parent trip rows, child load rows, standalone load rows, and summary/noise rows.
5. Match rows by `Load ID` first, then `Trip ID`, then configured internal vehicle, driver, team-driver, and fuel-card mappings.
6. Reconcile proposed revenue and expense records.
7. Send ambiguous, duplicate, or unmapped records to review.
8. On approval, create or update normal `loads` and `expenses`.
9. Use existing settlement preview to select approved rows and create a draft settlement through the existing atomic RPC.
10. Generate statement PDFs from approved source traces and stored settlement totals.

## Source Authority

`PAYMENT.xlsx` controls actual Amazon revenue:

- invoice identity and payment status from `Payment Summary`
- base, fuel surcharge, tolls, detention, TONU, others, gross pay from `Payment Details`
- parent trip base rows and standalone load rows

`Trips.csv` controls operations:

- driver and team-driver text
- tractor/unit id and trailer id
- operational route/facility sequence
- planned/actual stop dates and times
- execution status, trip stage, equipment type, distance, CR_ID, shipper account

Fuel PDF controls fuel deductions:

- transaction date/time, invoice, merchant, city/state
- card id, group label/driver, unit
- product lines and actual Amount
- per-product grouping totals and discounts

Canonical vehicle identity:

- `public.vehicles.id` is canonical.
- Amazon tractor IDs, Amazon units, and fuel-card units are external identifiers.
- External vehicle identifiers must be mapped to an internal vehicle with provider/type/date-range context.

## Payment Row Role Classification

Classify each `Payment Details` row before totaling:

- `trip_parent`: has `Trip ID`, empty `Load ID`, item type like `TOUR - COMPLETED`. Counts parent/base revenue for a trip.
- `load_child`: has `Trip ID` and `Load ID`. For a trip with a parent row, child rows generally carry load-level fuel surcharge/tolls/accessorials and should be rolled under the parent trip statement line, not counted as separate full loads.
- `standalone_load`: has `Load ID` but no parent trip id relationship. Counts as an individual statement line.
- `summary_or_noise`: empty invoice row, visual total row, blank separator, or non-data footer. Never creates production records.

For trips with parent rows, a consolidated statement line should be:

`parent base rate + child fuel surcharge + child tolls + child detention + child TONU + child others`

This matches the sample statement behavior. For standalone loads, the line should use the row's own base/accessorial/gross columns. The canonical revenue grouping key is `invoice_id + trip_id` when `trip_id` exists and `invoice_id + load_id` otherwise. One grouped canonical revenue item will eventually become one projected load.

## Matching Confidence Rules

Suggested confidence levels:

- `1.00 exact`: `Payment.Load ID` equals `Trips.Load ID`, and unit/date are compatible.
- `0.95 exact_trip`: `Payment.Trip ID` equals `Trips.Trip ID`, all child load ids reconcile, and unit/date are compatible.
- `0.85 operational_exact`: load id matches but driver/unit differs because of explicit reviewed team-driver or reassignment rule.
- `0.70 trip_only`: trip id matches but child rows are missing or differ; review required before approval.
- `0.55 fuzzy_driver_unit`: no id match, but driver, unit, date, route, and amount are close; review required.
- `0.00 blocked`: duplicate active production row, settlement-linked row, missing authority amount, conflicting unit, unmapped team driver, or parent/child double-count risk.

Auto-approval should be limited to exact or exact-trip matches with no duplicate production records, no active settlement links, and no missing team split configuration. Team-driver split is never assumed; missing split configuration is a blocking review issue.

## Reconciliation Outputs

The reconciliation engine should produce proposed production actions:

- `create_load`: a new `loads` row with Amazon revenue and operational assignment.
- `update_load`: a reviewed correction to an existing unlinked load.
- `create_expense`: a new `expenses` row for fuel/DEF/fees.
- `skip`: source row is informational, duplicate, zero-value, or outside the target owner/driver.
- `manual_review`: missing mapping, team split, duplicate candidate, or inconsistent totals.

Fuel inclusion defaults to transaction date within the statement period. Source report period and manual selection can be supported later.

Every proposed action should include trace lines:

- file id and hash
- sheet/page name
- source row number or PDF line/page coordinate when available
- normalized field path
- original value and normalized value
- parser version and rule version

## Settlement Handoff

Approved Amazon rows should become ordinary `loads` and `expenses`. Then:

- The current settlement page fetches eligible rows by vehicle/date/status.
- The existing preview computes through `computeSettlement`.
- The existing create action writes `settlements`, `settlement_items`, `settlement_load_links`, and `settlement_expense_links`.
- Voids release link rows through the existing workflow.

The Amazon subsystem must not bypass this handoff with direct settlement inserts.

## Error and Review States

Batch statuses:

- `uploaded`
- `parsing`
- `parsed`
- `needs_review`
- `reconciled`
- `ready`
- `failed`
- `archived`

Review item statuses:

- `open`
- `resolved`
- `ignored`
- `blocked`

Common review reasons:

- missing vehicle mapping
- missing person mapping
- team-driver split needed
- unmatched payment row
- unmatched trip row
- duplicate load candidate
- fuel card not mapped
- one invoice has multiple product lines
- parent/child revenue role conflict
- payment total does not reconcile to source summary

## Warning Lineage

Parser warnings are preserved as planned import issues with source file, sheet, row number, and source fingerprint. They remain warning issues unless a later deterministic stage explicitly marks them resolved with a resolution reason; later reconciliation must not drop them from batch counts.

Facility codes are different from facility locations. A valid source facility code is not a warning during parser, matching, or canonical revenue grouping. Canonical revenue items keep `route_resolution_status` so the later route display/facility-resolution stage can deterministically create `unresolved_facility` warnings only when city/state display is requested and no verified `amazon_facility_locations` mapping exists.
