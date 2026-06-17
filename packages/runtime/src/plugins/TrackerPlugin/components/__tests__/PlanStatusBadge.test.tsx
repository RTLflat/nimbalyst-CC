// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PlanStatusBadge } from '../PlanStatusBadge';

afterEach(() => {
  cleanup();
});

describe('PlanStatusBadge', () => {
  it('renders "Planned" chip when status is planned', () => {
    const { queryByText } = render(<PlanStatusBadge status="planned" />);
    expect(queryByText(/planned/i)).toBeTruthy();
  });

  it('renders nothing when status is undefined', () => {
    const { container } = render(<PlanStatusBadge status={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
