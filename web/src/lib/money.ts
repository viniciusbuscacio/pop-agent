/** USD for provider balances: the sign sits before the dollar mark. */
export function formatDollars(value: number): string {
  const abs = Math.abs(value);
  const body = `$${abs.toFixed(2)}`;
  return value < 0 ? `-${body}` : body;
}
