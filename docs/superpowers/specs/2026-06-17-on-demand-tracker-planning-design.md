# On-demand "Plan this item" (replaces tracker auto-research)

**Date:** 2026-06-17
**Status:** Design approved; pending spec review → implementation plan

## Summary

Replace the automatic on-creation tracker research (find related classes → enrich
description) with an explicit, interactive **"Plan this item"** action. The action
opens a visible, read-only **plan-mode** agent session in the current workspace that
analyzes the codebase, asks clarifying questions, and produces a full implementation
plan for the bug/task. On approval the plan is saved to a file, the tracker
description is replaced with a clean summary, and the plan's path is appended. A
later worktree dispatch references that plan path in its prompt.

## Goals

- One explicit, user-driven action that turns a bug/task (title + description) into a
  vetted, ready-to-execute implementation plan.
- A real plan-mode experience: the agent asks clarifying questions live and the user
  approves the plan before anything is written.
- Surface implementation risks/blockers to the user as part of the plan.
- Persist the plan as a file and link it from the description so a later worktree
  dispatch can execute against it.
- Strictly read-only planning: no source edits during planning.

## Non-goals

- Any automatic, on-creation behavior. The current auto-research is removed entirely.
- Running planning inside a worktree, or auto-implementing on approval. Implementation
  remains a separate, later worktree dispatch.
- Bulk/multi-item planning. The action is per-item.
- A fully end-to-end automated test of the live interactive agent loop.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Trigger | Explicit "Plan this item" action; **remove** auto-on-creation research | User wants on-demand planning, not background enrichment. |
| Execution | Visible, interactive plan-mode session, read-only, in the **current workspace** | Live questions + ExitPlanMode approval need a visible session; read-only matches "plan, don't implement." |
| Capture | Plan-mode approval + **main-process hook** (Approach 1) | Keeps session read-only; approval gate before anything is written. |
| Approval semantics | For tracker-plan sessions, **approve = accept & save**, NOT proceed-to-implement | Implementation is a separate later dispatch. |
| Plan file | `nimbalyst-local/plans/<KEY>-plan.md` (absolute path) | Local-only working file; referenced from a worktree by absolute path. |
| Description | **Replace** with the agent's clean summary + appended plan path | Matches "update the description with a brief summary." |
| Dispatch | Worktree dispatch references the plan path by absolute path when present | "Use that in the prompt when sending for implementation." |
| Status badge | `data.research` badge → minimal `data.plan` "Planned" badge | Reflects the new mechanism. |

## End-to-end flow

```
  Tracker item (detail panel / kanban card menu)  -- click "Plan this item"
        |
        v
  tracker:plan-item IPC
        |
        v
  TrackerPlanService.startPlanningSession(workspacePath, itemId):
   - create a VISIBLE agent session in the CURRENT workspace
     (SessionMode = 'planning', read-only), session metadata:
       { kind: 'tracker-plan', trackerItemId, issueKey }
   - link session <-> tracker (bidirectional)
   - seed planning prompt from TITLE + DESCRIPTION
   - focus the session in the AI panel
        |
        v
  Agent (read-only): analyzes repo -> asks clarifying questions via
   AskUserQuestion -> calls ExitPlanMode with a plan that LEADS with
   "## Summary" and "## Risks / Open issues"
        |  user reviews; Approve
        v
  ExitPlanMode-approval hook (tracker-plan session only):
   approve = ACCEPT & SAVE (NOT implement)
   - write <workspace>/nimbalyst-local/plans/<KEY>-plan.md
   - replace description with the agent's Summary + append "Plan: <abs path>"
   - stamp data.plan = { path, summary, createdAt, sessionId, status:'planned' }
        |
        v  (later, the user's decision)
  "Dispatch to worktree" -> linkAndBuildTrackerPrompt sees data.plan.path
   -> prompt: "Implement <id>: <title>. Follow the plan at <abs path>. ..."
```

## Components

### Removal (auto-research teardown)

- Remove the unconditional `TrackerResearchService.getInstance().onNativeTrackerItemCreated(...)`
  call in `handleTrackerCreate` (`packages/electron/src/main/mcp/tools/trackerToolHandlers.ts`
  ~1768).
- Retire the background headless research path: `TrackerResearchService` run logic,
  `gating.ts` (including the google-sheets gating added earlier), and the
  `data.research` writing.
- `researchModel.ts` (model/effort resolution) may be reused by the planning prompt;
  keep it if reused, otherwise remove with the rest.
- `ResearchStatusBadge` → repurpose to a minimal "Planned" badge driven by
  `data.plan` (clicking opens the plan), or remove. Keep the minimal planned badge.
- Existing rows with `data.research` are left as-is (harmless); the new badge reads
  `data.plan`.

### New

- **`TrackerPlanService`** (`packages/electron/src/main/services/trackerPlan/TrackerPlanService.ts`):
  - `startPlanningSession(workspacePath, itemId): Promise<{ sessionId }>` — creates the
    visible planning session (planning mode, read-only) in the current workspace,
    sets metadata `{ kind:'tracker-plan', trackerItemId, issueKey }`, links session↔tracker,
    seeds the planning prompt, and surfaces the session.
  - `onPlanApproved(sessionId, planMarkdown): Promise<void>` — saves the plan file,
    replaces the description with the extracted summary + appended plan path, and
    stamps `data.plan`.
  - Plan-prompt builder + summary extraction + plan-path derivation live here (pure
    helpers, unit-tested).
- **IPC** `tracker:plan-item` ({ workspacePath, itemId }) → `startPlanningSession` and
  focus the session. Registered via `safeHandle`.
- **ExitPlanMode-approval hook**: in the plan-approval handling, detect a tracker-plan
  session (via session metadata) and route to `onPlanApproved` while **suppressing the
  normal proceed-to-implement continuation** for that session.
- **"Plan this item" action** in the tracker detail panel and the kanban card menu,
  alongside "Dispatch to worktree".

### Planning prompt (from title + description)

Instructs the agent: produce a read-only implementation plan for this `{type}`;
analyze the codebase with read-only tools only; **ask clarifying questions via
`AskUserQuestion` whenever the title/description leave a real ambiguity**; then call
`ExitPlanMode` with a plan that **begins with `## Summary` (2–4 sentences) and a
`## Risks / Open issues` section flagging anything that could block implementation**,
followed by the step-by-step plan. Do not edit any files.

## Data model

- `data.plan = { path: string (absolute), summary: string, createdAt: ISO,
  sessionId: string, status: 'planned' }`.
- `data.research` no longer written.

## Worktree dispatch integration

`linkAndBuildTrackerPrompt` (`packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx`
~228): when `data.plan?.path` exists, the seed prompt becomes "Implement tracker item
`{id}: {title}`. Follow the implementation plan at: `{absolute path}`. `{summary}`.
Update this item's status when done via `tracker_update`." When absent, the current
description-based behavior is unchanged.

## Error handling

- Deny/cancel ExitPlanMode → nothing saved; the session stays open for another round.
- No default agent model (or a provider without plan mode) → the action is disabled
  with a tooltip explaining why.
- `nimbalyst-local/plans/` is created if missing. The plan filename uses the issue key
  (`BUG-001-plan.md`); if the item has no key yet, fall back to the item id.
- Read-only is enforced by planning mode; the agent cannot edit source during planning.
- If the description-replace or file-write fails after approval, surface the error;
  do not partially stamp `data.plan` (write file first, then update description+stamp).

## Testing

- **Unit**:
  - Plan-path derivation: issue key → `nimbalyst-local/plans/<KEY>-plan.md`; id fallback.
  - Description composition: original replaced with summary, plan path appended as an
    absolute path.
  - Summary extraction: pull the `## Summary` section from the plan markdown.
  - Planning-prompt builder from title + description (includes the read-only,
    ask-questions, ExitPlanMode, Summary/Risks instructions).
  - Dispatch-prompt builder (`linkAndBuildTrackerPrompt`) with and without `data.plan`.
- **Integration**: `onPlanApproved` given a captured plan + tracker-plan session writes
  the file, replaces the description, and stamps `data.plan` (DB + fs mocked).
- The fully-interactive agent loop (live questions / ExitPlanMode) is not unit-tested
  end-to-end; the deterministic seams above are.

## Open questions for implementation planning

- Exact mechanism to start a **visible** planning-mode session in the current workspace
  programmatically (reuse the non-worktree session-create + queued-prompt path; confirm
  how to set `SessionMode = 'planning'` at creation).
- Exact ExitPlanMode approval interception point and how to read the plan markdown from
  the tool call (plan text argument vs. a plan file the widget references) — confirm in
  `ExitPlanModeWidget` / `AgentToolHooks` / the meta-agent server.
- Whether `researchModel.ts` is reused for the planning model/effort or planning simply
  uses the workspace default agent model.

## Architecture diagram

Per the repo convention for architectural changes, an Excalidraw diagram of the flow
above will be produced in `nimbalyst-local/architecture/` during implementation
planning.
