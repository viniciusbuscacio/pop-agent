import type { MessageDelivery } from '@pop-agent/shared';
import { Pressable } from './controls';
import { t } from '../i18n';

/**
 * Slash commands in the composer (Vinicius, 31/07), built on the @-mention
 * pattern: a trigger regex against the text, a menu above the textarea, a
 * pick that ACTS instead of transforming the text. The command list is
 * static, so unlike mentions there is nothing to fetch.
 */

export interface SlashCommand {
  name: string;
  description: string;
}

/** /queue is transport syntax, not part of the words stored or sent to the model. */
export function parseComposerDelivery(text: string): {
  text: string;
  delivery: MessageDelivery;
} {
  const trimmed = text.trim();
  const match = /^\/queue(?:\s+([\s\S]*))?$/i.exec(trimmed);
  return match === null
    ? { text: trimmed, delivery: 'steer' }
    : { text: (match[1] ?? '').trim(), delivery: 'follow_up' };
}

/** Composer commands: actions plus /queue, which prefixes a follow-up message. */
export function slashCommands(): SlashCommand[] {
  return [
    { name: 'new', description: t('chat.slashNew') },
    { name: 'model', description: t('chat.slashModel') },
    { name: 'queue', description: t('chat.slashQueue') },
    { name: 'help', description: t('chat.slashHelp') },
  ];
}

const MENU_CLASS =
  'absolute bottom-full left-0 z-20 mb-1 flex max-h-56 w-72 flex-col overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg';

function optionClass(active: boolean): string {
  // shrink-0: inside a max-h flex-col the rows must overflow (and scroll),
  // never squeeze -- hundreds of catalog models would shrink to dashes.
  return `flex shrink-0 items-baseline gap-2 truncate px-3 py-1.5 text-left ${
    active ? 'bg-[var(--hover-overlay)]' : ''
  }`;
}

export function SlashMenu({
  options,
  active,
  onPick,
}: {
  options: SlashCommand[];
  active: number;
  onPick: (command: SlashCommand) => void;
}) {
  return (
    <div data-testid="slash-menu" className={MENU_CLASS}>
      {options.map((command, index) => (
        <Pressable
          key={command.name}
          type="button"
          data-testid="slash-option"
          onClick={() => onPick(command)}
          className={optionClass(index === active)}
        >
          <span>/{command.name}</span>
          <span className="truncate text-xs text-[var(--muted)]">{command.description}</span>
        </Pressable>
      ))}
    </div>
  );
}

/** One pickable model: the pair is the identity (pop-agent.spec §15). */
export interface ModelChoice {
  provider: string;
  model: string;
  label: string;
  providerLabel?: string;
  providerOrder?: number;
}

/** The /model submenu: same look, but options are (provider, model) pairs. */
export function ModelMenu({
  models,
  active,
  activeProvider,
  activeModel,
  onPick,
}: {
  models: ModelChoice[];
  active: number;
  activeProvider: string;
  activeModel: string;
  onPick: (choice: ModelChoice) => void;
}) {
  const DEFAULT: ModelChoice = { provider: '', model: '', label: t('chat.defaultModel') };
  const choices = [DEFAULT, ...models];
  return (
    <div data-testid="slash-menu" className={MENU_CLASS}>
      {choices.map((choice, index) => {
        const isCurrent =
          choice.provider === activeProvider && choice.model === activeModel;
        return (
          <Pressable
            key={choice.model === '' ? '__default' : `${choice.provider}/${choice.model}`}
            type="button"
            data-testid="slash-option"
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => onPick(choice)}
            className={optionClass(index === active)}
          >
            <span className="truncate">{choice.label}</span>
            {isCurrent ? (
              <span className="ml-auto shrink-0 text-xs text-[var(--accent)]">✓</span>
            ) : null}
          </Pressable>
        );
      })}
    </div>
  );
}
