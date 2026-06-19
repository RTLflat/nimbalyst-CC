/**
 * Built-in (host-side) tracker importers — flag-gated spike (plan 014).
 *
 * `trackerImporterDiscovery` only finds importers via extension manifests (each
 * backed by a utility-process backend module). Some importers must run host-side
 * instead — e.g. Google Sheets, whose encrypted token a utility process cannot
 * read. This is the minimal "built-in importer" registration path the design
 * (Q1) calls for, kept entirely behind a flag so the default behavior is unchanged.
 *
 * Flag OFF (default) ⇒ `getBuiltInImporter`/`listBuiltInImporters` return
 * `null`/`[]`, and `TrackerImporterRegistry` behaves exactly as before.
 *
 * See `docs/superpowers/specs/2026-06-18-google-sheets-importer-unification-design.md`.
 */

import type { ImporterMethods, TrackerImporterContribution } from '@nimbalyst/extension-sdk';
import { GOOGLE_SHEETS_CONTRIBUTION } from './googleSheetsImporterMapping';
import { createGoogleSheetsBuiltInImporter } from './googleSheetsImporter';

export interface BuiltInImporter {
  contribution: TrackerImporterContribution;
  /** Build the host-side methods bound to a workspace (mirrors `activate(ctx).methods`). */
  create: (workspacePath: string) => ImporterMethods;
}

/** Only active when explicitly opted in; keeps the legacy sheet path the default. */
export function builtInImportersEnabled(): boolean {
  return process.env.NIMBALYST_GSHEET_REGISTRY_IMPORTER === '1';
}

const REGISTRY: BuiltInImporter[] = [
  {
    contribution: GOOGLE_SHEETS_CONTRIBUTION,
    create: createGoogleSheetsBuiltInImporter,
  },
];

/** All built-in importers, or `[]` when the flag is off. */
export function listBuiltInImporters(): BuiltInImporter[] {
  return builtInImportersEnabled() ? REGISTRY : [];
}

/** Find a built-in importer by provider id, or `null` when the flag is off. */
export function getBuiltInImporter(providerId: string): BuiltInImporter | null {
  if (!builtInImportersEnabled()) return null;
  return REGISTRY.find((b) => b.contribution.id === providerId) ?? null;
}
