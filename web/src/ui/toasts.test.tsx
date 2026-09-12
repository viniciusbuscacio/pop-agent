// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotificationsStore } from '../store/notifications';
import { Toasts } from './toasts';

beforeEach(() => {
  useNotificationsStore.setState({ toast: undefined });
});

afterEach(cleanup);

describe('actionable notices', () => {
  it('announces the result and runs Restore once', async () => {
    const restore = vi.fn();
    useNotificationsStore.getState().notify('“report.pdf” was moved to Trash.', {
      label: 'Restore',
      run: restore,
    });

    render(<Toasts />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('moved to Trash');
    expect(notice.className).toContain('border-[var(--notice-border)]');
    expect(notice.className).toContain('bg-[var(--notice-bg)]');

    await userEvent.click(screen.getByTestId('toast-action'));
    expect(restore).toHaveBeenCalledOnce();
    expect(useNotificationsStore.getState().toast).toBeUndefined();
  });
});
