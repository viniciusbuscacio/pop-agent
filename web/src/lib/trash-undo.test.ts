// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GarbageEntryDTO } from '@pop-agent/shared';
import { useFilesStore } from '../store/files';
import { useNotificationsStore } from '../store/notifications';
import { useTrashUndo } from './trash-undo';

const restore = vi.hoisted(() => vi.fn());
vi.mock('../services/artifacts', () => ({
  trashService: { restore },
}));

function entry(name: string, originalPath: string, kind: 'file' | 'dir'): GarbageEntryDTO {
  return {
    name,
    originalPath,
    kind,
    size: 0,
    deletedAt: '2026-08-09T00:00:00.000Z',
    purgeAt: '2026-09-08T00:00:00.000Z',
  };
}

beforeEach(() => {
  restore.mockReset();
  restore.mockResolvedValue(undefined);
  useNotificationsStore.setState({ toast: undefined });
  useFilesStore.setState({ tree: [], reload: vi.fn().mockResolvedValue(undefined) });
});

describe('Trash undo', () => {
  it('restores a selected parent before a separately deleted child', async () => {
    const { result } = renderHook(() => useTrashUndo());
    act(() => {
      result.current([
        entry('report.pdf', 'folder/report.pdf', 'file'),
        entry('folder', 'folder', 'dir'),
      ]);
    });

    const action = useNotificationsStore.getState().toast?.action;
    expect(action?.label).toBe('Restore');
    await act(async () => action?.run());

    expect(restore.mock.calls.map(([name]) => name)).toEqual(['folder', 'report.pdf']);
    expect(useNotificationsStore.getState().toast?.message).toBe('2 items restored.');
  });
});
