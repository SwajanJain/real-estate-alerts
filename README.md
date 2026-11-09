# Real-estate transaction alerts

Tells a client's fundraisers when one of their prospects buys or sells a home. Each month the app pulls every
recorded home sale in the client's counties from [RealEstateAPI](https://developer.realestateapi.com/reference),
matches buyer and seller names against the client's prospect list, confirms with the address, scores each match,
and writes a CSV of the confident ones.

Status: a working CLI. The data fetch uses the workflow verified with the vendor on 9 Nov 2026 (deed sellers for
every sale at 1 credit, by recording date); name reading, matching and scoring are tested. Running unattended still
needs the items under "What is left to build".

## Setup

```bash
npm install
npm test                 # builds packages/core, then runs the real-estate tests (96)
npm run build
```

Put the API key in a `.env` file in the directory you run from (never commit it):

```
REALESTATEAPI_API_KEY=...
```

## Running

```bash
# 1. Price a month first: count calls only, 0 credits on a paid plan.
node apps/real-estate/dist/src/cli/index.js monitor \
  --prospects=path/to/prospects.csv --county-list=apps/real-estate/data/cmu-hotchkiss-counties.csv \
  --start=2026-10-01 --end=2026-10-31 --dry-run=true

# 2. Run it, with the credit budget set just above the step 1 total (default 500).
node apps/real-estate/dist/src/cli/index.js monitor \
  --prospects=path/to/prospects.csv --county-list=apps/real-estate/data/cmu-hotchkiss-counties.csv \
  --start=2026-10-01 --end=2026-10-31 --max-credits=30000
```

- RealEstateAPI and its Bulk workflow are the defaults (`--vendor=realestateapi --fetch=bulk`). The window
  (`--start`, `--end`) is matched against the date each deed was **recorded**; scan whole calendar months.
- `--fetch=search` runs the old PropertySearch path (sellers from `priorOwner`, closing-date windows) for comparison.
- Prospect CSV: a `name` column is required; `prospect_id`, `address`, `city`, `state`, `zip` and `aliases`
  (separated by `;`) are optional but improve matches. Prospect files hold personal data and are gitignored.
- County CSV: `fips`, `county`, `state`.
- Output goes to `.restate/runs/<run-id>/`: `client.csv` (high and medium matches), `review.csv`, `summary.txt`,
  `stats.json`, `manifest.json`. Every paid response is cached under `.restate/raw/`, so a re-run of the same
  county and window costs nothing.

## County lists

All lists live in `apps/real-estate/data/` with columns `fips`, `county`, `state`; the ranked ones add `rank`
(by the client's number of prospects in the county). Only `fips` is sent to RealEstateAPI.

| File | Counties | What it is |
| --- | --- | --- |
| `us-counties.csv` | 3,143 | Every county in the 50 states and DC (Census 2020) |
| `all-clients-counties.csv` | 2,350 | Every county where any client has a prospect |
| `<client>-all-counties.csv` | 572 to 1,805 | Every county where that client has a prospect |
| `cmu-hotchkiss-counties.csv`, `cmu-hotchkiss-75pct-counties.csv`, `cmu-hotchkiss-hbs-rmu-counties.csv`, `marquette-new-counties.csv` | 47 to 275 | Earlier top-county lists, cut at a coverage target |

- **Connecticut** uses its 8 legacy county codes, 09001 to 09015. RealEstateAPI returns no sales for the 2022
  planning-region codes (09110 to 09190); a test fails if any list contains them.
- **How the client lists were built**: each prospect's ZIP goes to the county holding most of that ZIP's land,
  from the Census 2020 [ZCTA-to-county file](https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt);
  ZIPs it lacks (mostly PO boxes) fall back to GeoNames by ZIP, then by city and state. 89% to 99.5% of each
  client's prospects were placed; the rest are outside the US or have no ZIP or city. County names come from the
  [Census 2020 county file](https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt).
- **Cost**: the top-county lists (about 277 counties) come to about 255,000 sales a month, against the plan's
  400,000 credits. A complete list costs more. Price any list first with `--dry-run=true`; count calls are free
  on a paid plan.

## How a match is made

1. **Filter**: client counties only (5-digit FIPS; Connecticut uses the old codes 09001 to 09015), deeds recorded
   in the window, arm's-length sales only, at least one person on the deed, price unknown or above $100. A price
   of 0 means "not disclosed".
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

## Data workflow (verified 9 Nov 2026, the default)

The search row's seller field (`priorOwner`) is the assessor's previous owner, not the deed seller: it was right
on only 77% of sales. The code therefore fetches every sale like this (`RealEstateApiBulkSource`), which gives
every sale the deed's buyers, sellers and document number at 1 credit:

| Step | Endpoint | Credits on Pro |
| --- | --- | --- |
| Count sales in a county and month | `POST /v2/PropertySearch` with `count: true` | 0 |
| List the month's sale IDs | `POST /v2/PropertySearch` with `ids_only: true`, filtered by `recording_date_min/max` | 0 |
| Fetch the deed records | `POST /v2/PropertyDetailBulk` with up to 1,000 `ids` | 1 per record |

Verified on one county (Waukesha WI, May 2026): 571 of 571 Bulk records had deed sellers, deed buyers, document
number, recording date and price; 98.9% had the buyer's mailing address. The dashboard showed 571 credits for 36
calls, so count and `ids_only` calls are free. Each record also carries `saleHistory`, every past deed for the
property with buyers and sellers.

The ID list for each county and window is saved (`ids.json` in the cache), so a resumed scan fetches the same
1,000-ID chunks, and every response is cached, so a re-run costs nothing. `billableRecords` in a run's
`stats.json` counts the records fetched (1 credit each).

Bulk record shape, handled in `normalizeRealEstateApiDetail` and `RealEstateApiBulkSource`:
- `propertyInfo.address.street` is only the street name ("Chipmunk"); the code reads `.address` ("2135 Chipmunk Ct").
- Records come back in a different order from the IDs sent; the code joins them on `id`.
- There is no `credits` field in the response; the code counts records.
- `lastSale.saleDate` has a time part; dates are cut to YYYY-MM-DD.

Coverage gaps found: Allegheny PA, St. Louis County MO, Monroe NY, York PA and Chesterfield VA had no September
2026 recordings; Sheboygan WI and Le Sueur MN have no sales data at all.

## What is left to build

1. Alert ledger (`prospect ID + role + property ID + document number`) so a client never gets a sale twice.
2. Monthly credit meter with a hard stop below the plan's 400,000 credits (each run already reports
   `billableRecords`).
3. Remove the legacy BatchData and ATTOM code paths (RealEstateAPI is already the default).
4. Retries, scheduling, a database for matches and ledger, secrets management, county coverage monitoring.
5. Use each record's `saleHistory` and `mortgageHistory` for an address-first check: a sale at a prospect's CRM
   address where the prospect's surname is on an earlier deed or mortgage (spouse-only deeds, name changes).

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
