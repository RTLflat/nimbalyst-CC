# Design: "Plan this item" via the brainstorming skill + planning workflow

**Date:** 2026-06-17
**Status:** Approved (brainstorming) — ready for implementation planning
**Supersedes the generation mechanism of:** `2026-06-17-on-demand-tracker-planning-design.md`

## Goal

Two intertwined changes to the tracker "Plan this item" action:

1. **Generation mechanism:** replace the Claude Code **plan-mode** flow (read-only analysis → `ExitPlanMode` → approve) with **literally running the `superpowers:brainstorming` skill** through its terminal `writing-plans` step — a collaborative dialogue that produces a structured implementation plan.
2. **Planning workflow:** drive a visible lifecycle across both the tracker board (item status) and the session board (session phase): an item moves through **Planning → Ready → In Progress** as it is planned, the plan is approved, and the user proceeds; planning sessions appear in and leave the session board accordingly; a live badge shows planning progress.

Downstream consumption of the saved plan is unchanged: the capture writes the same `data.plan = { path, summary, createdAt, sessionId, status:'planned' }` shape, so worktree dispatch follows the plan. The automatic on-creation research removed in the prior workstream stays removed.

## The two boards (important distinction)

- **Tracker Kanban** (`KanbanBoard.tsx`): task/bug items grouped by their **status** field. Columns are derived from the model's status options. Today: `to-do` / `in-progress` / `done`.
- **Session Kanban** (`SessionKanbanBoard.tsx`, `sessionKanban.ts`): AI **sessions** grouped by `metadata.phase` — `backlog` / `planning` / `implementing` / `validating` / `complete`. Phase is set explicitly (`sessions:update-session-metadata`); a session with no phase is "unphased" and not shown.

This design touches both boards.

## End-to-end lifecycle

```
[item: To Do]
   │  click "Plan this item"
   ▼
[item status: PLANNING]  +  [planning session created, phase: Planning]   ← brainstorming runs
   │                                                   badge: "Planning…" / "Waiting for input/approval"
   ├─ plan written (tracker_plan_save) ──────────────────────────────────────────┐
   │                                                                              ▼
   │                                            [item status: READY]  +  [planning session ARCHIVED]
   │                                                                    data.plan stamped, description rewritten
   │                                                                              │  user proceeds (dispatch to worktree)
   │                                                                              ▼
   │                                            [item status: IN PROGRESS]  +  [implementation session created in a
   │                                                                            dedicated worktree, phase: Implementing,
   │                                                                            follows the saved plan]
   └─ planning abandoned (session stopped/cancelled before plan written) ─────────► [item status: reverted to prior]
```

### 1. Plan this item

- Record the item's **prior status** (to enable revert on abandon) — stored on the planning session's metadata.
- Set the item status → **`planning`** (new status → Planning lane on the tracker board).
- Create a planning session tagged `metadata.kind:'tracker-plan'` (+ `trackerItemId`, `issueKey`, `priorStatus`), set `metadata.phase = 'planning'` (Planning column on the session board), link it to the item.
- Configure the session to load the bundled brainstorming + writing-plans skills and run the type-aware seed prompt (below).
- The item shows a **live badge** reflecting the linked planning session's runtime state: **"Planning…"** (session processing) or **"Waiting for input/approval"** (session idle / pending prompt).

### 2. Plan written — `tracker_plan_save`

When the brainstorming → writing-plans flow has produced the plan and the agent calls `tracker_plan_save`:
- Stamp `data.plan = { path, summary, createdAt, sessionId, status:'planned' }` and rewrite the description (summary + plan link) — reuses today's `onPlanApproved` logic.
- Set the item status → **`ready`** (new status → Ready lane).
- **Archive** the planning session (`isArchived:true`) so it leaves the session board; its transcript/brainstorming conversation is preserved.

### 3. Abandon

If the planning session is stopped/cancelled/deleted **before** `tracker_plan_save` runs, revert the item status to the recorded prior status (no `data.plan` written). Covers user-cancel and stop; a startup reconciliation for orphaned `planning` items (app closed mid-planning) is optional hardening.

### 4. Proceed (reuse the existing worktree dispatch)

The existing "Dispatch to worktree" action becomes "proceed." When invoked on a Ready item it additionally:
- Sets the item status → **`in-progress`**.
- Creates the worktree + implementation session as today, and sets that session's `metadata.phase = 'implementing'` (Implementing column on the session board).
- The implementation prompt already follows `data.plan.path` via `buildDispatchPrompt` (unchanged).

## New tracker statuses

Add to **both** `task.yaml` and `bug.yaml` (and any other planjnable type), as real model status options (label/icon/color), in this column order:

`to-do` (To Do) → **`planning` (Planning)** → **`ready` (Ready)** → `in-progress` (In Progress) → `done` (Done)

`planning` and `ready` are system-managed in the normal flow but remain valid, selectable statuses.

## The item badge

`PlanStatusBadge` is extended to render, in priority order:
- If the item's status is **`planning`** and a linked planning session exists → a **live** label from that session's runtime state: **"Planning…"** (processing) or **"Waiting for input/approval"** (idle / pending prompt).
- Else if `data.plan?.status === 'planned'` → a **"Planned"** chip (a plan exists; shown on Ready/In Progress items so plan-backed work is visible).
- Else nothing.

The live label is derived in the renderer from the linked session's processing/pending-prompt atoms (the item↔session link already exists via `tracker:link-session`). Exact atom wiring is an implementation detail.

## Generation mechanism (brainstorming skill)

### Feasibility (verified against the Claude Agent SDK)
- Skills are surfaced to a programmatic `query()` session via `plugins: [{ type:'local', path }]` + a `skills` allow-list (e.g. `['<plugin>:brainstorming','<plugin>:writing-plans']`); deterministic regardless of the user's `~/.claude`. Setting `skills` auto-adds the `Skill` tool to `allowedTools`.
- `Skill` is the literal tool name; Nimbalyst already recognizes/auto-approves it in auto mode. Nested skill invocation (brainstorming → writing-plans) works when `Skill` is allowed.
- `AskUserQuestion` and the in-chat back-and-forth map onto Nimbalyst's existing session chat + AskUserQuestion widget.
- `permissionMode:'plan'` scopes `Write` to the plan file only, blocking the writes brainstorming needs — so tracker-plan sessions must NOT run in plan mode.

### Bundled skill plugin
Nimbalyst vendors `brainstorming` + `writing-plans` (version-pinned, close to upstream) as a local plugin shipped in app resources (`.claude-plugin/plugin.json` + `skills/.../SKILL.md`), path-resolved for dev vs packaged builds. Behavior is steered via the seed prompt (the skill honors "user preferences override the default spec location"), keeping "literally invoke the skill" intact. Optional cross-skill references degrade gracefully.

### Session configuration (`sdkOptionsBuilder`)
When a session is `kind:'tracker-plan'` — modeled on the existing `isMetaAgent` branch — inject the bundled plugin, the `skills` allow-list, a writable non-plan permission posture, and the seed prompt.

### Seed prompt (type-aware)
Replaces `buildPlanningPrompt`. Includes the item `<KEY>`, title, description/body, and instructs:
- Investigate the existing code relevant to the item **before** asking questions; ask informed questions only.
- **If the item is a bug:** first post a concise "what I found / root-cause read" summary, then proceed (catches a wrong starting point early). Tasks/features: investigate then ask.
- Run `superpowers:brainstorming` through `writing-plans`. Write the plan to `nimbalyst-local/plans/<KEY>-plan.md`.
- Do **not** offer the browser visual companion, do **not** commit to git, do **not** implement.
- When the plan is approved and written, call `tracker_plan_save` with the plan path + a 2–4 sentence summary, then stop.

### Permission posture
- Read-only on source code (`Read`/`Grep`/`Glob`); writes limited to `nimbalyst-local/`; plus `Skill`, `AskUserQuestion`, `tracker_plan_save`.
- Denied/escalated: source edits outside `nimbalyst-local/`, mutating `Bash`, `git commit`.
- **Open implementation risk (highest):** enforcing this write scope outside plan mode — via a tracker-plan permission profile keyed off `kind:'tracker-plan'` in the `immediateToolDecision`/`canUseTool` path, with the seed prompt as backup. Exact rules pinned in the plan.

### Completion capture — `tracker_plan_save` MCP tool
Internal MCP tool exposed only to tracker-plan sessions. Input: `planPath`, `summary`. Resolves the tracker item from the **session binding** (`metadata.trackerItemId`/`issueKey` via `isTrackerPlanSession`). Handler reuses `onPlanApproved` logic (normalize path, compose description, stamp `data.plan`), then performs the status→`ready` transition and archives the session.

### Artifacts
Plan at `nimbalyst-local/plans/<KEY>-plan.md` (gitignored; `data.plan.path` points here). Brainstorming design doc also under `nimbalyst-local/` (kept as context; not committed).

## Changes relative to the plan-mode implementation we just built

**Removed:** the `ai:exitPlanModeConfirmResponse` tracker-plan branch + `handleTrackerPlanExitApproval`; `buildPlanningPrompt`.
**Reused:** `isTrackerPlanSession` (resolves the binding for `tracker_plan_save`); `onPlanApproved` logic (becomes the capture handler); `planPaths` helpers; `buildDispatchPrompt` (follows `data.plan.path`).
**Changed:**
- `handlePlanItem` (renderer): set item status → `planning`, store prior status, create the tracker-plan session with `phase:'planning'`, load the bundled plugin + skills + new seed prompt (no `mode:'planning'`).
- `sdkOptionsBuilder`: tracker-plan branch (plugin/skills/permission/seed-prompt).
- The worktree-dispatch action: also set item status → `in-progress` and the new session `phase:'implementing'`.
- `task.yaml`/`bug.yaml`: add `planning` + `ready` statuses.
- `PlanStatusBadge`/`getPlanStatus`: extend to the live planning/waiting label + the existing Planned chip.
- New: `tracker_plan_save` MCP tool; abandon-revert hook on planning-session termination.

**Unchanged:** `data.plan` shape; dispatch following `data.plan.path`; the "Plan this item" buttons; auto-research stays removed.

## Global constraints

- Planning is read-only on source; the agent writes only under `nimbalyst-local/`; no git commits from the planning session.
- camelCase wire/JSON; snake_case only for SQL. `safeHandle`/`safeOn`; no dynamic `import()` for new main code.
- No emojis; one-sentence commit subjects; no `Co-Authored-By`. CHANGELOG: one user-facing bullet, no internal scaffolding.
- Never mark trackers `done`/`completed` from code (the workflow tops out at `in-progress`).

## Testing

- Unit: `tracker_plan_save` handler (description rewrite + `data.plan` shape + status→`ready` + archive + binding resolution); the type-aware seed-prompt builder (bug vs task branches, investigate-first, stop-and-save, no-commit/no-companion); status transition + abandon-revert logic; the badge's status→label mapping.
- The live brainstorming loop is manual-verify (needs the bundled plugin + a claude-code default model), consistent with the prior feature. First deliverable for the capture path is a failing→passing unit test on `tracker_plan_save`.

## Open implementation risks (carry into the plan)

1. **Permission enforcement** (writes scoped to `nimbalyst-local/`, no source edits, no commit) outside plan mode — the main risk.
2. **Abandon detection** — reliably catching planning-session termination (cancel/stop/delete, and app-close mid-planning) to revert status without false reverts after a successful save.
3. **Live badge wiring** — reading the linked planning session's runtime state from the tracker views.
4. **Bundled plugin** path resolution (dev vs packaged) and version-pinning/refresh of the vendored skills.
5. **Suppressing the visual companion** and the skill's default `git commit` via the seed prompt (minimally adapt the vendored copy only if the prompt is insufficient).
6. **Stop-before-implement** — the flow halts after `tracker_plan_save`.
7. **Provider dependency** — runs under the claude-code provider; non-claude-code default models won't drive this flow (accepted scope boundary).

## Out of scope

- Gating tracker planning for meta-agent/mobile approval paths (accepted scope boundary).
- Decoupling Kanban columns from status (we add statuses instead).
