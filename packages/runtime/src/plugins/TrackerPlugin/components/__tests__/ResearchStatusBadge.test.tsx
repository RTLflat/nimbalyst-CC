// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ResearchStatusBadge } from '../ResearchStatusBadge';

afterEach(() => {
  cleanup();
});

describe('ResearchStatusBadge', () => {
  it('shows "researching" only while running', () => {
    const { queryByText, rerender } = render(<ResearchStatusBadge status="running" />);
    expect(queryByText(/researching/i)).toBeTruthy();
    rerender(<ResearchStatusBadge status="done" />);
    expect(queryByText(/researching/i)).toBeNull();
  });

  it('renders nothing for done or undefined', () => {
    const { container, rerender } = render(<ResearchStatusBadge status="done" />);
    expect(container.firstChild).toBeNull();
    rerender(<ResearchStatusBadge status={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a subtle hint when research failed', () => {
    const { queryByText } = render(<ResearchStatusBadge status="failed" />);
    expect(queryByText(/research failed/i)).toBeTruthy();
  });
});
