import type { ProviderAuthInteraction } from '../../application/ports/agent-bridge.js';

/** Pop runs remotely: a browser-local callback cannot reach its OAuth listener. */
export function serverLoginInteraction(providerId: string, interaction: ProviderAuthInteraction): ProviderAuthInteraction {
  if (providerId !== 'openai-codex') return interaction;
  return {
    ...interaction,
    notify: event => interaction.notify(event),
    prompt: async prompt => {
      if (prompt.type === 'select') {
        if (prompt.options.some(option => option.id === 'device_code')) return 'device_code';
        if (prompt.options.some(option => option.id === 'browser')) {
          throw new Error('Code-based sign-in is unavailable. Update the pi runtime and try again.');
        }
      }
      return interaction.prompt(prompt);
    },
  };
}
