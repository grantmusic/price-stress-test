# PRICE Stress Test

A stress testing tool for the PRICE API (Mortgage Director). Launches a browser in app mode with a live dashboard for configuring and running tests, with real-time metrics streamed back as sessions execute.

## How It Works

Each test spawns PRICE sessions at a configurable rate. Each session logs in, runs a sequence of transactions against a randomly selected loan within the configured range, and optionally logs out. The primary goal is to observe how the PRICE service manages database connections under concurrent load — particularly whether connections are released back to the pool properly when sessions end versus when they are left open for garbage collection.

## Prerequisites

- Node.js 18+
- Google Chrome or Microsoft Edge
- A PRICE API environment (DEV/QA recommended)

## Setup

**1. Install dependencies**
```bash
npm install
```

**2. Configure environment**

Copy `.env.example` to `.env` and fill in your PRICE API credentials:
```bash
cp .env.example .env
```

```env
PORT=3737

PRICE_BASE_URL=https://price.dev.pclender.com
PRICE_DATABASE=your_database
PRICE_API_VERSION=your_version
PRICE_APP_ID=your_app_id
PRICE_APP_PASSWORD=your_app_password
PRICE_HARDCODED_VALUE=your_hardcoded_value
PRICE_LOGIN_NAME=your_login_name
PRICE_PASSWORD=your_password
```

**3. Add user credentials** *(optional — enables concurrent user simulation)*

Create a `credentials.txt` file in the project root with one `username:password` pair per line:

```
# Lines starting with # and blank lines are ignored
username1:password1
username2:password2
username3:password3
```

Each session picks a random user from this list when logging in, simulating multiple distinct users hitting the API simultaneously. If the file is absent or empty, all sessions fall back to `PRICE_LOGIN_NAME` / `PRICE_PASSWORD` from `.env`. The file is gitignored so credentials are never committed.

**4. Add sample files** *(only needed if using those transaction types)*

- Drop image files (JPG, PNG, TIFF, PDF) into `sample-images/` for `upload_image_file`
- Drop URLA MISMO 3.4 XML files into `sample-xmls/` for `import_from_file`

**5. Start**
```bash
npm start
```

This starts the server and opens the dashboard automatically in a Chrome or Edge app window. If a browser isn't found at the standard install paths, set `CHROME_PATH` in your `.env` to point to the executable directly.

## Dashboard

### Credentials

Shows how many users are loaded from `credentials.txt` and whether the tool is falling back to `.env`. Use the **Reload** button to pick up changes to the file without restarting the server — useful for adding or removing users mid-session.

### Test Parameters

| Setting | Description |
|---|---|
| Sessions per minute | Rate at which new PRICE sessions are created |
| Duration | How long to run in seconds; set to 0 for manual stop |
| Transactions per session | Number of API calls each session makes |
| Delay between calls | Milliseconds to wait between calls within a session |
| Max concurrent sessions | Cap on simultaneous open sessions; 0 = unlimited |
| Request timeout | Per-request timeout in milliseconds |
| End sessions after transactions | When unchecked, sessions are left open after completing their calls — useful for observing whether idle connections are garbage collected by the server |

### Loan Range

Transactions are executed against a randomly selected loan number within the configured min/max range. Use a dedicated block of test loans in your development environment.

### Transactions

Each session picks randomly from the enabled transactions for each call.

**GET**

| Transaction | Description |
|---|---|
| `get_loan` | Fetch core loan data |
| `get_dates` | Fetch loan dates |
| `get_deposit_accounts` | Fetch deposit accounts |
| `get_loan_fees` | Fetch loan fees |
| `get_incomes` | Fetch income records |
| `get_liabilities` | Fetch liability records |
| `get_customers` | Fetch borrower/customer records |
| `get_properties` | Fetch property records |

**SET**

| Transaction | Description | Config |
|---|---|---|
| `add_or_update_date` | Write today's date to one or more date fields | Comma-separated date names (e.g. `LockDate,RateLockExpDate`) |
| `put_virtual_data` | Write a test string to one or more virtual data fields | Comma-separated virtual data names |
| `set_extra_data` | Write a test string to one or more extra data fields | Comma-separated field names |
| `set_loan_fees` | Update the `Total` on LoanFeeID 1 with a random amount | — |
| `set_loan_data` | Write a timestamped string to the loan `Notes` field | — |
| `set_loan_servicing_data` | Write a timestamped string to `LoanServicing_Notes` | — |
| `add_conversation_log` | Add a private conversation log entry (ConversationType 40) | — |
| `set_adjustment` | Set `Gross_Revenue` to a random decimal | — |
| `upload_image_file` | Upload a randomly selected file from `sample-images/` to the unassigned bucket | Requires files in `sample-images/` |
| `import_from_file` | Import a randomly selected URLA MISMO 3.4 XML from `sample-xmls/` — creates a new loan record each call | Requires files in `sample-xmls/` |

### Metrics

All metrics update live every second.

| Metric | Description |
|---|---|
| Active Sessions | Sessions currently logged in and executing |
| Sessions Created | Total sessions spawned since the test started |
| Completed Requests | Total successful API calls |
| Failed Requests | Total API calls that returned an error |
| Error Rate | Failed / total requests as a percentage |
| Throughput | Requests completed per second (10-second rolling window) |
| Avg Response | Average response time in milliseconds (10-second rolling window) |
| Elapsed | Time since the test started |

## Notes

- Run this tool against a **development or UAT environment only**. SET transactions write real data to loan files.
- `import_from_file` creates a new loan record on every invocation.
- Sessions left open (End sessions unchecked) will accumulate as active until the PRICE server garbage collects them — this is intentional for connection pool testing.
