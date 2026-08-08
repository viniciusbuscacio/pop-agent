// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillsResponse } from '@popy/shared';
import { SkillsPage } from './skills-page';

/** No jest-dom in this suite: values are read off the element, as elsewhere. */
function valueOf(testId: string): string {
  return (screen.getByTestId(testId) as HTMLInputElement | HTMLTextAreaElement).value;
}

/**
 * The explorer layout's one real hazard: the pane is a component that stays
 * mounted while the route under it changes.
 *
 * `SkillEditor` seeds every field with `useState(skill?.x)`, and React reads
 * that on mount only. Going from /skills/a to /skills/b is not a mount -- same
 * component, same position in the tree, same instance -- so without a `key` the
 * second skill you click leaves the first one's text on screen. Reported as
 * "the right pane freezes"; the worse half is silent, because saving would then
 * write the first skill's body back under the second skill's slug.
 */

const list = vi.fn();

vi.mock('../services/skills', () => ({
  skillsService: {
    list: () => list() as Promise<SkillsResponse>,
    save: vi.fn(),
    approve: vi.fn(),
    approveRevision: vi.fn(),
    discardRevision: vi.fn(),
    restore: vi.fn(),
    remove: vi.fn(),
  },
}));

function skill(slug: string, name: string, body: string) {
  return { slug, name, description: `${name} description`, whenToUse: `when ${slug}`, body, source: 'user' as const };
}

const SKILLS: SkillsResponse = {
  skills: [skill('alpha', 'Alpha', 'The alpha procedure.'), skill('beta', 'Beta', 'The beta procedure.')],
  archived: [],
  distiller: { enabled: true, pending: 0, revisions: 0 },
};

/** A link beside the pane, so the second skill is reached by navigating. */
function Harness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/skills/beta')}>
        go to beta
      </button>
      <Routes>
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/skills/:slug" element={<SkillsPage />} />
      </Routes>
    </>
  );
}

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue(SKILLS);
});

afterEach(cleanup);

describe('the skills pane', () => {
  it('shows the skill in the route', async () => {
    render(
      <MemoryRouter initialEntries={['/skills/alpha']}>
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(valueOf('skill-name')).toBe('Alpha');
    });
  });

  it('follows the route to a second skill instead of freezing on the first', async () => {
    render(
      <MemoryRouter initialEntries={['/skills/alpha']}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(valueOf('skill-name')).toBe('Alpha');
    });

    await userEvent.click(screen.getByRole('button', { name: 'go to beta' }));

    await waitFor(() => {
      expect(valueOf('skill-name')).toBe('Beta');
    });
    expect(valueOf('skill-slug')).toBe('beta');
    expect(valueOf('skill-body')).toBe('The beta procedure.');
  });

  it('does not carry an edit in progress across to the next skill', async () => {
    // The silent half of the same bug: text typed into the first skill must not
    // still be in the box under the second one's slug, one Save away from
    // overwriting it.
    render(
      <MemoryRouter initialEntries={['/skills/alpha']}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(valueOf('skill-name')).toBe('Alpha');
    });

    await userEvent.clear(screen.getByTestId('skill-name'));
    await userEvent.type(screen.getByTestId('skill-name'), 'Half-written edit');
    await userEvent.click(screen.getByRole('button', { name: 'go to beta' }));

    await waitFor(() => {
      expect(valueOf('skill-name')).toBe('Beta');
    });
  });
});
