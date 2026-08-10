import { describe, expect, it } from 'vitest';
import type { SkillCandidate } from './distillation.js';
import { autoApproveSkill, hasOperationalImpact } from './auto-skill-policy.js';

const recipe: SkillCandidate = {
  slug: 'banana-farofa',
  name: 'Make banana farofa',
  description: 'Make a simple banana farofa',
  whenToUse: 'When the user asks for banana farofa',
  body: 'Brown the banana, add cassava flour, season, and serve.',
};

const deployment: SkillCandidate = {
  slug: 'deploy-blog',
  name: 'Deploy the blog',
  description: 'Publish the blog to its server',
  whenToUse: 'When a release needs deployment',
  body: 'Run `git push` and restart the service.',
};

describe('auto-skill approval policy', () => {
  it('never approves in disabled mode', () => {
    expect(autoApproveSkill('disabled', { candidate: recipe, hasExternalContent: false, revision: false })).toBe(false);
  });

  it('approves a low-impact first-party procedure in medium mode', () => {
    expect(autoApproveSkill('medium', { candidate: recipe, hasExternalContent: false, revision: false })).toBe(true);
  });

  it('holds external, operational and revision candidates in medium mode', () => {
    expect(autoApproveSkill('medium', { candidate: recipe, hasExternalContent: true, revision: false })).toBe(false);
    expect(autoApproveSkill('medium', { candidate: deployment, hasExternalContent: false, revision: false })).toBe(false);
    expect(autoApproveSkill('medium', { candidate: recipe, hasExternalContent: false, revision: true })).toBe(false);
  });

  it('approves every candidate in full mode after the baseline guard', () => {
    expect(autoApproveSkill('full', { candidate: deployment, hasExternalContent: true, revision: true })).toBe(true);
  });

  it('recognises sensitive and destructive procedures as operational', () => {
    expect(hasOperationalImpact({ ...recipe, body: 'Upload the API token to the endpoint.' })).toBe(true);
    expect(hasOperationalImpact(recipe)).toBe(false);
  });
});
