# Overview & Build Modes — Design Spec

**Date:** 2026-06-15  
**Status:** Approved  
**Scope:** Add `overview` and `build` as two new `ContentMode` entries in nimbalyst, surfacing AccoRevit repo health and build execution natively within the app.

---

## 1. Architecture

Two new entries join the `ContentMode` union:

```typescript
type ContentMode = 'files' | 'agent' | 'tracker' | 'collab' | 'pr-review' | 'settings' | 'overview' | 'build'
```

The feature is layered across three planes:

### Renderer (React / Jotai)
- `OverviewMode` and `BuildMode` live under `packages/electron/src/renderer/components/`
- Three new Jotai atoms in `packages/electron/src/renderer/store/`:
  - `gitRepoStatusAtom` — array of per-repo git status
  - `activeBuildAtom` — current build run state + live log lines
  - `workspaceReposAtom` — configured repos loaded from PGLite
- Both modes read existing session and task atoms from nimbalyst's current stores — no duplication

### Main Process (Electron IPC)
- New IPC handler group `build:*`: `build:run`, `build:cancel`, `build:list`, `build:diagnostics`, `build:log`
- New IPC handler `git:repo-status` — runs git commands against each configured repo path
- `build:run` spawns `dotnet build` as a child process, streams stdout line-by-line as IPC events

### Persistence (PGLite)
Four new tables added via a single numbered migration (see Section 4).

---

## 2. Component Structure

### OverviewMode (`components/OverviewMode/index.tsx`)

Read-only aggregation view. Refreshes on mount and every 60 seconds.

```
OverviewMode
├── StatBar — 6 stat cards in a responsive grid
│   ├── ReposStat        — total registered / dirty count (gitRepoStatusAtom)
│   ├── SessionsStat     — active / waiting (existing session atom)
│   ├── BuildsStat       — running / last failed (activeBuildAtom + build history)
│   └── TasksStat        — open / awaiting review (existing task atom)
├── DeploymentMatrix     — table: repos × revit years (R20–R26), each cell = last deploy + staleness
├── RepoStatusGrid       — one row per repo: name, branch, dirty indicator, ahead/behind, last build chip
└── WaitingSessionsStrip — sessions awaiting user input; click navigates to AgentMode
```

### BuildMode (`components/BuildMode/index.tsx`)

Owns the build lifecycle. Spawns and cancels builds, streams output, displays diagnostics.

```
BuildMode
├── BuildControls (left panel, ~280px)
│   ├── RepoSelector          — dropdown from workspaceReposAtom
│   ├── RevitYearSelector     — segmented R20/R21/R22/R23/R24/R25/R26
│   ├── ModeToggle            — Debug / Release
│   ├── XmlDocSwitch          — /p:GenerateDocumentationFile
│   ├── IsRepackableSwitch    — /p:IsRepackable
│   ├── CommandPreview        — readonly chip display of dotnet args
│   └── BuildButton / CancelButton
├── BuildConsole (flex: 1)
│   ├── Tab: Warnings & Errors — filtered warning/error lines only
│   ├── Tab: Full Log          — raw output, auto-scroll to bottom
│   ├── Tab: Diagnostics       — parsed MSBuild rows (code, file:line, message; click to copy)
│   └── Tab: Summary           — status, config, counts, duration, artifact path, deploy status
└── YearMatrix                 — R20–R26 grid; click row to select year; shows last build + staleness
```

### Shared UI Primitives (`components/shared/`)

New primitives used by both modes, styled with Tailwind to match nimbalyst's existing design system:
- `StatCard` — icon, label, primary value, optional subvalue + onClick
- `BuildChip` — status badge (running, success, failed, cancelled)
- `RepoBadge` — dirty/clean/behind/diverged state indicator

---

## 3. Data Flow & IPC

### Git Repo Status (Overview)
1. `OverviewMode` mounts → dispatches `git:repo-status`
2. Main process iterates `workspace_repos` from PGLite, runs `git -C <path> status --porcelain -b` per repo
3. Returns `{repoId, branch, isDirty, ahead, behind}[]` → stored in `gitRepoStatusAtom`
4. Polled every 60s + refreshed on manual trigger

### Build Lifecycle
```
User clicks Build
  → renderer: IPC send build:run {targetId, mode, xmlDoc, repack}
  → main: spawns dotnet build child process
  → main: streams per-line IPC events:
      {event: 'started', runId}
      {event: 'output', line, kind}     ← kind: 'output' | 'warning' | 'error'
      {event: 'finished', state, warningCount, errorCount}
  → renderer: each event updates activeBuildAtom
      → Full Log tab live-appends
      → warning/error lines route to Warnings & Errors tab
  → on 'finished': main writes run + log lines to PGLite
  → renderer: re-fetches build:list to refresh history and YearMatrix
```

### Diagnostics (Lazy-Loaded)
- Main process parses MSBuild structured output during the run, stores to `build_diagnostics`
- Diagnostics tab triggers `build:diagnostics {runId}` IPC only when that tab is first selected

### Cross-Mode Data Sharing
- `OverviewMode` reads session count from the same atom `AgentMode` writes — no duplication
- `OverviewMode` reads task counts from the same atom `TrackerMode` writes — no duplication
- `activeBuildAtom` is read by both `BuildMode` (primary) and `OverviewMode`'s BuildsStat card

---

## 4. PGLite Schema

One numbered migration adding four tables:

```sql
-- workspace_repos
CREATE TABLE workspace_repos (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  path          TEXT NOT NULL,
  build_targets JSONB NOT NULL DEFAULT '[]'
  -- build_targets shape: [{id, revit_year, config, working_dir}]
);

-- build_runs
CREATE TABLE build_runs (
  id            TEXT PRIMARY KEY,
  repo_id       TEXT NOT NULL REFERENCES workspace_repos(id),
  target_id     TEXT NOT NULL,
  state         TEXT NOT NULL,       -- 'running' | 'success' | 'failed' | 'cancelled'
  config        JSONB NOT NULL,      -- {mode, xmlDoc, repack}
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ,
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_count   INTEGER NOT NULL DEFAULT 0
);

-- build_log_lines
CREATE TABLE build_log_lines (
  id      BIGSERIAL PRIMARY KEY,
  run_id  TEXT NOT NULL REFERENCES build_runs(id),
  line_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  kind    TEXT NOT NULL              -- 'output' | 'warning' | 'error'
);

-- build_deployments
CREATE TABLE build_deployments (
  id            BIGSERIAL PRIMARY KEY,
  repo_id       TEXT NOT NULL REFERENCES workspace_repos(id),
  revit_year    TEXT NOT NULL,       -- 'R20' | 'R21' | ... | 'R26'
  deployed_at   TIMESTAMPTZ NOT NULL,
  artifact_path TEXT
);
```

**Migration rules:**
- All timestamps use `TIMESTAMPTZ`, stored as UTC (per DATABASE.md)
- `build_targets` and `config` use `JSONB` with PGLite-safe operators only
- Migration runs automatically at app startup via the existing migration runner

---

## 5. Testing Strategy

### Unit Tests (Vitest)
- `gitRepoStatusAtom` — mock IPC, assert dirty/ahead/behind parsing from raw git output
- `activeBuildAtom` — simulate `started` / `output` / `finished` event sequence, assert state transitions
- MSBuild diagnostic parser (pure function) — assert correct extraction of code/file/line from representative MSBuild error strings

### E2E Tests (Playwright)
- Navigate to Overview mode → assert stat cards render with non-null values
- Navigate to Build mode → select repo and year → click Build → assert console receives streaming lines → assert YearMatrix row updates on finish
- Cancel a running build → assert state transitions to `cancelled`

### Deliberate Exclusions
- No test for actual `dotnet build` subprocess output — AccoRevit build system's concern, not nimbalyst's
- No integration test for deployment matrix staleness beyond unit level (would require real git history)
