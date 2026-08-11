/**
 * Re-enable live-answer following only when the reader moves toward the end
 * and actually reaches it. Merely being near the end is not enough: while a
 * finger starts dragging toward older content, iOS can report the old bottom
 * position before applying the native scroll.
 */
export function shouldResumeFollowing(
  previousScrollTop: number,
  currentScrollTop: number,
  distanceFromBottom: number,
  tolerance: number,
): boolean {
  return currentScrollTop > previousScrollTop && distanceFromBottom < tolerance;
}
