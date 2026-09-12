// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskFormPage } from './task-form-page';
vi.mock('../services/tasks', () => ({ tasksService: { get: vi.fn(async () => ({ title: 'Existing task', prompt: 'Original prompt', scheduleKind: 'interval', intervalMinutes: 90, notifyOnFinish: false, archiveChat: true, runOnlyWithNewMessages: true })) } }));
afterEach(cleanup);
it('opens a blank task when New task is clicked from an existing editor', async () => {
  render(<MemoryRouter initialEntries={['/tasks/existing']}>
    <Link to="/tasks/new">New task</Link>
    <Routes><Route path="/tasks/new" element={<TaskFormPage />} /><Route path="/tasks/:taskId" element={<TaskFormPage />} /></Routes>
  </MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('task-title')).toHaveProperty('value', 'Existing task'));
  await userEvent.click(screen.getByRole('link', { name: 'New task' }));
  await waitFor(() => expect(screen.getByTestId('task-title')).toHaveProperty('value', ''));
  expect(screen.getByTestId('task-prompt')).toHaveProperty('value', '');
  expect(screen.queryByTestId('task-interval')).toBeNull();
  expect(screen.getByTestId('task-save')).toHaveProperty('disabled', true);
});
