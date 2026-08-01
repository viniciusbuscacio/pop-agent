/** Short relative time for the chat list ("now", "5m", "3h", "2d", "12 Mar"). */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${String(days)}d`;

  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * A short absolute stamp for something that has not happened yet ("today
 * 14:30", "12 Mar 09:00"). Relative time is the wrong shape for a schedule:
 * "in 5h" answers a different question than "at 06:00".
 */
export function shortDateTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const date = new Date(then);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const sameDay = new Date(now).toDateString() === date.toDateString();
  if (sameDay) return time;

  const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${day} ${time}`;
}
