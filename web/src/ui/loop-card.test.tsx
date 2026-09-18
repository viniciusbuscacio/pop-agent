// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolCallDTO } from '@pop-agent/shared';
import { LoopCard } from './loop-card';

afterEach(cleanup);
const progress = 'Loop: plan\nLoop: worker\nLoop: review\n';
const tool = (detail: string, status: ToolCallDTO['status'] = 'output'): ToolCallDTO => ({ name: 'run_loop', detail, status });
const result = (status: string, corrections = 0) => JSON.stringify({ status, summary: 'Actual review summary', corrections, evidence: ['README.md inspected', 'vitest: 12 passed'], handoff: { patchPath: '/private/change.patch' } });
const stage = (phase: string) => screen.getByTestId(`loop-stage-${phase}`).textContent;

describe('Loop card', () => {
  it('shows the three roles while phases and correction cycles stream, without invented time', () => {
    const { rerender } = render(<LoopCard tool={tool('')} interrupted={false} />);
    expect(stage('plan')).toBe('Planner/Reviewer · PlanningPending');
    expect(stage('worker')).toBe('Worker · ExecutionPending');
    expect(stage('review')).toBe('Planner/Reviewer · ReviewPending');
    rerender(<LoopCard tool={tool('Loop: plan\n')} interrupted={false} />);
    expect(stage('plan')).toContain('Active');
    expect(screen.getByTestId('loop-card').querySelectorAll('.animate-spin')).toHaveLength(1);
    rerender(<LoopCard tool={tool('Loop: plan\nLoop: worker\n')} interrupted={false} />);
    expect(stage('plan')).toContain('Completed');
    expect(stage('worker')).toContain('Active');
    rerender(<LoopCard tool={tool(progress)} interrupted={false} />);
    expect(stage('worker')).toContain('Worker round finished');
    expect(stage('review')).toContain('Active');
    rerender(<LoopCard tool={tool(`${progress}Loop: worker (correction 1)\n`)} interrupted={false} />);
    expect(stage('worker')).toContain('Active');
    expect(stage('review')).toContain('Pending');
    expect(screen.getByText('Corrections: 1')).toBeTruthy();
    expect(screen.getByTestId('loop-card').textContent).not.toMatch(/duration|elapsed|seconds/i);
  });

  it.each([
    ['approved', 'Approved'], ['blocked', 'Blocked'], ['limit', 'Correction limit reached'],
    ['failed', 'Failed'], ['cancelled', 'Interrupted'],
  ])('uses the returned %s outcome, not generic tool done', (status, label) => {
    render(<LoopCard tool={tool(progress + result(status, 2), 'done')} interrupted={false} />);
    expect(screen.getByTestId('loop-outcome').textContent).toBe(label);
    expect(screen.getByTestId('loop-card').querySelector('.animate-spin')).toBeNull();
    expect(stage('review')).toContain(status === 'failed' ? 'Error' : status === 'cancelled' ? 'Interrupted' : 'Completed');
    expect(screen.getByText('Corrections: 2')).toBeTruthy();
  });

  it('reads loaded final-only results and exposes escaped evidence and the full handoff', async () => {
    const detail = result('approved').replace('Actual review summary', '<img src=x onerror=alert(1)>');
    render(<LoopCard tool={tool(detail, 'done')} interrupted={false} />);
    const toggle = screen.getByRole('button', { name: 'Loop Approved' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('loop-output')).toBeNull();
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeTruthy();
    expect(screen.getByText('README.md inspected')).toBeTruthy();
    expect(screen.getByTestId('loop-output').textContent).toContain('/private/change.patch');
    expect(screen.getByTestId('loop-card').querySelector('img')).toBeNull();
    expect(stage('plan')).toContain('Completed');
    expect(screen.getByTestId('loop-card').className).toContain('min-w-0');
    expect(screen.getByTestId('loop-output').className).toContain('overflow-x-auto');
    expect(screen.getByTestId('loop-output').className).toContain('[overflow-wrap:anywhere]');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('never treats generic done as phase success or approval', () => {
    render(<LoopCard tool={tool(progress, 'done')} interrupted={false} />);
    expect(screen.getByTestId('loop-outcome').textContent).toBe('Outcome unknown');
    expect(stage('review')).toContain('Unconfirmed');
    expect(screen.getByTestId('loop-card').querySelector('.animate-spin')).toBeNull();
  });

  it.each([true, false])('stops the active phase for interruption=%s or a tool error', (interrupted) => {
    render(<LoopCard tool={tool('Loop: plan\nLoop: worker\n', interrupted ? 'output' : 'error')} interrupted={interrupted} />);
    expect(stage('worker')).toContain(interrupted ? 'Interrupted' : 'Error');
    expect(stage('review')).toContain('Pending');
    expect(screen.getByTestId('loop-card').querySelector('.animate-spin')).toBeNull();
  });

  it('reads old concatenated progress, argument previews and appended final JSON', () => {
    const detail = '{"repository":"/repo","task":"implement"}\nLoop: planLoop: workerLoop: reviewLoop: workerLoop: review' + result('blocked', 1);
    render(<LoopCard tool={tool(detail, 'done')} interrupted={false} />);
    expect(screen.getByTestId('loop-outcome').textContent).toBe('Blocked');
    expect(stage('review')).toContain('Completed');
    expect(screen.getByText('Corrections: 1')).toBeTruthy();
  });

  it('reads progress after the bridge truncates a long argument preview', () => {
    render(<LoopCard tool={tool('{"repository":"/repo","task":"' + 'x'.repeat(380) + '…\nLoop: planLoop: worker')} interrupted={false} />);
    expect(stage('worker')).toContain('Active');
  });

  it.each([
    '{broken', result('unexpected'), '{"status":"approved"}',
    '{"repository":"/repo","task":"Loop: worker approved"}\n',
    'Unknown: Loop: planLoop: worker', 'Loop: worker unknown format',
    '<script>alert("approved")</script>',
  ])('leaves unknown/malformed detail as plain text: %s', async (detail) => {
    render(<LoopCard tool={tool(detail, 'done')} interrupted={false} />);
    expect(screen.getByTestId('loop-outcome').textContent).toBe('Outcome unknown');
    expect(stage('plan')).toContain('Pending');
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('loop-output').textContent).toBe(detail);
    expect(screen.getByTestId('loop-card').querySelector('script')).toBeNull();
  });
  it('shows a safe phase, code and reason without implying objective completion, including final-only history', () => {
    const failure = { phase: 'review', code: 'snapshot_failed', reason: 'Loop evidence snapshot failed; parent inspection is required.' };
    render(<LoopCard tool={tool(JSON.stringify({ status: 'failed', corrections: 2, summary: failure.reason, evidence: ['Prior evidence'], failure }), 'done')} interrupted={false} />);
    expect(screen.getByTestId('loop-failure').textContent).toBe(`review · snapshot_failed: ${failure.reason}`);
    expect(stage('worker')).toContain('Worker round finished');
    expect(stage('review')).toContain('Error');
    expect(screen.getByTestId('loop-card').textContent).not.toContain('objective completed');
    expect(screen.getByTestId('loop-card').querySelector('.animate-spin')).toBeNull();
  });

});
