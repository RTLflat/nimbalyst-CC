// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ConnectGoogleSheetDialog } from '../ConnectGoogleSheetDialog';

beforeEach(() => {
  (window as any).electronAPI = {
    trackerSheets: {
      getConfig: vi.fn(async () => null),
      connect: vi.fn(async () => ({ ok: true, formUrl: 'https://script.google.com/x/exec' })),
    },
  };
});

afterEach(() => cleanup());

describe('ConnectGoogleSheetDialog', () => {
  it('connects and shows the shareable form link', async () => {
    render(<ConnectGoogleSheetDialog workspacePath="/ws" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/web app url/i), { target: { value: 'https://script.google.com/x/exec' } });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => expect(screen.getByText(/script\.google\.com\/x\/exec/)).not.toBeNull());
    expect((window as any).electronAPI.trackerSheets.connect).toHaveBeenCalledWith('/ws', 'https://script.google.com/x/exec', '');
  });

  it('shows the Cancel button before connecting', () => {
    render(<ConnectGoogleSheetDialog workspacePath="/ws" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /cancel/i })).not.toBeNull();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<ConnectGoogleSheetDialog workspacePath="/ws" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
