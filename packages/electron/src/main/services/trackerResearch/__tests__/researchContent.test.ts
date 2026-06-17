import { describe, it, expect } from 'vitest';
import {
  buildResearchPrompt,
  composeBodyWithResearch,
  RESEARCH_HEADING,
  PARTIAL_RESEARCH_NOTE,
} from '../researchContent';

const headingCount = (s: string) =>
  (s.match(new RegExp(RESEARCH_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

describe('composeBodyWithResearch', () => {
  it('appends a clean markdown heading + text when none exists', () => {
    const out = composeBodyWithResearch('My notes', 'Relevant: Foo.ts');
    expect(out).toContain('My notes');
    expect(out).toContain(RESEARCH_HEADING);
    expect(out).toContain('Relevant: Foo.ts');
    expect(out).not.toContain('<!--'); // no HTML-comment artifacts
  });

  it('produces just the section when the body is empty', () => {
    const out = composeBodyWithResearch('', 'r');
    expect(out.startsWith(RESEARCH_HEADING)).toBe(true);
  });

  it('replaces the prior section on re-run (single heading, new text)', () => {
    const first = composeBodyWithResearch('Notes', 'old');
    const second = composeBodyWithResearch(first, 'new');
    expect(second).toContain('new');
    expect(second).not.toContain('old');
    expect(headingCount(second)).toBe(1);
  });

  it('preserves user text before the section', () => {
    const withBlock = composeBodyWithResearch('Top', 'r1');
    const edited = withBlock.replace('Top', 'Top edited');
    const recomposed = composeBodyWithResearch(edited, 'r2');
    expect(recomposed).toContain('Top edited');
    expect(recomposed).toContain('r2');
    expect(headingCount(recomposed)).toBe(1);
  });

  it('appends the not-exhaustive note when partial', () => {
    const out = composeBodyWithResearch('Notes', 'Relevant: Foo.ts', { partial: true });
    expect(out).toContain('Relevant: Foo.ts');
    expect(out).toContain(PARTIAL_RESEARCH_NOTE);
    // Note sits at the very end of the regenerable block.
    expect(out.trimEnd().endsWith(PARTIAL_RESEARCH_NOTE)).toBe(true);
  });

  it('omits the note when not partial', () => {
    const out = composeBodyWithResearch('Notes', 'Relevant: Foo.ts');
    expect(out).not.toContain(PARTIAL_RESEARCH_NOTE);
  });

  it('drops a prior partial note when a later full run replaces the section', () => {
    const partial = composeBodyWithResearch('Notes', 'old partial', { partial: true });
    const full = composeBodyWithResearch(partial, 'complete', { partial: false });
    expect(full).toContain('complete');
    expect(full).not.toContain('old partial');
    expect(full).not.toContain(PARTIAL_RESEARCH_NOTE);
    expect(headingCount(full)).toBe(1);
  });
});

describe('buildResearchPrompt', () => {
  it('includes title, type, body and read-only instruction', () => {
    const p = buildResearchPrompt({ title: 'Fix theme', type: 'bug', body: 'xaml' });
    expect(p).toContain('Fix theme');
    expect(p).toContain('bug');
    expect(p).toContain('xaml');
    expect(p.toLowerCase()).toContain('read-only');
  });

  it('omits the notes line when body is empty', () => {
    const p = buildResearchPrompt({ title: 'T', type: 'task', body: '' });
    expect(p).not.toContain('Existing notes:');
  });
});
