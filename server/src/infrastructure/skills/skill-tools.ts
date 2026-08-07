import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { SkillsError, type SkillsRepo } from '../../application/ports/skills-repo.js';
import { scrubSecrets } from '../memory/user-memory-tools.js';

/**
 * The hand behind "vira skill" (popy.spec §8, auto-skill fase b): when the user
 * asks for it in the middle of a conversation, the agent distils what just
 * worked into a skill and writes it here.
 *
 * There is no slash command and no button, by decision: the request arrives in
 * whatever language the user happens to be speaking, so the trigger is the
 * router surfacing the `skill-creator` skill, and this is the hand that skill
 * reaches for. The background distiller (fase c) will call the same tool with
 * the same prompt; only who says "now" changes.
 *
 * What it writes is `source: 'auto'` -- distilled, not hand-written -- and it
 * lands in `skills/auto/<slug>/SKILL.md`, where the garbage collector can find
 * it later. Editing it in Settings promotes it to `user` and the collector
 * stops looking, which is the vault's rule, not this tool's.
 *
 * Three things it deliberately refuses:
 *
 * - **An existing slug.** Rewriting a skill that already works is the update
 *   path, and the update path is supposed to arrive as a reviewable diff with
 *   the old version still live (§6). Until that exists, silently replacing a
 *   skill would be the update path with the review missing.
 * - **Secrets.** A skill body is distilled from a conversation, and
 *   conversations contain pasted keys. Same scrub the user-memory document
 *   gets, for the same reason: this text is going to be replayed into future
 *   prompts.
 * - **A tainted turn.** Enforced in the taint guard rather than here, because
 *   that is where taint lives -- see `tool-taint.ts`. A skill is the one thing
 *   an injected page would most like to write, since a skill comes back on its
 *   own in every future conversation the router thinks is relevant.
 */

type DefineTool = (tool: ToolDefinition) => ToolDefinition;

const MAX_BODY = 8_000;
const MAX_LISTED = 60;

function text(body: string): { content: [{ type: 'text'; text: string }]; details: undefined } {
  return { content: [{ type: 'text', text: body }], details: undefined };
}

export function buildSkillTools(
  defineTool: DefineTool,
  skills: SkillsRepo,
  /**
   * The user's answer to "should a skill I distil go live on its own?"
   * (popy.spec §8). Read per call, not captured: flipping it in Settings takes
   * effect on the next skill, not on the next restart.
   */
  autoApprove: () => boolean = () => false,
): ToolDefinition[] {
  const list = defineTool({
    name: 'skills_list',
    label: 'List your skills',
    description:
      'Lists the skills you already have: id, name, where each came from (builtin, auto, user) and ' +
      'when it should fire. Read this before writing a new skill, so you extend what exists instead ' +
      'of creating a near-duplicate.',
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

  const write = defineTool({
    name: 'skill_write',
    label: 'Write a new skill',
    description:
      'Distils what this conversation taught into a new skill, so it comes back automatically the ' +
      'next time it is relevant. Use it when the user asks for it ("vira skill", "turn this into a ' +
      'skill", and the same request in any other language). Procedures only: a fact about the user ' +
      'belongs in memory_user_update instead. The id must be new — this tool does not overwrite an ' +
      'existing skill.',
    promptSnippet:
      'skill_write(slug, name, description, whenToUse, body) — turn what worked into a reusable skill',
    parameters: Type.Object({
      slug: Type.String({ description: 'A new id: lowercase letters, numbers and dashes' }),
      name: Type.String({ description: 'A short human name' }),
      description: Type.String({ description: 'One line: what this skill does' }),
      whenToUse: Type.String({
        description:
          'The routing signal — the situations that should bring this skill back, in the words the ' +
          'user would actually type, in their language',
      }),
      body: Type.String({ description: 'The procedure itself, as markdown' }),
    }),
    execute: (_id, params) => {
      const input = params as {
        slug: string;
        name: string;
        description: string;
        whenToUse: string;
        body: string;
      };

      const existing = skills.get(input.slug);
      if (existing !== undefined) {
        return Promise.resolve(
          text(
            `A skill with the id "${input.slug}" already exists (${existing.name}, ${existing.source}). ` +
              'Pick a different id for a genuinely new skill. To change that one, tell the user to edit ' +
              'it on the Skills screen — you cannot overwrite a skill that is already working.',
          ),
        );
      }

      const live = autoApprove();
      try {
        const skill = skills.write({
          slug: input.slug,
          name: input.name,
          description: input.description,
          whenToUse: input.whenToUse,
          body: scrubSecrets(input.body).slice(0, MAX_BODY),
          source: 'auto',
          pending: !live,
        });
        return Promise.resolve(
          text(
            live
              ? `Saved the skill "${skill.name}" (${skill.slug}), and it is live: it will come back on ` +
                'its own when the router judges a future message relevant to it. Tell the user it ' +
                'exists and that they can edit or delete it on the Skills screen.'
              : `Saved the skill "${skill.name}" (${skill.slug}). It is NOT active yet: it waits on the ` +
                'Skills screen until the user accepts it. Tell them it is there for review — do not ' +
                'claim you will use it from now on, because you will not until they say yes.',
          ),
        );
      } catch (error) {
        // A bad slug is the common case; the vault's message already says what
        // is wrong in words the model can act on, so it is passed through.
        if (error instanceof SkillsError) return Promise.resolve(text(`Could not save: ${error.message}`));
        throw error;
      }
    },
  });

  return [list, write];
}
