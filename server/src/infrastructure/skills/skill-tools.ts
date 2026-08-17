import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { SkillsRepo } from '../../application/ports/skills-repo.js';

/**
 * The agent's read-only view of its own skills (docs/specs/Spec-Pop-General.md §8).
 *
 * There used to be a `skill_write` beside it -- fase (b), "vira skill" answered
 * live, mid-conversation. It is gone (1.66). Writing a skill during a turn put
 * skills in front of the user on turns that were not about skills: the
 * `skill-creator` skill that carried the trigger was routed into nine of
 * sixteen turns of a conversation about names, every one on the semantic leg
 * alone, and its procedure told the model to say what it had decided. Creation
 * belongs to the background distiller now, where nobody has to read about it.
 *
 * Listing stays, and is not a consolation prize: "which skills do you have?" is
 * an ordinary question, and answering it needs no power to change anything.
 */

type DefineTool = (tool: ToolDefinition) => ToolDefinition;

const MAX_LISTED = 60;

function text(body: string): { content: [{ type: 'text'; text: string }]; details: undefined } {
  return { content: [{ type: 'text', text: body }], details: undefined };
}

export function buildSkillTools(defineTool: DefineTool, skills: SkillsRepo): ToolDefinition[] {
  const list = defineTool({
    name: 'skills_list',
    label: 'List your skills',
    description:
      'Lists the skills you already have: id, name, where each came from (builtin, auto, user) and ' +
      'when it should fire. Use it to answer questions about what you can do. You cannot write a ' +
      'skill -- Pop Agent distils those from finished conversations in the background.',
    promptSnippet: 'skills_list() — the skills you already have',
    parameters: Type.Object({}),
    execute: () => {
      const all = skills.all();
      if (all.length === 0) return Promise.resolve(text('(no skills yet)'));
      const lines = all
        .slice(0, MAX_LISTED)
        .map((skill) => `${skill.slug} [${skill.source}] ${skill.name} — ${skill.whenToUse}`);
      return Promise.resolve(text(lines.join('\n')));
    },
  });

return [list];
}
