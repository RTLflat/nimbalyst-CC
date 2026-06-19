/**
 * Shared AI settings types that cross the main<->renderer IPC boundary.
 *
 * Single source of truth for the project-level AI provider override shape. Both
 * the main-process store and the renderer atoms/panels import from here so the
 * serialized workspace settings can't silently drift between the two sides.
 */

/**
 * Per-provider override settings for project-level configuration.
 * Values of `undefined` mean "inherit from global settings".
 * Explicit values override the global setting.
 */
export interface ProviderOverride {
  /** Override enabled state: true = force enabled, false = force disabled, undefined = inherit */
  enabled?: boolean;
  /** Override selected models (if provided, replaces global model selection) */
  models?: string[];
  /** Override default model for this provider */
  defaultModel?: string;
  /** Project-specific API key (optional, overrides global key) */
  apiKey?: string;
}

/**
 * Project-level AI provider overrides.
 * Allows projects to customize AI settings without affecting global configuration.
 *
 * Use cases:
 * - Disable a provider for a specific project
 * - Enable a provider only for certain projects
 * - Use different models per project
 * - Use project-specific API keys (e.g., client-provided keys)
 */
export interface AIProviderOverrides {
  /** Override default provider for this project */
  defaultProvider?: string;
  /** Override the path to a custom Claude Code executable for this project.
   * Absent (undefined) means "inherit the global value"; any string set here is
   * used as-is and overrides the global setting. To remove an existing override,
   * delete the field rather than setting it to an empty string. */
  customClaudeCodePath?: string;
  /** Per-provider overrides */
  providers?: Record<string, ProviderOverride>;
}
