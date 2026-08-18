// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarNav } from './sidebar-nav';

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

afterEach(cleanup);

describe('Agent navigation', () => {
  it('places A2A beside MCP and navigates to its explorer', async () => {
    render(
      <MemoryRouter initialEntries={['/mcp']}>
        <SidebarNav />
        <LocationProbe />
      </MemoryRouter>,
    );

    const a2a = screen.getByTestId('sidebar-a2a');
    expect(a2a.textContent).toBe('A2A');
    expect(screen.getByTestId('sidebar-mcp').nextElementSibling).toBe(a2a);

    await userEvent.click(a2a);

    expect(screen.getByTestId('location').textContent).toBe('/a2a');
    expect(a2a.getAttribute('aria-pressed')).toBe('true');
  });
});
