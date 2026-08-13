// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillsResponse } from '@pop-agent/shared';
import { ChatList } from './chat-list';
import { useSkillsStore } from '../store/skills';

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

vi.mock('../services/chats', () => ({
  chatsService: {
    list: () => Promise.resolve({ chats: [] }),
    messages: () => Promise.resolve({ messages: [] }),
  },
}));

// ShellFooter subscribes on mount. This suite exercises the Skills list, not
// the connection monitor, so a real fetch would leak out of the test process.
vi.mock('../services/health', () => {
  const healthy = { kind: 'ok' as const };
  return {
    healthMonitor: {
      subscribe: () => () => undefined,
      // useSyncExternalStore requires referentially stable snapshots.
      getState: () => healthy,
    },
  };
});

const SKILLS: SkillsResponse = {
  skills: [
    {
      slug: 'personal',
      name: 'Personal skill',
      description: 'mine',
      whenToUse: 'when personal',
      body: 'body',
      source: 'user',
    },
    {
      slug: 'desktop-window-confirm-prompt-fix',
      name: 'Learned skill',
      description: 'auto',
      whenToUse: 'when the native confirmation callback is missing',
      body: 'body',
      source: 'auto',
    },
    {
      slug: 'waiting',
      name: 'Waiting skill',
      description: 'pending',
      whenToUse: 'when waiting',
      body: 'body',
      source: 'auto',
    },
    {
      slug: 'core',
      name: 'Core skill',
      description: 'builtin',
      whenToUse: 'when core',
      body: 'body',
      source: 'builtin',
    },
  ],
  archived: [],
  distiller: { enabled: true, candidates: 0, published: 0, policyRejected: 0, reviewRejected: 0, systematicBlocking: false },
};

function renderSkillsList() {
  return render(
    <MemoryRouter initialEntries={['/skills']}>
      <ChatList />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue({ ...SKILLS, skills: SKILLS.skills.map((entry) => ({ ...entry })) });
  useSkillsStore.setState({ skills: undefined, sourceFilter: 'all' });
});

afterEach(cleanup);

describe('the skills sidebar filter', () => {
  it('does not expose internal learning activity', async () => {
    renderSkillsList();
    await waitFor(() => expect(screen.getAllByTestId('skill-row')).toHaveLength(4));

    expect(screen.queryByTestId('skills-activity-link')).toBeNull();
  });

  it('filters the list by source', async () => {
    renderSkillsList();
    await waitFor(() => {
      expect(screen.getAllByTestId('skill-row')).toHaveLength(4);
    });

    await userEvent.click(screen.getByTestId('skills-source-filter'));
    await userEvent.click(screen.getByTestId('skills-source-filter-auto'));

    await waitFor(() => {
      expect(screen.getAllByTestId('skill-row')).toHaveLength(2);
    });
    expect(screen.getByText('Learned skill')).toBeDefined();
  });

  it('finds skills by slug and routing trigger', async () => {
    renderSkillsList();
    await waitFor(() => expect(screen.getAllByTestId('skill-row')).toHaveLength(4));

    const filter = screen.getByTestId('list-filter');
    await userEvent.type(filter, 'desktop-window-confirm-prompt-fix');
    await waitFor(() => expect(screen.getAllByTestId('skill-row')).toHaveLength(1));
    expect(screen.getByText('Learned skill')).toBeDefined();

    await userEvent.clear(filter);
    await userEvent.type(filter, 'native confirmation callback');
    await waitFor(() => expect(screen.getAllByTestId('skill-row')).toHaveLength(1));
    expect(screen.getByText('Learned skill')).toBeDefined();
  });

  it('composes the source filter with text search', async () => {
    renderSkillsList();
    await waitFor(() => {
      expect(screen.getAllByTestId('skill-row')).toHaveLength(4);
    });

    await userEvent.type(screen.getByTestId('list-filter'), 'Personal');
    await waitFor(() => {
      expect(screen.getAllByTestId('skill-row')).toHaveLength(1);
    });

    await userEvent.click(screen.getByTestId('skills-source-filter'));
    await userEvent.click(screen.getByTestId('skills-source-filter-builtin'));

    await waitFor(() => {
      expect(screen.queryByTestId('skill-row')).toBeNull();
    });
  });

  it('has no manual-approval filter', async () => {
    renderSkillsList();
    await waitFor(() => expect(screen.getByTestId('skills-source-filter')).toBeTruthy());

    await userEvent.click(screen.getByTestId('skills-source-filter'));
    expect(screen.queryByTestId('skills-source-filter-pending')).toBeNull();
  });
});
