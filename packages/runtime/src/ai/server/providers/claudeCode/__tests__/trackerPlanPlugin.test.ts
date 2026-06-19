/**
 * Tests for the bundled nimbalyst-planning plugin path resolver.
 *
 * Mirrors the test pattern from codex/__tests__/codexBinaryPath.test.ts:
 * path resolution is injected via options so tests run without touching
 * the real filesystem or process.resourcesPath.
 */

import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  TRACKER_PLAN_SKILLS,
  getTrackerPlanPluginSpec,
} from '../trackerPlanPlugin';

describe('TRACKER_PLAN_SKILLS', () => {
  it('contains the two nimbalyst-planning skill identifiers', () => {
    expect(TRACKER_PLAN_SKILLS).toContain('nimbalyst-planning:brainstorming');
    expect(TRACKER_PLAN_SKILLS).toContain('nimbalyst-planning:writing-plans');
    expect(TRACKER_PLAN_SKILLS).toHaveLength(2);
  });
});

describe('getTrackerPlanPluginSpec', () => {
  it('resolves packaged path from injected resourcesPath', () => {
    const resourcesPath = '/Applications/Nimbalyst.app/Contents/Resources';

    const spec = getTrackerPlanPluginSpec({ resourcesPath });

    expect(spec.type).toBe('local');
    expect(spec.path).toBe(
      path.join(resourcesPath, 'skills-plugins', 'nimbalyst-planning')
    );
  });

  it('resolves dev path from injected devResourcesBase when resourcesPath is absent', () => {
    const devBase = '/Users/me/source/nimbalyst-CC/packages/electron';

    const spec = getTrackerPlanPluginSpec({ resourcesPath: undefined, devResourcesBase: devBase });

    expect(spec.type).toBe('local');
    expect(spec.path).toBe(
      path.join(devBase, 'resources', 'skills-plugins', 'nimbalyst-planning')
    );
  });

  it('prefers resourcesPath over devResourcesBase when both are provided', () => {
    const resourcesPath = '/Applications/Nimbalyst.app/Contents/Resources';
    const devBase = '/Users/me/source/nimbalyst-CC/packages/electron';

    const spec = getTrackerPlanPluginSpec({ resourcesPath, devResourcesBase: devBase });

    expect(spec.path).toBe(
      path.join(resourcesPath, 'skills-plugins', 'nimbalyst-planning')
    );
  });

  it('always returns type: local', () => {
    const spec = getTrackerPlanPluginSpec({ resourcesPath: '/fake/resources' });
    expect(spec.type).toBe('local');
  });
});
