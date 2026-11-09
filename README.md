# Real-estate transaction alerts

Tells a client's fundraisers when one of their prospects buys or sells a home. Each month the app pulls every
recorded home sale in the client's counties from [RealEstateAPI](https://developer.realestateapi.com/reference),
matches buyer and seller names against the client's prospect list, confirms with the address, scores each match,
and writes a CSV of the confident ones.

Status: a working prototype CLI. Name reading, matching and scoring are done and tested. The data fetch must move
to the production workflow below before this runs unattended.

## Setup

```bash
npm install
npm test                 # builds packages/core, then runs the real-estate tests (87)
npm run build
```

Put the API key in a `.env` file in the directory you run from (never commit it):

```
REALESTATEAPI_API_KEY=...
```

## Running

```bash
# 1. Price a month first: count calls only, 0 credits on a paid plan.
node apps/real-estate/dist/src/cli/index.js monitor --vendor=realestateapi \
  --prospects=path/to/prospects.csv --county-list=apps/real-estate/data/cmu-hotchkiss-counties.csv \
  --start=2026-10-01 --end=2026-10-31 --dry-run=true

# 2. Run it, with the credit budget set just above the step 1 total (default 500).
node apps/real-estate/dist/src/cli/index.js monitor --vendor=realestateapi \
  --prospects=path/to/prospects.csv --county-list=apps/real-estate/data/cmu-hotchkiss-counties.csv \
  --start=2026-10-01 --end=2026-10-31 --max-credits=30000
```

- Always pass `--vendor=realestateapi`. The default is still a legacy vendor (see "What is left to build").
- Prospect CSV: a `name` column is required; `prospect_id`, `address`, `city`, `state`, `zip` and `aliases`
  (separated by `;`) are optional but improve matches. Prospect files hold personal data and are gitignored.
- County CSV: `fips`, `county`, `state`.
- Output goes to `.restate/runs/<run-id>/`: `client.csv` (high and medium matches), `review.csv`, `summary.txt`,
  `stats.json`, `manifest.json`. Every paid response is cached under `.restate/raw/`, so a re-run of the same
  county and window costs nothing.

## How a match is made

1. **Filter**: client counties only (5-digit FIPS; Connecticut uses the old codes 09001 to 09015), arm's-length
   sales only, at least one person on the deed, price unknown or above $100. A price of 0 means "not disclosed".
2. **Read names**: each deed name string becomes people. Couples share a surname ("John & Mary Smith"), trusts
   named after people give those people, companies and surname-only trusts give nobody.
   Match key: lower-case "first last".
3. **Match the name exactly** against the prospect's name variants (nicknames, dropped middle name or suffix,
   aliases). No fuzzy spelling.
4. **Confirm with the address**: sellers against the sold home; buyers against their mailing address and the
   bought home. Levels: same street, ZIP, city and state, state only, nothing.
5. **Score**: name points (full name 50, nickname 40, borrowed surname 30) + address points (street 45, ZIP 38,
   city 22, state 3 to 5), minus 20 if the state contradicts. 85+ is high, 65 to 84 medium: both go to the
   client. Lower, or no address in common, goes to review.

Code: `apps/real-estate/src`, starting at `core/TransactionMonitoringEngine.ts`.

## Production workflow (verified 9 Nov 2026)

The search row's seller field (`priorOwner`) is the assessor's previous owner, not the deed seller: it was right
on only 77% of sales. The vendor's fix gives every sale the deed sellers at 1 credit:

| Step | Endpoint | Credits on Pro |
| --- | --- | --- |
| Count sales in a county and month | `POST /v2/PropertySearch` with `count: true` | 0 |
| List the month's sale IDs | `POST /v2/PropertySearch` with `ids_only: true`, filtered by `recording_date_min/max` | 0 |
| Fetch the deed records | `POST /v2/PropertyDetailBulk` with up to 1,000 `ids` | 1 per record |

Verified on one county (Waukesha WI, May 2026): 571 of 571 Bulk records had deed sellers, deed buyers, document
number, recording date and price; 98.9% had the buyer's mailing address. The dashboard showed 571 credits for 36
calls, so count and `ids_only` calls are free. Each record also carries `saleHistory`, every past deed for the
property with buyers and sellers.

Parser notes for the Bulk record shape:
- `propertyInfo.address.street` is only the street name ("Chipmunk"); use `.address` ("2135 Chipmunk Ct") or `.label`.
- Records come back in a different order from the IDs sent: join on `id`.
- There is no `credits` field in the response; count records yourself.
- `lastSale.saleDate` has a time part; cut dates to YYYY-MM-DD.

Coverage gaps found: Allegheny PA, St. Louis County MO, Monroe NY, York PA and Chesterfield VA had no September
2026 recordings; Sheboygan WI and Le Sueur MN have no sales data at all.

## What is left to build

1. Fetch with `ids_only` + `PropertyDetailBulk` for every sale; parse the Detail shape; match sellers on
   `lastSale.sellerNames` only.
2. Scan by recording date in whole calendar months, so late deeds are caught once.
3. Alert ledger (`prospect ID + role + property ID + document number`) so a client never gets a sale twice.
4. Monthly credit meter with a hard stop below the plan's 400,000 credits.
5. Make RealEstateAPI the default vendor and remove the legacy BatchData and ATTOM code paths.
6. Retries, scheduling, a database for matches and ledger, secrets management, county coverage monitoring.

Never call the premium endpoints (Involuntary Lien, AVM, Skip Tracing): they are billed outside the plan. On a
pay-as-you-go wallet, count and `ids_only` calls cost 1 credit each.

## Known issue

`npm run test:core` has one failing test (`geo-matcher`, "handles one side missing state"). It fails the same
way in the original repo and only affects the political-funding app's location matcher, which this app does not
use.

## Layout

```
packages/core/          shared prospect loading, name parsing and name variants
apps/real-estate/
  src/cli/              restate CLI: monitor, bulk-fetch
  src/core/             run loop and types
  src/fetchers/         RealEstateAPI client, transaction sources, cache
  src/parsers/          vendor row to PropertyRecord, name and address parsing
  src/lib/              address matching, scoring, credit preflight, county lists
  src/io/               CSV output
  tests/                unit and end-to-end tests (mocked HTTP, no live calls)
  data/                 county lists (fips, county, state)
```
