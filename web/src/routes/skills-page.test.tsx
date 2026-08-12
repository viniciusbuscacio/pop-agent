// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillsResponse } from '@pop-agent/shared';
import { ApiError } from '../services/api';
import { SkillsPage } from './skills-page';
import { useNotificationsStore } from '../store/notifications';
import { useSkillsStore } from '../store/skills';

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
const distillations = vi.fn();
const retryDistillation = vi.fn();
const setEnabled = vi.fn();

vi.mock('../services/skills', () => ({
  skillsService: {
    list: () => list() as Promise<SkillsResponse>,
    distillations: () => distillations() as Promise<{ attempts: unknown[] }>,
    retryDistillation: (id: string) => retryDistillation(id) as Promise<unknown>,
    save: vi.fn(),
    approve: vi.fn(),
    approveRevision: vi.fn(),
    discardRevision: vi.fn(),
    restore: vi.fn(),
    remove: vi.fn(),
    setEnabled: (slug: string, enabled: boolean) => setEnabled(slug, enabled) as Promise<unknown>,
  },
}));

function skill(slug: string, name: string, body: string) {
  return { slug, name, description: `${name} description`, whenToUse: `when ${slug}`, body, source: 'user' as const };
}

const SKILLS: SkillsResponse = {
  skills: [skill('alpha', 'Alpha', 'The alpha procedure.'), skill('beta', 'Beta', 'The beta procedure.')],
  archived: [],
  distiller: { enabled: true, candidates: 0, published: 0, policyRejected: 0, reviewRejected: 0, systematicBlocking: false },
};

/** A link beside the pane, so the second skill is reached by navigating. */
function Harness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/skills/beta')}>
        go to beta
      </button>
      <button type="button" onClick={() => void useSkillsStore.getState().reload()}>
        reload the list
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
  distillations.mockReset();
  distillations.mockResolvedValue({ attempts: [] });
  retryDistillation.mockReset();
  retryDistillation.mockResolvedValue({});
  setEnabled.mockReset();
  useSkillsStore.setState({ skills: undefined, sourceFilter: 'all' });
  useNotificationsStore.setState({ toast: undefined });
  // A fresh array each time, like the real service: a reload genuinely changes
  // the identity of every skill object, which is the hazard the last test guards.
  list.mockImplementation(() => Promise.resolve({ ...SKILLS, skills: SKILLS.skills.map((s) => ({ ...s })) }));
});

afterEach(cleanup);

describe('the skills pane', () => {
  it('keeps routine activity out of the default Skills pane', async () => {
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Harness />
      </MemoryRouter>,
    );

    expect(screen.getByText('Select a skill')).toBeDefined();
    expect(distillations).not.toHaveBeenCalled();
  });

  it('summarizes routine activity and expands it only when requested', async () => {
    distillations.mockResolvedValue({
      attempts: [{
        id: 'attempt-one', chatId: 'chat-one', chatTitle: 'Deploy conversation',
        trigger: 'automatic', state: 'completed', outcome: 'nothing', warnings: [],
        startedAt: '2026-08-07T20:00:00.000Z', finishedAt: '2026-08-07T20:01:00.000Z',
        results: [], retryable: false,
      }],
    });

    render(
      <MemoryRouter initialEntries={['/skills/_activity']}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('routine-activity-summary')).toBeDefined());
    expect(screen.queryByText('Deploy conversation')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Show routine activity' }));
    expect(screen.getByText('Deploy conversation')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('keeps retry for a real failed attempt', async () => {
    distillations
      .mockResolvedValueOnce({
        attempts: [{
          id: 'attempt-failed', chatId: 'chat-one', chatTitle: 'Failed conversation',
          trigger: 'automatic', state: 'failed', outcome: 'failed', warnings: [],
          errorMessage: 'Provider timed out.', startedAt: '2026-08-07T20:00:00.000Z',
          finishedAt: '2026-08-07T20:01:00.000Z', results: [], retryable: true,
        }],
      })
      .mockResolvedValueOnce({ attempts: [] });

    render(
      <MemoryRouter initialEntries={['/skills/_activity']}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Failed conversation')).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(retryDistillation).toHaveBeenCalledWith('attempt-failed'));
  });

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

describe('the skills editor and a list refresh', () => {
  it('does not wipe what is being typed when the list reloads', async () => {
    // The hazard of following the route with an effect rather than a key: the
    // store hands out new objects on every reload, so an effect that depended
    // on the skill object -- instead of on its slug -- would clear the form
    // under the user for a refresh that changed nothing.
    render(
      <MemoryRouter initialEntries={['/skills/alpha']}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(valueOf('skill-name')).toBe('Alpha');
    });

    await userEvent.clear(screen.getByTestId('skill-name'));
    await userEvent.type(screen.getByTestId('skill-name'), 'Renamed but not saved');
    await userEvent.click(screen.getByRole('button', { name: 'reload the list' }));

    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
    });
    expect(valueOf('skill-name')).toBe('Renamed but not saved');
  });
});

describe('the skill enabled toggle', () => {
  it('posts the new state and keeps the switch on when the server agrees', async () => {
    setEnabled.mockResolvedValue({ ...SKILLS.skills[0], enabled: false });
    render(
      <MemoryRouter initialEntries={['/skills/alpha']}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('skill-enabled-toggle')).toBeDefined();
    });

    await userEvent.click(screen.getByTestId('skill-enabled-toggle'));

    await waitFor(() => {
      expect(setEnabled).toHaveBeenCalledWith('alpha', false);
    });
    expect(screen.getByTestId('skill-enabled-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('rolls back and notifies when the switch fails', async () => {
    setEnabled.mockRejectedValue(new ApiError('failed', 'failed', 500));
    render(
      <MemoryRouter initialEntries={['/skills/alpha']}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('skill-enabled-toggle')).toBeDefined();
    });

    await userEvent.click(screen.getByTestId('skill-enabled-toggle'));

    await waitFor(() => {
      expect(useNotificationsStore.getState().toast?.message).toBeDefined();
    });
    expect(screen.getByTestId('skill-enabled-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not show the toggle on a new skill', async () => {
    render(
      <MemoryRouter initialEntries={['/skills/new']}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('skill-slug')).toBeDefined();
    });
    expect(screen.queryByTestId('skill-enabled-toggle')).toBeNull();
  });
});
