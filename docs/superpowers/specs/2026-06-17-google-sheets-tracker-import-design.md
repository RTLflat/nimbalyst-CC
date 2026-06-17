# Google Sheets → Tracker Import (Apps Script form)

**Date:** 2026-06-17 (revised — Apps Script architecture, no service account)
**Status:** Design approved; plan being executed

## Summary

Let teammates and outsiders submit tracker items (bug / task / idea / decision /
plan / feature) through a **custom web form** served by a **Google Apps Script**
bound to a Google Sheet. Submissions land as rows in the Sheet. From Nimbalyst, an
**Import** action pulls new rows (via the same Apps Script's JSON endpoint), creates
tracker items, and tags each with a per-type key (`BUG-001`).

No Google Cloud service account, no API key, no Cloudflare Worker, no Cloud project.
The Apps Script runs under the sheet owner's own Google login, so it can read the
sheet and append form submissions without any external credential.

## Goals

- A shareable web form anyone can use to add tracker entries — no Nimbalyst install
  required, no Google login required for submitters.
- One-click **Import** in Nimbalyst that turns new sheet rows into tracker items.
- Idempotent import: a row is never imported twice (local dedup via a stable
  per-row id).
- Imported `bug`/`task` items sync to the team via existing tracker sync.
- Zero Google Cloud setup: the only Google-side action is pasting a script into the
  sheet's Apps Script editor and clicking Deploy once.

## Non-goals (v1)

- Writing anything back into the sheet (no `Key`/`ImportedAt` columns). The
  `BUG-001` key is tagged on the tracker only.
- Continuous/auto-polling sync (import is a manual pull).
- Capturing type-specific custom fields — only `Type`, `Title`, `Command/Feature`,
  `Description`.
- Team-shared connected-form config (each machine connects its own; revisit later).
- Strong bot protection on the public form (a honeypot field only; revisit if abused).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | **Google Apps Script web app** bound to the sheet | No service account, no Worker, no Cloud project; runs under the owner's auth so it can read + append. |
| Sheet access | Apps Script `doGet`/`doPost` (one deployed `/exec` URL) | Single integration point: serves the form AND a JSON rows endpoint. |
| Write-back | **None** (per user: tracker tag is enough) | Removing write-back removes the only reason we'd need write auth from Nimbalyst. |
| Dedup | Deterministic tracker ID from `{sourceId, RowId}` | `RowId` is assigned by the script at submit; deterministic ID makes re-import a no-op. No sheet write needed. |
| Form | Custom HTML served by the Apps Script | Keeps the custom form the user wanted, without a service account. |
| Import action placement | Toolbar Import dropdown **and** sidebar header | Matches existing Import dropdown; also the spot circled in the tracker sidebar header. |
| Config scope | Per-workspace local (v1) | Simplest; stored in `workspace-settings`. |
| Fields captured | `Type`, `Title`, `Command/Feature`, `Description` | `Command/Feature` is a "where to start looking" hint, prepended to the description on import. |
| Tracker types | One mixed sheet, `Type` column drives type + key prefix | Supports any creatable tracker type. |

## End-to-end data flow

```
                          +-------------------------------------+
   Teammate / outsider    |  Apps Script web app (doGet form)   |
   opens /exec link ----->|  Type v  Title  Command/Feature     |
                          |  Description              [Submit]   |
                          +----------------+--------------------+
                                           | POST /exec (doPost)
                                           v
   +------------------------------------------------------------------+
   |  Google Apps Script (runs as the sheet owner)                    |
   |   - doPost: validate, assign RowId (UUID), append row to Sheet   |
   |   - doGet ?api=rows[&token=...]: return all rows as JSON         |
   +----------------+----------------------------------^--------------+
                    | SpreadsheetApp (read/append)     | plain GET (no auth /
                    v                                   | optional shared token)
             +-------------+                  +---------+----------------+
             | Google Sheet|                  |  Nimbalyst (Electron)    |
             | (bound to   |                  |  Tracker panel:          |
             |  the script)|                  |  [Import from Sheet]      |
             +-------------+                  |   -> handleTrackerCreate  |
                                              |   -> deterministic id     |
                                              |   -> tag BUG-001          |
                                              |   -> trackers sync (team) |
                                              +--------------------------+
```

## The Sheet contract (columns)

The Apps Script owns the column layout; it writes the header on first submit.

| Column | Who writes | Purpose |
|---|---|---|
| `Timestamp` | script (on submit) | Submission time, audit only. |
| `RowId` | script (UUID on submit) | Stable per-row identity → deterministic tracker ID (re-import = no-op). |
| `Type` | submitter | Dropdown value; decides the key prefix (`bug`→`BUG-`, …). |
| `Title` | submitter | Tracker title (required). |
| `CommandFeature` | submitter | Affected ribbon command, or feature/function (e.g. an updater) when not tied to one command. Prepended to the description on import. Optional. |
| `Description` | submitter | Tracker body (markdown, optional). |

## Components

### 1. Google Apps Script (repo artifact, user-deployed)

Lives in the repo at `tools/google-apps-script/` (`Code.gs` + `form.html`) as a
copy-paste artifact with a short deploy README. Deployed by the user via Extensions →
Apps Script → Deploy → New deployment → Web app ("Execute as: Me", "Who has access:
Anyone"). Yields a stable `…/exec` URL.

- `doGet(e)`:
  - `?api=rows` (optionally `&token=<accessToken>`) → `ContentService` JSON
    `{ rows: [{ rowId, type, title, commandFeature, description }] }` read from the
    sheet. If an `ACCESS_TOKEN` script property is set, a matching `token` is
    required; otherwise open.
  - otherwise → serves the HTML form (`form.html`), with the allowed types injected.
- `doPost(e)`:
  - Parses the form body, rejects on empty `title` or a `type` outside the creatable
    set or a filled honeypot field, assigns `RowId = Utilities.getUuid()`, appends
    `[Timestamp, RowId, Type, Title, CommandFeature, Description]`, ensuring the
    header row exists first.

The form is a single self-contained HTML page: `Type` dropdown (creatable types),
`Title` (required), `Command/Feature` (optional, with guiding placeholder),
`Description` (optional, multiline), a hidden honeypot input, Submit → success/error
message.

### 2. Nimbalyst import flow

**Trigger**: an "Import from Google Sheet…" action added to the existing Import
dropdown in the tracker toolbar (`TrackerMainView.tsx:906`), **and** surfaced in the
tracker sidebar header (`TrackerSidebar.tsx`). Both call the same hook.

**Client** (`AppsScriptSheetClient`): a plain `GET {webAppUrl}?api=rows[&token=...]`
from the Electron main process (no CORS, no JWT). Returns the JSON rows.

**Service** (`TrackerSheetImportService`):
1. Read the connected config (`WorkspaceState.googleSheetIntegration = { webAppUrl,
   accessToken? }`); fetch rows.
2. Per row: validate `Type` is a creatable tracker type and `Title` is non-empty;
   otherwise collect a per-row skip/error.
3. Compose the body: if `CommandFeature` is non-empty, prepend
   `**Affected command / feature:** <value>`, a blank line, then `Description`.
4. `handleTrackerCreate({ id: deterministic(webAppUrl, rowId), type, title,
   description: composedBody, origin: { kind: 'external', external: { source:
   'google-sheets', webAppUrl, rowId } } })`. The deterministic ID makes a re-create
   a safe no-op (local dedup; no write-back needed).
5. Report `{ created, skipped, errors }` to the renderer; refresh the tracker list.

**Sync**: `bug`/`task` are `shared` types, so created items auto-sync to the team.

### 3. Per-type key allocation (`BUG-001`)

Today keys are a single workspace-global `NIM-{n}`
(`packages/electron/src/main/mcp/tools/trackerToolHandlers.ts:1695`). Extend to
**per-type sequences**: prefix from a `type → prefix` map (`bug→BUG`, `task→TASK`,
`idea→IDEA`, `decision→DEC`, `plan→PLAN`, `feature→FEAT`), number = `max(existing
suffix for that type) + 1`, formatted `padStart(3, '0')`. Applied to **all** tracker
creation so keys are consistent app-wide.

### 4. Setup / config UX

A "Connect Google Sheet" dialog (tracker settings):
1. Short instructions: deploy the provided Apps Script to your sheet, copy the
   `/exec` web app URL.
2. Takes the **web app URL** (and optional access token).
3. Optionally does a test fetch (`?api=rows`) to confirm it responds.
4. Shows that the same URL is the **form link** to share with contributors.

Stored per-workspace: `WorkspaceState.googleSheetIntegration = { webAppUrl,
accessToken? }` (electron-store `workspace-settings`, via `SettingsHandlers`).

## Error handling

- Web app URL unreachable / non-JSON → import aborts with an actionable message
  ("check the deployed Apps Script URL").
- `?api=rows` returns 401/"unauthorized" → prompt to re-enter the access token.
- Unknown `Type` or empty `Title` → per-row skip, surfaced in the import summary.
- Honeypot filled on the form → submission silently rejected by the script.

## Testing strategy

- **Unit**: per-type key allocation (prefix map, zero-padding, collision);
  deterministic-ID dedup (re-create is a no-op); body composition (Command/Feature
  prepend); row validation (bad type / empty title skipped).
- **E2E**: import against a local stub serving the Apps Script JSON shape; assert
  trackers created with composed body + per-type keys, and that a second import is a
  no-op. Primary red→green deliverable per the repo's end-to-end-verification rule.
- **Apps Script**: not unit-tested in-repo (runs in GAS); verified by a documented
  deploy + smoke test (submit a row, confirm it appears; hit `?api=rows`, confirm
  JSON).

## Architecture diagram

Per the repo convention for architectural changes, an Excalidraw diagram capturing
the flow above will be produced in `nimbalyst-local/architecture/` during
implementation.

## Key code touch-points (reference)

- Tracker creation: `packages/electron/src/main/mcp/tools/trackerToolHandlers.ts`
  (`handleTrackerCreate`, key allocation ~1695).
- Tracker toolbar + existing Import dropdown:
  `packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx:906`.
- Tracker sidebar header:
  `packages/electron/src/renderer/components/TrackerMode/TrackerSidebar.tsx`.
- Workspace settings: `packages/electron/src/main/utils/store.ts` (`WorkspaceState`),
  IPC in `SettingsHandlers.ts` (`safeHandle`/`safeOn` from `../utils/ipcRegistry`).

## Open questions for implementation planning

- Exact `type → prefix` map and whether prefixes should be workspace-configurable.
- Whether the form should pull the live workspace creatable-type list (v1 ships a
  fixed set in the script).
- Whether to add stronger bot protection than the honeypot if the form is abused.
