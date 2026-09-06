/** Only navigate to the verified tailnet origin returned by network onboarding. */
export function secureSetupDestination(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net')
      || !url.hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || url.username !== '' || url.password !== '' || url.port !== ''
      || url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined;
    return `${url.origin}/setup`;
  } catch { return undefined; }
}

export const setupNavigation = {
  replace(destination: string): void { window.location.replace(destination); },
};
