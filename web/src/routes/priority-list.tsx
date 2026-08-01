import type { ProviderStatusDTO, ProvidersResponse } from '@popy/shared';
import { t } from '../i18n';
import { providersService } from '../services/providers';
import { Button } from '../ui/controls';

/**
 * The provider priority list (popy.spec §15, fase 2): one numbered list the
 * user edits, #1 first.
 *
 * It is deliberately the only lever. The list IS the failover order, and its
 * head IS the global default -- a separate "default provider" control could
 * name one provider while the chain started with another, which is exactly
 * how the numbered order and the running answer drifted apart before.
 *
 * Lives in its own file so it can be tested: the settings page pulls in the
 * PWA registration virtual module, which no test environment can resolve.
 */
export function PriorityList({
  providers,
  onChanged,
}: {
  providers: ProviderStatusDTO[];
  onChanged: (response: ProvidersResponse) => void;
}) {
  const ordered = [...providers].sort((a, b) => a.order - b.order);

  function move(index: number, delta: number): void {
    const next = [...ordered];
    const moving = next[index];
    const target = next[index + delta];
    if (moving === undefined || target === undefined) return;
    next[index] = target;
    next[index + delta] = moving;
    void providersService
      .setOrder(next.map((entry) => entry.id))
      .then(onChanged)
      .catch(() => undefined);
  }

  function toggle(provider: ProviderStatusDTO): void {
    void providersService
      .setEnabled(provider.id, !provider.enabled)
      .then(onChanged)
      .catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="provider-priority">
      <ol className="flex flex-col gap-1.5">
        {ordered.map((provider, index) => (
          <li
            key={provider.id}
            data-testid={`provider-priority-row-${provider.id}`}
            className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2"
          >
            <span className="w-5 shrink-0 text-sm text-[var(--muted)]">{index + 1}</span>
            <span className={provider.enabled ? '' : 'text-[var(--muted)] line-through'}>
              {provider.name}
            </span>
            {/* Why this provider will not answer, when it will not: an
                unexplained skip in the chain reads as a broken list. */}
            {!provider.configured ? (
              <span className="text-xs text-[var(--muted)]">{t('provider.notConfigured')}</span>
            ) : null}
            {index === 0 && provider.enabled && provider.configured ? (
              <span
                data-testid="provider-priority-default"
                className="rounded bg-[var(--hover-overlay)] px-1.5 py-0.5 text-xs text-[var(--muted)]"
              >
                {t('provider.priority.default')}
              </span>
            ) : null}

            <span className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                className="px-2 py-1"
                data-testid={`provider-priority-up-${provider.id}`}
                aria-label={t('provider.priority.up', { name: provider.name })}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="px-2 py-1"
                data-testid={`provider-priority-down-${provider.id}`}
                aria-label={t('provider.priority.down', { name: provider.name })}
                disabled={index === ordered.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="px-2 py-1 text-xs"
                data-testid={`provider-priority-toggle-${provider.id}`}
                aria-pressed={provider.enabled}
                onClick={() => toggle(provider)}
              >
                {provider.enabled ? t('provider.priority.on') : t('provider.priority.off')}
              </Button>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-[var(--muted)]">{t('provider.priority.hint')}</p>
    </div>
  );
}
