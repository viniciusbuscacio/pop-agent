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

/** v1: new chat, model picker (a submenu), and help (the menu itself). */
export function slashCommands(): SlashCommand[] {
  return [
    { name: 'new', description: t('chat.slashNew') },
    { name: 'model', description: t('chat.slashModel') },
    { name: 'help', description: t('chat.slashHelp') },
  ];
}

export function SlashMenu({
  options,
  onPick,
}: {
  options: SlashCommand[];
  onPick: (command: SlashCommand) => void;
}) {
  return (
    <div
      data-testid="slash-menu"
      className="absolute bottom-full left-0 z-20 mb-1 flex max-h-56 w-72 flex-col overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--panel-bg)] py-1 text-sm shadow-lg"
    >
      {options.map((command) => (
        <button
          key={command.name}
          type="button"
          data-testid="slash-option"
          onClick={() => onPick(command)}
          className="flex items-baseline gap-2 truncate px-3 py-1.5 text-left hover:bg-[var(--hover-overlay)]"
        >
          <span>/{command.name}</span>
          <span className="truncate text-xs text-[var(--muted)]">{command.description}</span>
        </button>
      ))}
    </div>
  );
}
