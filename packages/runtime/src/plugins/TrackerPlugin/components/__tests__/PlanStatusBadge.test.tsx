import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlanStatusBadge } from '../PlanStatusBadge';

describe('PlanStatusBadge', () => {
  it('shows Planned when planned', () => {
    expect(render(<PlanStatusBadge status="planned" />).queryByText(/planned/i)).toBeTruthy();
  });
  it('shows Planning… while processing', () => {
    expect(render(<PlanStatusBadge status="planning" liveState="processing" />).queryByText(/planning/i)).toBeTruthy();
  });
  it('shows Waiting for input while idle in planning', () => {
    expect(render(<PlanStatusBadge status="planning" />).queryByText(/waiting for input/i)).toBeTruthy();
  });
  it('renders nothing with no status', () => {
    expect(render(<PlanStatusBadge status={undefined as any} />).container.firstChild).toBeNull();
  });
});
