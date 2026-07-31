import { entityId } from '../ids.js';

/**
 * A file Popy tracks for a conversation (popy.spec §6, §14): something the
 * agent produced or the user uploaded, downloadable later through a signed
 * link. The bytes live on disk; this is the record that gives them a stable,
 * unguessable identity (`file-<11 base62>`) independent of where they are
 * stored -- the only identifier that ever leaves the server.
 */
export type ArtifactSource = 'agent' | 'upload';

export interface Artifact {
  id: string;
  chatId: string;
  /** The original or display name, kept as the user's own (not a base62 name). */
  name: string;
  mime: string;
  size: number;
  version: number;
  source: ArtifactSource;
  createdAt: string;
  updatedAt: string;
}

export interface NewArtifact {
  chatId: string;
  name: string;
  mime: string;
  size: number;
  source: ArtifactSource;
}

export function createArtifact(input: NewArtifact, now: string): Artifact {
  return {
    id: entityId('file'),
    chatId: input.chatId,
    name: input.name,
    mime: input.mime,
    size: input.size,
    version: 1,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
}
