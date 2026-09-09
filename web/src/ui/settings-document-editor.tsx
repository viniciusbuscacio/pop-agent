import { useRef, useState } from 'react';
import type { SettingsDTO, UserMemoryDTO } from '@pop-agent/shared';
import { settingsService } from '../services/settings';
import { settingsResources } from '../services/settings-resources';
import { session } from '../services/session';
import { ApiError } from '../services/api';
import { t } from '../i18n';
import { Button, Card, TextArea } from './controls';
import { useSettingsLoad } from './settings-sync';

export function SettingsDocumentEditor({ kind }: { kind: 'instructions' | 'memory' }) {
  const memory = kind === 'memory';
  const key = memory ? 'memory' : 'settings';
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const base = useRef<string | undefined>(undefined);
  const latest = useRef<string | undefined>(undefined);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [saved, setSaved] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string>();
  function edit(value: string) { draftRef.current = value; setDraft(value); setSaved(false); }
  function text(value: SettingsDTO | UserMemoryDTO) { return 'doc' in value ? value.doc : value.customInstructions; }
  const state = useSettingsLoad<SettingsDTO | UserMemoryDTO>(key,
    () => memory ? settingsService.readMemory() : settingsService.read(),
    (value) => {
      const incoming = text(value);
      setInitialized(true);
      latest.current = incoming;
      if ('hasBackup' in value) setHasBackup(value.hasBackup);
      if (saving.current) return;
      if (base.current === undefined || draftRef.current === base.current) {
        base.current = incoming; edit(incoming); setConflict(false);
      } else setConflict(incoming !== base.current);
    });

  async function save() {
    if (!state.fresh || base.current === undefined || busy || conflict) return;
    const sent = draftRef.current;
    const expected = base.current;
    const generation = session.generation();
    saving.current = true; setBusy(true); setError(undefined);
    try {
      const result = memory
        ? await settingsService.writeMemory(sent, expected)
        : await settingsService.update({ customInstructions: sent }, expected);
      if (generation !== session.generation()) return;
      const incoming = text(result);
      base.current = incoming; latest.current = incoming;
      if ('hasBackup' in result) setHasBackup(result.hasBackup);
      if (draftRef.current === sent) { edit(incoming); setSaved(true); }
      setConflict(false);
      settingsResources.accept(key, result);
    } catch (cause) {
      if (generation !== session.generation()) return;
      if (cause instanceof ApiError && cause.code === 'edit_conflict') {
        setConflict(true);
        void settingsResources.load(key, () => memory ? settingsService.readMemory() : settingsService.read());
      }
      setError(t(memory ? 'settings.memory.saveFailed' : 'settings.general.saveFailed'));
    } finally { saving.current = false; setBusy(false); }
  }
  async function restore() {
    if (!state.fresh || busy || !window.confirm(t('settings.memory.restoreConfirm'))) return;
    saving.current = true; setBusy(true); setError(undefined);
    const generation = session.generation();
    const before = draftRef.current;
    try {
      const result = await settingsService.restoreMemory();
      if (generation !== session.generation()) return;
      base.current = result.doc; latest.current = result.doc;
      if (draftRef.current === before) edit(result.doc);
      setHasBackup(result.hasBackup); setConflict(false);
      settingsResources.accept(key, result);
    } catch { setError(t('settings.memory.restoreFailed')); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Card className="flex flex-col gap-4">
    <TextArea id={`settings-${kind}`} data-testid={`settings-${kind}`}
      label={t(memory ? 'settings.memory.label' : 'settings.general.instructions')}
      hint={t(memory ? 'settings.memory.hint' : 'settings.general.instructionsHint')}
      rows={15} maxLength={memory ? 8000 : 4000}
      className="min-h-[calc(15lh+1rem+2px)] shrink-0"
      disabled={!initialized} value={draft} onChange={(event) => edit(event.target.value)} />
    {conflict ? <div className="flex flex-col gap-2" role="alert">
      <p className="text-sm text-[var(--muted)]">{t('settings.sync.conflict')}</p>
      <TextArea id={`settings-${kind}-latest`} label={t('settings.sync.serverVersion')} value={latest.current ?? ''} readOnly rows={5} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !state.fresh} onClick={() => { base.current = latest.current; edit(latest.current ?? ''); setConflict(false); setError(undefined); }}>{t('settings.sync.useServer')}</Button>
        <Button type="button" variant="ghost" disabled={busy || !state.fresh} onClick={() => { base.current = latest.current; setConflict(false); setError(undefined); }}>{t('settings.sync.keepEdits')}</Button>
      </div>
    </div> : null}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" data-testid={memory ? 'settings-memory-save' : 'settings-general-save'} disabled={busy || !initialized || !state.fresh || conflict || draft === base.current} onClick={() => void save()}>{t('common.save')}</Button>
      {memory && hasBackup ? <Button type="button" variant="ghost" data-testid="settings-memory-restore" disabled={busy || !state.fresh} onClick={() => void restore()}>{t('settings.memory.restore')}</Button> : null}
      <Button type="button" variant="ghost" data-testid={memory ? 'settings-memory-cancel' : 'settings-instructions-cancel'} disabled={busy || !initialized} onClick={() => { base.current = latest.current; edit(latest.current ?? ''); setConflict(false); setError(undefined); }}>{t('common.cancel')}</Button>
      {saved ? <span className="text-sm text-[var(--success)]">{t('settings.general.saved')}</span> : null}
    </div>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
  </Card>;
}
