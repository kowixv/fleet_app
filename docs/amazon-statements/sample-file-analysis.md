# Amazon Sample File Analysis

The local sample files under `fixtures/amazon-statements/sample-week/` contain real financial, driver, vehicle, route, and fuel-card information. They are private local fixtures and must not be committed. Future automated tests should use synthetic anonymized fixtures.

Sample files inspected locally:

- `PAYMENT.xlsx`
- `Trips.csv`
- `fuel.pdf`
- owner-operator statement PDF reference

## PAYMENT.xlsx

Sheets:

- `Payment Summary`: 33 rows, 18 columns.
- `Payment Details`: 40 rows, 20 columns; 39 data/footer rows after the header.

`Payment Summary` contains invoice-level metadata and summary totals:

- carrier and SCAC metadata
- invoice id, invoice date, invoice total
- work period
- payment status and payment date
- work type
- pay term

The actual invoice id is private operational data and is intentionally omitted here.

Summary section:

| Item | Completed | Cancelled | Base | Accessorials | Total |
|---|---:|---:|---:|---:|---:|
| Trips | 7 | 0 | 13584.98 | 4200.18 | 17785.16 |
| Single Loads | 13 | 0 | 10178.41 | 2701.52 | 12879.93 |
| Total | | | | | 30665.09 |

`Payment Details` columns:

- `Invoice Number`
- `Block ID`
- `Trip ID`
- `Load ID`
- `Start Date`
- `End Date`
- `Route`
- `Operator Type`
- `Equipment`
- `Distance (Mi)`
- `Item Type`
- `Program Type`
- `Base Rate`
- `Fuel Surcharge`
- `Tolls`
- `Detention`
- `TONU`
- `Others`
- `Gross Pay`
- `Comments`

Payment Summary versus Payment Details:

- `Payment Summary` is an invoice-level rollup and should be used for metadata and reconciliation totals.
- `Payment Details` is the row-level financial source for statement lines and traceable revenue components.
- Footer/blank rows in `Payment Details` include a visual total row and must be classified as noise unless they carry an invoice number and valid row role.

## Parent Trip Rows and Child Load Rows

The sample has 36 valid invoice rows:

- 7 parent trip rows with `Trip ID`, blank `Load ID`, and `Item Type = TOUR - COMPLETED`.
- 29 child or standalone load rows with `Load ID`.

Parent trip rows:

- carry the trip base rate and gross equal to base.
- total base/gross: `13584.98`.

Child load rows:

- for trips with parent rows, carry accessorial amounts such as fuel surcharge and tolls.
- for standalone loads, carry their own base/accessorial/gross.
- total child gross across all child/standalone rows: `17080.11`.

Standalone load rows:

- 13 rows without a parent trip relationship.
- total gross: `12879.93`.
- base: `10178.41`.
- fuel surcharge: `2473.75`.
- tolls: `227.77`.

Trip child rows under parent trips:

- 16 rows.
- total child gross/accessorials: `4200.18`.

Correct invoice reconciliation:

`parent trip gross 13584.98 + child/standalone gross 17080.11 = invoice total 30665.09`

For a consolidated trip statement line, do not double count parent gross and child gross as separate load revenue lines. The statement should present one canonical revenue item using parent base plus child accessorials.

## Actual Financial Authority

Authoritative financial fields in `PAYMENT.xlsx`:

- `Payment Summary.Invoice total`
- `Payment Summary.Payment Status`
- `Payment Summary.Payment date`
- `Payment Details.Base Rate`
- `Payment Details.Fuel Surcharge`
- `Payment Details.Tolls`
- `Payment Details.Detention`
- `Payment Details.TONU`
- `Payment Details.Others`
- `Payment Details.Gross Pay`

Non-authoritative or operational-only fields:

- `Trips.csv.Estimated Cost`: operational estimate, not final Amazon revenue.
- `Trips.csv.Estimate Distance`: useful for miles, not money.
- generated statement PDF totals: useful expected output, not the raw source of truth.

## Trips.csv

Shape: 40 rows, 62 columns.

Important operational columns:

- `Trip ID`
- `Block/Trip`
- `Trip Stage`
- `Load ID`
- `Facility Sequence`
- `Load Execution Status`
- `Transit Operator Type`
- `Driver Name`
- `Equipment Type`
- `Trailer ID`
- `Tractor Vehicle ID`
- `Estimate Distance`
- `Unit`
- `Rate Type`
- `Estimated Cost`
- `Currency`
- `Operator ID`
- `Shipper Account`
- `Sub Carrier`
- `CR_ID`
- `Spot Work`
- repeated stop fields for Stop 1, Stop 2, Stop 3: facility, UTC offset, planned/actual arrival/departure dates and times, container id.

Observed values, anonymized:

- drivers: `Driver A`, `Driver B`, `Driver C`, `Driver A;Driver D`, `Driver B;Driver B`.
- tractor vehicle ids: `UNIT_A`, `UNIT_B`, `UNIT_C`.
- transit operator type: 39 `Single Driver`, 1 `Team Driver`.
- trip stages: 35 `Completed`, 5 `Canceled`.
- load execution statuses: 32 `Completed`, 8 `Cancelled`.

Driver, vehicle, Trip ID, and Load ID relationships:

- `Tractor Vehicle ID` is the operational external unit key.
- `Driver Name` is the operational driver/team key.
- `Trip ID` groups rows into Amazon trips and may use tour-style ids.
- `Load ID` identifies individual load legs and is the best primary match to payment rows.
- Some non-tour rows use the same value as `Trip ID` and `Load ID`, especially canceled single-load-looking rows.

Team-driver representation:

- `Transit Operator Type = Team Driver` appears explicitly.
- `Driver Name` may be semicolon-delimited.
- A semicolon-delimited name is not enough to infer a pay split.
- Duplicate self-team text should be treated as ambiguous until reviewed.
- Team revenue assignment must be explicit and configurable.

## fuel.pdf

PDF shape:

- 4 pages.
- Report title: `Transaction Report`.
- Fuel-card provider report.
- Report period: one week.
- Report totals: 30 transactions, total spent `7461.17`, discount `678.69`, 6 cards, quantity `1777.60`.

Grouping structure:

- Each group represents a card/account/cardholder/unit grouping.
- Group header pattern includes account/card mask, card id, card label/driver, ID, unit, and transaction count.
- Exact card ids, account masks, driver labels, and unit ids are private operational data and are intentionally omitted here.

Fuel card, driver, unit, invoice, and product-line relationships:

- A fuel card id can be associated with a driver label and unit in the report.
- The same driver or vehicle may have more than one fuel card, so mapping must be date-ranged and configurable.
- Transaction invoice number identifies a receipt/merchant event.
- One invoice may contain multiple product lines.
- In one owner-operator group, one receipt contains both `DEFD` and `ULSD` lines.

Fuel source authority:

- The product-line `Amount` is the actual fuel/DEF deduction authority.
- Group totals are reconciliation controls.
- Discounts and quantities should be stored for audit but should not replace `Amount`.

Anonymized owner-operator fuel group:

- card id: `CARD_OWNER_A`.
- internal statement unit: `UNIT_OWNER_A`.
- 6 transactions, but 7 product lines because one invoice has DEFD and ULSD.
- DEFD total: `57.94`, 11.61 gal.
- ULSD total: `1970.28`, 469.27 gal.
- group total: `2028.22`, 480.88 gal.
- total discount: `112.69`.

## Statement PDF

The sample generated statement is an owner-operator statement for an anonymized owner-operator payee.

Header and identity:

- title: `OWNER OPERATOR SETTLEMENT STATEMENT`
- company metadata
- driver/payee: `Owner Operator A`
- role: `Owner Operator`
- statement period and invoice/payment dates
- internal unit and fuel-card reference, anonymized

Calculation sections:

- Total gross revenue: `9291.84`.
- Insurance + ELD/Safety: `-900.00`.
- Company fee 12%: `-1115.02`.
- Fuel/DEF: `-2028.22`.
- Net pay to owner: `5248.60`.

Detailed deduction order:

1. Insurance: `-800.00`, current week plus next week charged early.
2. ELD & Safety: `-100.00`.
3. Company fee: `12% x 9291.84 = -1115.02`.
4. Fuel + DEF: `-2028.22`.

Revenue visual rules:

- Same Trip ID rows are merged into one line.
- Route displays first pickup and final delivery city/state only.
- Intermediate stops and station codes are omitted.
- Weight is `N/A` because the source payment file does not include weight.
- Amazon-paid tolls are included in gross revenue and are not treated as owner deductions.
- The statement includes loaded miles, gross average RPM, and net RPM.

Revenue lines:

- 9 statement lines.
- Two trip-grouped lines are consolidated from multiple child loads.
- 7 standalone load lines.
- total loaded miles `3233.09`.
- total base `7424.67`, fuel surcharge `1787.89`, tolls `79.28`, gross `9291.84`.

Fuel visual rules:

- Fuel and DEF detail lines remain separate.
- A single receipt with both DEFD and ULSD appears as two product lines.
- The transaction footer can count receipts, while detail rows count product lines.
- Fuel summary groups DEFD, ULSD, fees, total amount, gallons, and discount.

Signature and notes:

- The statement includes statement notes, company signature, owner approval signature, and preparation note.
- Notes explain early insurance deduction, trip consolidation, simplified routes, and omitted deductions.
