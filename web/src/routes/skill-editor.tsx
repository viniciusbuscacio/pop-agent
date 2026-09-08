import { AgentPageHeader } from '../ui/agent-page-header';
import { useEffect, useState } from 'react';
import type { SkillDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { skillsService } from '../services/skills';
import { skillEnabled, useSkillsStore } from '../store/skills';
import { useNotificationsStore } from '../store/notifications';
import { BackButton, Button, Card, TextArea, TextField, SwitchField } from '../ui/controls';

/**
 * The skill form, in its own module rather than inside the settings page.
 *
 * Both the Skills pane and Settings → Skills render it, and while it lived in
 * `settings-page.tsx` the Skills route had to import that whole page to get at
 * it -- along with the PWA update service, and the virtual module that only
 * exists when vite-plugin-pwa is loaded. A test of the Skills pane failed on a
 * dependency the Skills pane does not have.
 *
 * It follows the route the way the chat and the task form do: one effect on the
 * identity of the thing being edited, which fills the fields and clears the
 * ones that belong to the previous edit. `chat-page` runs `openChat(chatId)`
 * on `[chatId]` and resets its own scroll state; `task-form-page` loads the
 * task on `[taskId]` and fills the form. Same shape here, on `[identity]`.
 *
 * That identity is the slug, and the slug is the only id a skill has or needs:
 * it names the folder in the vault and keys `skill_usage`, `skill_embeddings`
 * and `skill_revisions`. It cannot change after creation either -- the field is
 * disabled outside "new" -- which is exactly what makes it usable here.
 *
 * The effect depends on the identity and NOT on the `skill` object, and that is
 * deliberate: the store hands out a new array on every reload, so depending on
 * the object would wipe half-typed text the moment anything refreshed the list.
 */
export function SkillEditor({ skill, onDone }: { skill: SkillDTO | undefined; onDone: () => void }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [whenToUse, setWhenToUse] = useState('');
  const [body, setBody] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const upsertSkill = useSkillsStore((state) => state.upsertSkill);
  const notify = useNotificationsStore((state) => state.notify);

  // `new` and "nothing yet" are different states, and an empty string would
  // conflate them: a pane still waiting for the store must not look like the
  // blank form for a new skill.
  const identity = skill === undefined ? 'new' : skill.slug;

  useEffect(() => {
    setSlug(skill?.slug ?? '');
    setName(skill?.name ?? '');
    setDescription(skill?.description ?? '');
    setWhenToUse(skill?.whenToUse ?? '');
    setBody(skill?.body ?? '');
    setEnabled(skill === undefined ? true : skillEnabled(skill));
    // Everything that belonged to the previous skill goes too. A failure
    // message from the one before, left on screen, would read as this one's.
    setError(undefined);
    setBusy(false);
    setToggling(false);
  }, [identity]);

  const isNew = skill === undefined;
  const canSave = slug.trim().length > 0 && name.trim().length > 0 && !busy;

  async function toggleEnabled(): Promise<void> {
    if (isNew || skill === undefined) return;
    const next = !enabled;
    setEnabled(next);
    setToggling(true);
    try {
      upsertSkill(await skillsService.setEnabled(skill.slug, next));
    } catch {
      setEnabled(!next);
      notify(t('skills.enableFailed'));
    } finally {
      setToggling(false);
    }
  }

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
    <>
      <AgentPageHeader
        title={isNew ? t('skills.new') : t('skills.editTitle')}
        back={<BackButton data-testid="skill-back" aria-label={t('common.back')} onClick={onDone} />}
      />
    <Card className="flex flex-col gap-4">

      {isNew ? null : (
        <SwitchField
          id="skill-enabled"
          testId="skill-enabled-toggle"
          label={t('skills.enabled')}
          checked={enabled}
          disabled={toggling}
          onChange={() => void toggleEnabled()}
        />
      )}

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
    </>
  );
}
