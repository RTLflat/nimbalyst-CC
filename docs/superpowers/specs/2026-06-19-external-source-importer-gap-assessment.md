# External-Source Importer — Gap Assessment (spike)

**Date:** 2026-06-19
**Status:** Spike / assessment only — no production code changed.
**Companion:** `2026-06-18-google-sheets-importer-unification-design.md` (read that first; this
continues the same design thread, zooming out from "unify Sheets" to "how close is the whole
importer system to first-class multi-source").
**Plan:** `plans/006-spike-external-source-importer.md`
**TL;DR:** The importer abstraction is **not greenfield — it largely exists and is sound.** The
work to "first-class multi-source" is *convergence and surfacing*, not a new abstraction. The
single highest-value next increment is to **retire the legacy Google Sheets bypass** so there
are two importer shapes (not three), then give the built-in registration path the discovery/UI
the extension path already has. **Do not** start a Linear importer or write-back before that.

---

## 1. What exists today (factual map)

A mature, two-channel **importer registry** already turns external records into native tracker
items. Evidence (`file:line`):

**The contract (published SDK type).** `packages/extension-sdk/src/types/trackerImporter.ts`
defines `ImporterMethods` = `isAuthenticated` / `listBindings` / `list` / `fetch` (+ optional
`openExternal`), plus the manifest `TrackerImporterContribution`, `TrackerSnapshot`,
`ImporterBinding`, etc. It is **read-side and one-shot by design** (doc comment lines 8-11:
"Write/sync/comment methods can be added later as optional methods without breaking importers").
It **is** part of the SDK public surface — re-exported transitively
`src/index.ts` → `export * from './types/index.js'` → `trackerImporter.js:12` — and ships in
`@nimbalyst/extension-sdk` **v0.2.0** (`dist/types/trackerImporter.d.ts`). Pre-1.0, so no
stability commitment to third-party authors yet.

**The registry.** `TrackerImporterRegistry.ts` (singleton via `getTrackerImporterRegistry()`,
:203) is the single entry point for `listImporters` / `getContribution` / `isAuthenticated` /
`listBindings` / `listItems` / `fetchSnapshot`. **All six methods consult the built-in table
first**, then fall back to the extension path (built-in guards at :105, :113, :119, :126, :142,
:156).

**Two registration channels:**
- **Extension manifests** — `trackerImporterDiscovery.ts:49` scans every enabled extension's
  `manifest.json` for `contributions.trackerImporters`, allowlist-gates the backend module, 5 s
  TTL cache. **Built-ins are invisible to discovery** (manifest-scan only).
- **Built-in host-side table** — `builtInImporters.ts`, gated by env flag
  `NIMBALYST_GSHEET_REGISTRY_IMPORTER` (:28). Off (default) ⇒ `listBuiltInImporters()` returns
  `[]`, `getBuiltInImporter()` returns `null`. Registry currently holds one entry: Google Sheets.

**Origin URN + dedup.** Every imported item carries `data->'origin'->'external'->>'urn'`
(migration `0010_tracker_origin_urn`, expression-indexed). `findLocalIdByUrn` is
**workspace-scoped** (`WHERE workspace = $1`, :185). Deterministic local id
`import_<sha1(urn)[:24]>` (`importedItemId.ts:19`). `trackerOrigin.ts` parses legacy
`scheme:id` → `scheme://id` and synthesizes origin from deprecated `source`/`sourceRef`.

**Import orchestration.** `TrackerImportService.runImport` (:84) does the load-bearing work the
contract deliberately keeps host-side: per-URN advisory lock (`withUrnLock`, Map<urn,Promise>,
:64-82), URN dedup → `{ created: false }` if the row already exists (legacy or registry id alike),
**sync-convergence race recovery** (re-probe `findLocalIdByUrn` after a create error, :148-154),
and conservative `resnapshot` merge (title/status overwrite-only-if-locally-unchanged, labels
union, **body never auto-overwritten** — flagged for review, :193-256).

**The two (really three) importer shapes:**

| Source | Shape | Auth | Goes through registry/`runImport`? |
|---|---|---|---|
| GitHub Issues | **Extension** + utility-process backend module (`github-issues-importer/src/backend.ts`) | Ambient — shells out to `gh` CLI, **stores no token** | **Yes**, end-to-end |
| Google Sheets (registry) | **Built-in host-side** (`googleSheetsImporter.ts`), flag-gated | Token in Nimbalyst's encrypted store (`safeStorage`, main-only) | **Yes**, when flag on |
| Google Sheets (legacy) | **Bespoke bypass** (`TrackerSheetImportService.ts`) — **the current default** | Same token | **No** — calls `handleTrackerCreate` directly; global-scoped `gsheet-*` ids; no URN lock, no race recovery, no workspace dedup |

The GitHub-vs-Sheets asymmetry is **intentional and load-bearing, not accidental debt**: a
utility-process backend module cannot reach `safeStorage`/`electron-store` (main-process only),
so a host-secret source *must* be built-in; an ambient-auth source (`gh`) *can* be an extension.
The unification design doc resolves this (Q1/Q2). The **third** path (legacy Sheets bypass) is
transitional debt the design doc explicitly defers removing.

---

## 2. Gap to "first-class multi-source" (evidence-tied)

1. **Three code paths, one of which bypasses the contract.** Extension-via-RPC and
   built-in-host-side both implement `ImporterMethods`; the legacy `TrackerSheetImportService`
   bypasses the registry entirely and is still the **default**. So the SDK type is *not yet* the
   single contract in practice — the legacy path is the gap. (`TrackerSheetImportService.ts:81-90`
   vs `TrackerImportService.runImport:84`.)

2. **Id divergence during the migration window.** Legacy rows get `gsheet-<sha256>[:32]` ids;
   registry rows get `import_<sha1(urn)[:24]>`. Dedup is URN-based so they coexist, but the two
   ids **don't collide under `ON CONFLICT (id)`**, so the same sheet imported via different paths
   on different machines can duplicate until convergence (design doc Q3 caveat). Only closes when
   the legacy path is removed.

3. **Built-in path isn't surfaced.** It's invisible to `trackerImporterDiscovery` (manifest-scan
   only) and has **no UI** — flag-gated, no discovery entry, no settings panel wired. This is the
   biggest "not first-class yet." The design doc Q4 sketches the fix (reuse the provider-agnostic
   `ImportFromSourceDialog`; repurpose `ConnectGoogleSheetDialog` as the importer's
   `settingsPanelId`), but it's out of scope of the prototype.

4. **Import-only; no write-back.** The contract is read-side by design. GitHub `resnapshot` works
   (living upstream); Sheets is append-only intake where `resnapshot` is mechanically valid but
   semantically empty (no upstream status/labels/author). No bidirectional sync anywhere. The
   contract leaves room (optional methods) but nothing implements it.

5. **Linear is MCP-only, not an importer.** `MCPServersPanel.tsx:303-313` configures Linear as an
   OAuth MCP server (`mcp.linear.app/mcp`); there is **no Linear importer**. `trackerOrigin.ts`
   already parses `linear://`. Linear has no ambient CLI auth like `gh`, so a Linear importer
   would need either a stored token (⇒ **built-in host-side**, same shape as Sheets) or to reuse
   the existing Linear MCP OAuth session. Adding it is a *known, bounded* shape — but adding it on
   top of a half-migrated Sheets path would compound debt.

---

## 3. Recommendation + open questions

### Recommended next increment (single, highest-value, lowest-risk)

**Retire the legacy Google Sheets bypass: flip the default to the registry built-in path and
delete `TrackerSheetImportService` / its `tracker:sheet-*` IPC.** This is the follow-up the
unification design doc already names. It is the right *first* move because it:
- collapses three paths to two (extension-RPC + built-in-host-side), making the SDK contract the
  single import contract in fact;
- closes the id-divergence duplicate window (gap 2) by removing the `gsheet-*` producer;
- gives Sheets the URN lock + race recovery + workspace dedup it currently lacks (gap 1);
- ships behind proven parity — the spike's prototype (`googleSheetsImporter.ts`) and tests
  (`googleSheetsImporterMapping.test.ts`, `googleSheetsImporterSpike.test.ts`) already exist.

**Then** (second increment, only once the above lands): surface the built-in path — make built-ins
appear in `ImportFromSourceDialog` and wire a settings panel (design doc Q4). That is what turns
"works behind a flag" into "first-class." Linear, if wanted, is a *third* increment after that,
and should reuse the Linear MCP OAuth rather than introduce a second Linear token store.

**Do NOT**: start a Linear importer, add write-back, or change the SDK `trackerImporter` contract
before the legacy bypass is gone. None of those is blocked by missing abstraction — they're
blocked by the unfinished convergence.

### Open questions for the maintainer (only you can answer)

1. **Product priority** — is multi-source import beyond GitHub+Sheets actually on the roadmap now,
   or is this "keep the abstraction warm"? Specifically, is **Linear** wanted as a real importer?
2. **Directionality** — is import-only the product, or is write-back/bidirectional ever wanted?
   This decides whether to invest in the optional write methods the contract leaves room for.
3. **SDK stability** — `@nimbalyst/extension-sdk` is v0.2.0 and the only importer *extension* is
   first-party (github-issues-importer). Is `trackerImporter` committed/stable for third-party
   authors, or still effectively internal? (Affects whether the asymmetry below should be codified
   publicly.)
4. **Built-in vs extension policy** — codify the rule that host-secret sources (Sheets,
   Linear-with-token) are **built-in** and ambient-auth sources (GitHub) are **extensions**? Right
   now it's an emergent property of `safeStorage` reachability, not a written contract.
5. **Linear auth reuse** — if Linear lands, reuse the existing Linear MCP OAuth session, or add a
   dedicated encrypted token store like Sheets'?

---

## Findings: doc/code drift flagged

- **Broken cross-reference.** `2026-06-18-google-sheets-importer-unification-design.md:5` cites
  `plans/014-unify-google-sheets-into-importer-registry.md`; this repo's `plans/014` is
  `014-automations-and-manifest-validation-tests.md`. The design doc's plan numbering belongs to a
  different (local `docs/superpowers`) plan set, not the `/improve` `plans/` set. Cosmetic, but
  it will mislead a reader following the link.
- **Everything else in the unification design doc verified accurate** against code: flag name,
  `googleSheetsImporter.ts` / `googleSheetsImporterMapping.ts` exist, registry built-in guards,
  workspace-scoped `findLocalIdByUrn`, per-URN locking, deterministic id, `google-sheets://` URN.
- No production source was modified by this spike. No throwaway PoC was needed — the existing
  flag-gated prototype already proves feasibility.
