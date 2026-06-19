# Google Sheets → Importer-Registry Unification (design + spike)

**Date:** 2026-06-18
**Status:** Design approved for spike; prototype landed behind a flag (`NIMBALYST_GSHEET_REGISTRY_IMPORTER=1`)
**Plan:** `plans/014-unify-google-sheets-into-importer-registry.md`
**Supersedes (direction only):** the bespoke path described in `2026-06-17-google-sheets-tracker-import-design.md` — that path stays the **default** until a follow-up plan flips the flag and removes it.

## Summary

Nimbalyst has a mature, extension-based **importer registry** — importers declare
themselves, discovery is consent/allowlist-gated, and `TrackerImportService.runImport`
turns a snapshot into a tracker item with per-URN locking, sync-convergence race
recovery, workspace-scoped URN dedup, and conservative re-snapshot merge. The
**GitHub Issues** importer uses it end-to-end. **Google Sheets import bypasses all of
it** (`TrackerSheetImportService` → `handleTrackerCreate`, with its own client,
global-id dedup, connect dialog, and IPC), so it lacks URN locking, race recovery,
workspace-scoped dedup, and re-snapshot.

This doc resolves the four open questions and a prototype proves one sheet row imports
through `TrackerImportService.runImport`. It does **not** migrate data or remove the
legacy path.

## The crux: GitHub vs Google Sheets auth are not the same shape

The GitHub importer works as a **utility-process backend module** because its secret
is *not Nimbalyst's*: it shells out to the user's `gh` CLI, whose auth lives in the
CLI's own ambient environment. The backend reads/stores **no token**.

Google Sheets is the opposite: its secret (the Apps Script access token) lives in
**Nimbalyst's own encrypted store** — `WorkspaceState.googleSheetIntegration`, with the
token encrypted at rest via Electron `safeStorage` (plan 010, `sheetTokenCrypto.ts`),
decrypted main-side by `decryptSheetToken(cfg)`. A utility-process backend module
**cannot** read electron-store and **cannot** call `safeStorage` (both are main-process
only). This single difference drives Q1 and Q2.

## Field mapping

`SheetRow` (`AppsScriptSheetClient.fetchRows`) `= { rowId, type, title, commandFeature, description }`.

### `SheetRow` → `ImporterListEntry` (the `list` RPC)

| `ImporterListEntry` | Source | Transform |
|---|---|---|
| `externalId` | `row.rowId` | direct |
| `urn` | `row.rowId` | `google-sheets://<rowId>` |
| `url` | connected `webAppUrl` | the sheet's deployed `/exec` URL (no per-row URL exists) |
| `title` | `row.title` | direct |
| `state` | — | constant `'open'` (sheet rows carry no upstream state) |
| `updatedAt` | — | synthetic (epoch placeholder); the current sheet contract has no per-row mtime |

### `SheetRow` → `TrackerSnapshot` (the `fetch` RPC)

| `TrackerSnapshot` | Source | Transform |
|---|---|---|
| `external.providerId` | — | constant `'google-sheets'` |
| `external.externalId` | `row.rowId` | direct |
| `external.urn` | `row.rowId` | `google-sheets://<rowId>` (**identical** to the legacy origin URN) |
| `external.url` | connected `webAppUrl` | direct |
| `external.titleSnapshot` | `row.title` | direct |
| `external.stateSnapshot` | — | omitted (no upstream state) |
| `primaryType` | `row.type` | direct — drives the created tracker type + per-type key prefix |
| `title` | `row.title` | direct |
| `body` | `row.commandFeature` + `row.description` | `composeSheetBody`: prepend `**Affected command / feature:** <cf>` + blank line when `commandFeature` is set |
| `status` / `priority` / `labels` / `authorIdentity` / `upstreamCreatedAt` / `upstreamUpdatedAt` | — | omitted (matches legacy create, which sets none) |

The mapping is intentionally byte-identical to the legacy `googleSheetsOrigin` +
`composeBody` on the fields that matter for dedup and display, so legacy and registry
imports of the same row are interchangeable at the URN level (see Q3).

## Open questions — decisions

### Q1 — Built-in importer vs bundled extension → **Built-in (in-core) importer**

A bundled extension carries a **utility-process backend module**, which cannot reach
the encrypted token (see "The crux"). A **built-in importer that runs host-side** can,
because `getWorkspaceState` + `decryptSheetToken` (`safeStorage`) are available in the
main process. It also avoids an extension enable/consent prompt for a capability that
already ships in core today.

The cost is a small new **"built-in importer" registration path** in the registry,
since `trackerImporterDiscovery` only scans extension manifests. The spike adds a
**flag-gated, minimal** version of that path (`builtInImporters.ts` + guards in
`TrackerImporterRegistry`); a production version would add discovery/UI integration.

> Tradeoff: bundled-extension keeps discovery uniform but **cannot** carry the token;
> built-in gives token access + no consent prompt at the cost of a parallel
> registration path. Token access is decisive.

### Q2 — Token across the backend-module boundary → **Keep the fetch host-side; the token never crosses the boundary**

Because the importer is built-in (Q1), `fetch`/`list` run in the main process and call
`fetchRows(cfg.webAppUrl, decryptSheetToken(cfg))` exactly as the legacy path does. **No
token crosses the RPC boundary, and the SDK contract / permission model are unchanged.**

The two boundary-crossing alternatives were rejected:

- **Host-injected binding config** — `fetch({ externalId })` carries no binding, and
  `ImporterBinding` is `{ id, label }` with no secret field. There is no channel to
  hand a token to `fetch` without changing the contract.
- **A backend→host "get secret" RPC** — would be a new SDK/permission surface, and a
  vetted-native-code module that can pull arbitrary secrets from the host store
  undermines the backend-module allowlist trust boundary.

> **STOP-condition check (Q2):** the plan says STOP if Q2 has no clean answer without
> changing the SDK contract or permission model. The built-in path **resolves Q2
> without either change**, so this STOP condition does **not** fire. The prototype
> proceeds.

### Q3 — Id / URN migration → **Dedup by URN via `findLocalIdByUrn`; leave legacy `gsheet-<hash>` ids untouched; no migration**

Both paths emit the **identical** URN `google-sheets://<rowId>`, and
`findLocalIdByUrn` probes the existing `data->'origin'->'external'->>'urn'` expression
index — which already covers legacy `gsheet-*` rows. So a row imported by the legacy
path is found by the registry path's URN dedup and returns `{ created: false }`; no
duplicate, no id rewrite.

New registry imports get `importedItemId(urn)` = `import_<sha1(urn)[:24]>` ids; legacy
rows keep their `gsheet-<sha256(...)[:32]>` ids. That divergence is fine for **dedup**
(which is URN-based) but matters for **cross-client convergence**, which relies on the
deterministic local id colliding under `ON CONFLICT (id)` in `applyRemoteItem`.

> **Migration caveat (documented, not blocking):** while *both* paths are active, do
> not import the same sheet via *different* paths on *different* machines before they
> sync — a legacy `gsheet-*` row and a registry `import_*` row for the same URN will
> **not** id-collide and could duplicate until convergence. This is safe in the spike
> because the legacy path stays default and the registry path is flag-gated; the
> follow-up plan removes the legacy path and eliminates the window.

### Q4 — Connect UI + multiselect → **Reuse `ImportFromSourceDialog`; keep `ConnectGoogleSheetDialog` as the auth/binding settings panel**

`ImportFromSourceDialog` is already provider-agnostic (it takes `providerId` /
`importsAs` and drives `tracker:importer:*` IPC). It maps cleanly: **binding = the
connected sheet** (one entry from `listBindings`), **items = rows** (`list`), with
multiselect import — replacing the bespoke one-shot "Import from Sheet" action.

`ConnectGoogleSheetDialog` stays, repurposed as the importer's **`settingsPanelId`**
surface for web-app URL + optional token entry. GitHub needs no such panel (zero-config
via git remotes + `gh`); Google Sheets needs explicit per-workspace config, so the
connect dialog is the natural auth/binding panel rather than dead code.

UI is **out of scope for this spike** (the flag-gated path has no UI). This records the
intended end-state.

## Re-snapshot / merge semantics for sheet rows (note)

A GitHub issue is a living upstream record; a sheet is **append-only intake**. A row is
submitted once and is not meant to be re-pulled and merged. `resnapshot` works
*mechanically* (the URN resolves; `fetch` re-pulls the row's current title/body), but
its conservative title/status/labels/body-change machinery has little to act on for
sheets (no upstream `status`, labels, or author). Recommendation: treat Google Sheets
as a **one-shot import** (no periodic re-snapshot). This is a semantic note, not a
blocking mismatch — the prototype still imports correctly.

## Prototype (this spike)

Additive, flag-gated by `NIMBALYST_GSHEET_REGISTRY_IMPORTER=1`. Flag off ⇒ zero
behavior change; the legacy path remains the only active sheet importer.

- `googleSheetsImporterMapping.ts` — dependency-free pure mapping (`buildSheetUrn`,
  `composeSheetBody`, `sheetRowToListEntry`, `sheetRowToSnapshot`) + the
  `GOOGLE_SHEETS_CONTRIBUTION` constant. Kept electron-free so it unit-tests and
  type-checks in isolation (same rationale as `importedItemId.ts`).
- `googleSheetsImporter.ts` — the built-in `ImporterMethods` (`isAuthenticated`,
  `listBindings`, `list`, `fetch`) wiring the pure mapping to `fetchRows` +
  `decryptSheetToken(getWorkspaceState(ws).googleSheetIntegration)`. `fetch` re-pulls
  all rows and selects by `rowId` (the Apps Script contract has no per-row endpoint —
  a documented spike inefficiency; production could cache the `list` page).
- `builtInImporters.ts` — flag-gated lookup (`getBuiltInImporter` /
  `getBuiltInImporterByUrnScheme` / `listBuiltInImporters`); returns `null`/`[]` when
  the flag is off.
- `TrackerImporterRegistry.ts` — minimal additive guards at the top of
  `listImporters` / `getContribution` / `isAuthenticated` / `listBindings` /
  `listItems` / `fetchSnapshot` that consult the built-in table first. No change to
  `findLocalIdByUrn`, the RPC dispatch, or the extension path.

Tests: `googleSheetsImporterMapping.test.ts` (the `list`/`fetch` mapping, modeled on
`github-issues-importer/src/__tests__/backend.test.ts`) and
`googleSheetsImporterSpike.test.ts` (one row through `runImport` → `created: true`,
re-run → `created: false`, and a legacy-`gsheet-*`-row-by-URN dedup case — modeled on
`TrackerImportService.test.ts`).

## Out of scope / follow-up

- **Do not** remove `TrackerSheetImportService` / `AppsScriptSheetClient`'s create loop
  / `tracker:sheet-*` IPC / `ConnectGoogleSheetDialog`. A separate follow-up plan
  ("flip the default to the registry path and remove the legacy sheet path") does that
  once parity is proven; it should also re-evaluate whether the plan 001/005/006/010
  interim fixes on the legacy path are still needed or superseded.
- No data migration of existing `gsheet-<hash>` rows (Q3).
- No SDK-contract change (Q2).
- Plan 006 deferred cross-workspace sheet dedup to this plan: the registry's
  **workspace-scoped** `findLocalIdByUrn` (it filters `WHERE workspace = $1`) is the
  resolution — dedup is per-workspace by construction, so the same sheet imported into
  two workspaces yields one item per workspace rather than colliding across them.
```
