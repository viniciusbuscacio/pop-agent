/**
 * A skill: a named piece of know-how the agent pulls in when it is relevant
 * (popy.spec §8, the Skill Router). Description and `whenToUse` are the routing
 * signal -- matched against what the user asked -- and `body` is the markdown
 * that joins the prompt when the skill is selected.
 */
export interface Skill {
  /** Stable slug, and the file name without extension. */
  slug: string;
  name: string;
  description: string;
  /** When this skill should fire, in the author's words. Routed on. */
  whenToUse: string;
  body: string;
  /** True for the skills Popy ships; false for the user's own. */
  builtin: boolean;
}

/** A skill the router picked, with why. */
export interface SelectedSkill {
  skill: Skill;
  score: number;
}
