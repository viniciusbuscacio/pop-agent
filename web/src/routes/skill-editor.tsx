import { useState } from 'react';
import type { SkillDTO } from '@popy/shared';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { skillsService } from '../services/skills';
import { Button, Card, TextArea, TextField } from '../ui/controls';

/**
 * The skill form, in its own module rather than inside the settings page.
 *
 * Both the Skills pane and Settings → Skills render it, and while it lived in
 * `settings-page.tsx` the Skills route had to import that whole page to get at
 * it -- along with the PWA update service, and the virtual module that only
 * exists when vite-plugin-pwa is loaded. A test of the Skills pane failed on a
 * dependency the Skills pane does not have.
 *
 * The fields are seeded on mount, so callers must key it on whatever it is
 * editing. Nothing in here can enforce that, which is why both call sites say
 * so out loud.
 */
export function SkillEditor({ skill, onDone }: { skill: SkillDTO | undefined; onDone: () => void }) {
  const [slug, setSlug] = useState(skill?.slug ?? '');
  const [name, setName] = useState(skill?.name ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [whenToUse, setWhenToUse] = useState(skill?.whenToUse ?? '');
  const [body, setBody] = useState(skill?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const isNew = skill === undefined;
  const canSave = slug.trim().length > 0 && name.trim().length > 0 && !busy;

  async function save(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await skillsService.save({ slug, name, description, whenToUse, body });
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <button
        type="button"
        data-testid="skill-back"
        onClick={onDone}
        className="self-start text-sm text-[var(--accent)]"
      >
        ← {t('skills.back')}
      </button>

      <TextField
        id="skill-slug"
        data-testid="skill-slug"
        label={t('skills.field.slug')}
        value={slug}
        disabled={!isNew}
        onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
      />
      <TextField
        id="skill-name"
        data-testid="skill-name"
        label={t('skills.field.name')}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        id="skill-description"
        label={t('skills.field.description')}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <TextField
        id="skill-when"
        label={t('skills.field.whenToUse')}
        hint={t('skills.field.whenToUseHint')}
        value={whenToUse}
        onChange={(event) => setWhenToUse(event.target.value)}
      />
      <TextArea
        id="skill-body"
        data-testid="skill-body"
        label={t('skills.field.body')}
        rows={10}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="font-mono text-sm"
      />

      {error !== undefined ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" data-testid="skill-save" disabled={!canSave} onClick={() => void save()}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </Card>
  );
}
