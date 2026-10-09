# Personal Finance

A personal finance dashboard built with FastAPI, PostgreSQL, React, Tailwind CSS, and the Pluggy Connect widget.

## Features

- One password-protected personal dashboard, using `APP_PASSWORD` from the environment.
- Link and update bank connections through Pluggy Connect. Pluggy application secrets stay on the server.
- Import existing Pluggy Items without creating a second connection when the API's item-list endpoint is enabled; a known Item ID can also be imported directly.
- Net balance across accounts, treating credit-card balances as liabilities. Accounts in additional currencies are shown separately.
- Expense bars by category, with 30-day, 90-day, and 12-month ranges.
- Monthly income/spending and expense charts exclude Pluggy's same-person transfers and credit-card bill payments to avoid counting money moving between owned accounts as new income or spending.
- Account balances, available card limits, current invoices, and recent bills.
- Searchable transaction list, category filtering, and private category overrides.
- Raw Pluggy financial API response pages stored as JSONB snapshots in PostgreSQL.

## Start locally with Docker Compose

1. Copy `.env.example` to `.env` in this folder.
2. Set a strong `APP_PASSWORD` and a separate random `SESSION_SECRET`. Add `PLUGGY_CLIENT_ID` and `PLUGGY_CLIENT_SECRET` from the Pluggy dashboard to enable account connections.
3. Start the app from this folder:

   ```sh
   docker compose up --build -d
   ```

4. Open [http://localhost:8080](http://localhost:8080) (or the port set by `APP_PORT`) and sign in with `APP_PASSWORD`.

To stop the services while retaining the database, run `docker compose down`. To also erase the PostgreSQL volume and all saved data, run `docker compose down -v`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `APP_PASSWORD` | Password required to open the app. |
| `SESSION_SECRET` | Signs the HttpOnly session cookie; use a long random value and keep it private. |
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` | Pluggy credentials used only by the FastAPI server. Without them, the dashboard and login run, but linking and syncing are unavailable. |
| `PLUGGY_INCLUDE_SANDBOX` | Set to `true` to show Pluggy Sandbox institutions in the Connect widget while developing. Defaults to `false`. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Local Compose PostgreSQL credentials. |
| `COOKIE_SECURE` | Set to `true` when the app is served over HTTPS. Keep `false` for local HTTP. |
| `APP_BIND` | Host interface for the web port. Defaults to `127.0.0.1` so the app is reachable only from this computer. |
| `APP_PORT` | Host port for the web app; defaults to `8080`. |

## Data storage model

The `api_digest` table stores the complete JSON response body for each financial resource page in its `raw_json` JSONB column. It keeps only bookkeeping columns alongside the payload: the associated item ID, resource type, request/page key, and fetch time. Each successful sync replaces that item's prior snapshots atomically, so the table is a current digest rather than a normalized copy of bank data.

The `category_overrides` table contains only app-owned transaction category edits. These edits are applied when building the dashboard and do not alter the original Pluggy JSON snapshot or call Pluggy's transaction update endpoint. Authentication/API credentials and short-lived API or Connect Tokens are not persisted.

Pluggy's transaction API currently makes up to 12 months of transactions available. The app uses `/v2/transactions` cursor pagination, account-list page pagination, and the credit card bills endpoint. Item data is synced only after Pluggy reports `UPDATED` with `SUCCESS` or `PARTIAL_SUCCESS`; while a connection is still running or awaiting user input, its status is retained and the last complete snapshot stays available.

Existing connections can be imported with **Import existing**. This uses Pluggy's cursor-paginated `GET /v2/items` endpoint and stores each raw response page in `api_digest` before syncing the returned Item IDs. Pluggy enables this endpoint by agreement; if it is unavailable for the API credentials, use **Import by ID** with an existing Item ID, or ask Pluggy to enable item listing. Neither path requires creating another bank connection.

## Security notes

- Keep `.env` private. Do not commit it or expose `PLUGGY_CLIENT_SECRET` in the browser.
- The session cookie is HttpOnly, SameSite Strict, and signed with `SESSION_SECRET`. Changing `APP_PASSWORD` invalidates existing sessions after the app restarts.
- The database is only exposed to the internal Compose network. Keep the host port private if you add one.
- For remote access, put the web service behind HTTPS and set `COOKIE_SECURE=true`.
- Anyone with access to the database volume can read the raw bank data stored there; protect the machine and its backups accordingly.

## Pluggy references

- [List existing Items](https://docs.pluggy.ai/en/reference/items/items-list-by-cursor)
- [Item listing access and cursor pagination](https://v2.docs.pluggy.ai/en/docs/connections/item)
- [Quick start and server-side authentication](https://docs.pluggy.ai/en/docs/quickstart)
- [Connect Widget authentication](https://docs.pluggy.ai/en/docs/connect-widget/authentication)
- [Item lifecycle](https://v2.docs.pluggy.ai/en/docs/connections/item-lifecycle)
- [Accounts and credit limits](https://v2.docs.pluggy.ai/en/docs/products/accounts)
- [Cursor-paginated transactions](https://v2.docs.pluggy.ai/en/reference/transaction/transactions-list-by-cursor)
- [Credit card bill list](https://v2.docs.pluggy.ai/en/reference/bill/bills-list)

To generate a session signing secret locally, run `python -c "import secrets; print(secrets.token_urlsafe(48))"` and paste the result into `.env`. Choose your own `APP_PASSWORD`; do not send it in chat or commit `.env`.
