// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunStatusLine } from './run-status-line';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RunStatusLine', () => {
  it('shows a static queue status without an activity glyph', () => {
    render(<RunStatusLine status="queued" />);

    expect(screen.getByTestId('run-status-line').textContent).toBe('Waiting for a free slot…');
    expect(screen.queryByTestId('working-indicator')).toBeNull();
  });

  it('shows approval as a paused run rather than pretending to work', () => {
    render(<RunStatusLine status="approval" />);

    expect(screen.getByRole('status').textContent).toBe('Waiting for approval…');
    expect(screen.queryByTestId('working-indicator')).toBeNull();
  });

  it('animates locally while exposing one stable accessible status', () => {
    vi.useFakeTimers();
    render(<RunStatusLine status="running" />);

    const indicator = screen.getByTestId('working-indicator');
    expect(indicator.getAttribute('aria-hidden')).toBe('true');
    expect(indicator.textContent).toBe('⠋');
    expect(screen.getByRole('status').textContent).toContain('Working…');

    act(() => vi.advanceTimersByTime(140));
    expect(indicator.textContent).toBe('⠙');
  });
});
