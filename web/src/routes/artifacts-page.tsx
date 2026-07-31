import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ArtifactDTO } from '@popy/shared';
import { t } from '../i18n';
import { ApiError } from '../services/api';
import { artifactsService } from '../services/artifacts';
import { Button, Card } from '../ui/controls';

/**
 * A conversation's artifacts (popy.spec §14, RF-002): what the agent made and
 * what the user uploaded. A full screen with a back button -- never a drawer
 * (permanent house veto). Download goes through a freshly minted signed link.
 */
export function ArtifactsPage() {
  const { chatId = '' } = useParams();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [artifacts, setArtifacts] = useState<ArtifactDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void reload();
  }, [chatId]);

  async function reload(): Promise<void> {
    try {
      setArtifacts((await artifactsService.list(chatId)).artifacts);
    } catch {
      // Leave what is on screen; the next open tells the truth.
    }
  }

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await artifactsService.upload(chatId, file);
      await reload();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'too_large'
          ? t('artifacts.tooLarge')
          : t('artifacts.uploadFailed'),
      );
    } finally {
      setBusy(false);
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  }

  async function download(artifact: ArtifactDTO): Promise<void> {
    try {
      const { url } = await artifactsService.link(artifact.id);
      window.open(url, '_blank', 'noopener');
    } catch {
      setError(t('error.generic'));
    }
  }

  async function remove(artifact: ArtifactDTO): Promise<void> {
    if (!window.confirm(t('artifacts.deleteConfirm'))) return;
    try {
      await artifactsService.remove(artifact.id);
    } catch {
      // The delete happened server-side; a failed 204 parse is not an error.
    }
    await reload();
  }

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 border-b border-[var(--border)] p-3">
        <button
          type="button"
          data-testid="artifacts-back"
          aria-label={t('common.back')}
          onClick={() => navigate(`/chat/${chatId}`)}
          className="rounded-md px-2 py-1 text-[var(--key-fg-dim)] hover:bg-[var(--hover-overlay)]"
        >
          ←
        </button>
        <h1 className="text-lg font-semibold">{t('artifacts.title')}</h1>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-[var(--muted)]">{t('artifacts.intro')}</p>
          <div>
            <input
              ref={fileInput}
              type="file"
              data-testid="artifacts-file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void upload(file);
              }}
            />
            <Button
              type="button"
              data-testid="artifacts-upload"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? t('artifacts.uploading') : t('artifacts.upload')}
            </Button>
          </div>
          {error !== undefined ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}
        </Card>

        {artifacts.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--muted)]">{t('artifacts.empty')}</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {artifacts.map((artifact) => (
              <Card key={artifact.id} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{artifact.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {(artifact.size / 1024).toFixed(1)} KB ·{' '}
                    {artifact.source === 'agent'
                      ? t('artifacts.sourceAgent')
                      : t('artifacts.sourceUpload')}
                    {artifact.version > 1 ? ` · v${String(artifact.version)}` : ''} ·{' '}
                    <span className="font-mono">{artifact.id}</span>
                  </p>
                </div>
                <div className="flex flex-none gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    data-testid={`artifact-download-${artifact.id}`}
                    onClick={() => void download(artifact)}
                  >
                    {t('artifacts.download')}
                  </Button>
                  <Button type="button" variant="danger" onClick={() => void remove(artifact)}>
                    {t('artifacts.delete')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
