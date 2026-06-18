import path from 'path';
import { app } from 'electron';

/**
 * Skills provided by the bundled nimbalyst-planning plugin.
 * Used when populating the `allowedTools` / `skills` list for tracker plan sessions.
 */
export const TRACKER_PLAN_SKILLS = [
  'nimbalyst-planning:brainstorming',
  'nimbalyst-planning:writing-plans',
] as const;

/**
 * Options for resolving the bundled nimbalyst-planning plugin directory.
 * Injectable for testing — mirrors the options pattern in codexBinaryPath.ts.
 */
export interface TrackerPlanPluginResolutionOptions {
  /**
   * Path to the Electron app's resources directory.
   * Defaults to process.resourcesPath (defined only in packaged builds).
   */
  resourcesPath?: string;
  /**
   * Base directory for the dev-mode resources tree (i.e. packages/electron root).
   * Defaults to app.getAppPath() which returns the package root in dev mode.
   */
  devResourcesBase?: string;
}

/**
 * Resolve the absolute path to the bundled nimbalyst-planning plugin directory.
 *
 * Mirrors the dev/packaged detection pattern from codexBinaryPath.ts:
 * - Packaged: process.resourcesPath is defined; plugin lives at
 *   <resourcesPath>/skills-plugins/nimbalyst-planning (shipped via electron-builder
 *   extraResources `to: skills-plugins`).
 * - Dev: process.resourcesPath is undefined; plugin lives in the source tree at
 *   <packageRoot>/resources/skills-plugins/nimbalyst-planning where packageRoot is
 *   app.getAppPath() (= packages/electron in dev mode).
 *
 * @returns Absolute path to the nimbalyst-planning plugin directory.
 */
export function getTrackerPlanPluginSpec(
  options: TrackerPlanPluginResolutionOptions = {}
): { type: 'local'; path: string } {
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;

  if (resourcesPath) {
    // Packaged build: plugin ships to <resourcesPath>/skills-plugins/nimbalyst-planning
    return {
      type: 'local',
      path: path.join(resourcesPath, 'skills-plugins', 'nimbalyst-planning'),
    };
  }

  // Dev mode: plugin lives in the source tree under packages/electron/resources
  const devBase = options.devResourcesBase ?? app.getAppPath();
  return {
    type: 'local',
    path: path.join(devBase, 'resources', 'skills-plugins', 'nimbalyst-planning'),
  };
}
