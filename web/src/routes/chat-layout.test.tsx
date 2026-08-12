// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NoChatSelected } from './chat-layout';

afterEach(cleanup);

describe('no chat selected', () => {
  it('shows the Pop bubble above the empty-state copy', () => {
    render(<NoChatSelected />);

    const title = screen.getByRole('heading', { name: 'Pick up where you left off' });
    const mark = title.previousElementSibling;

    expect(mark?.tagName).toBe('svg');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.classList.contains('h-24')).toBe(true);
    expect(screen.getByText('Choose a conversation on the left, or start a new one.')).toBeTruthy();
  });
});
