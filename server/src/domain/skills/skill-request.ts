/**
 * Did the user ask, in so many words, for this to become a skill?
 *
 * This is a **separate path**, not a score (Vinicius, 08/08). The router blends
 * two rankings and something with a good enough total wins a slot; that is the
 * right shape for "which skill helps with this question" and the wrong shape
 * for "the user told me to do something". A ranking can lose narrowly. An
 * explicit request must never lose, so it is matched here, by phrase, and the
 * answer is yes or no.
 *
 * Matched over the user's own words only -- never over tool output, which is
 * where an injection would put the phrase.
 *
 * The list is phrases, not the single word "skill": asking *about* skills
 * ("quantas skills você tem?") is a question to answer, not an order to obey,
 * and the word alone cannot tell the two apart. Every phrase carries the verb
 * that makes it a request.
 */

/** Lowercased and stripped of accents, so "vira skill" matches "Vira Skill". */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * The request, in the languages Pop Agent is spoken to. Portuguese first because
 * that is what the user writes; English and Spanish because the rule is that
 * the trigger works in any language (docs/specs/Spec-Pop-General.md §8), and a phrase list is the
 * only half of the router that can honour that without a translation pass.
 */
const PHRASES = [
  // Portuguese
  'vira skill',
  'virar skill',
  'vire skill',
  'transforma isso numa skill',
  'transformar isso numa skill',
  'transforma em skill',
  'transformar em skill',
  'salva como skill',
  'salvar como skill',
  'guarda como skill',
  'guardar como skill',
  'cria uma skill',
  'criar uma skill',
  'cria skill disso',
  'faz uma skill',
  'fazer uma skill',
  // English
  'turn this into a skill',
  'turn it into a skill',
  'make this a skill',
  'make it a skill',
  'save this as a skill',
  'save it as a skill',
  'create a skill',
  'write a skill',
  'remember how to do this',
  // Spanish
  'conviertelo en una skill',
  'convierte esto en una skill',
  'crea una skill',
  'guardalo como skill',
  // French
  'transforme en competence',
  'cree une competence',
];

/**
 * The words that un-say a request, in the languages above, after folding
 * (so "não" is "nao"). A negated phrase is not a request: "não cria uma
 * skill" contains "cria uma skill". The check is deliberately cheap -- a
 * negation word in the run-up cancels that occurrence. A false negative here
 * costs one skipped queue jump; a false positive costs a skill written
 * against a stated wish, which is the worse error.
 */
const NEGATIONS = new Set(['nao', 'nunca', 'jamais', 'not', 'never', "don't", 'dont', 'no', 'jamas']);

/** How far before the phrase a negation still counts as aimed at it. */
const NEGATION_WINDOW = 40;

/** Whether this text is the user asking for a skill to be written. */
export function asksForSkill(text: string): boolean {
  const folded = fold(text);
  return PHRASES.some((phrase) => {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(phrase, from);
      if (at === -1) return false;
      if (!negated(folded, at)) return true;
      from = at + phrase.length;
    }
  });
}

/** A negation word in the characters just before the phrase cancels it. */
function negated(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - NEGATION_WINDOW), at);
  return before
    .split(/[^a-z']+/)
    .filter((word) => word.length > 0)
    .some((word) => NEGATIONS.has(word));
}
