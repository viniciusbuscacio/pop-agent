import { join } from 'node:path';
import type { ChatRepo } from '../application/ports/chat-repo.js';
import type { ArtifactRepo } from '../application/ports/artifact-repo.js';
import type { EmbeddingsRepo } from '../application/ports/embeddings-repo.js';
import type { LlmRunsRepo } from '../application/ports/llm-runs-repo.js';
import type { MemoryRepo } from '../application/ports/memory-repo.js';
import type { PushRepo } from '../application/ports/push-repo.js';
import type { SecretsRepo } from '../application/ports/secrets-repo.js';
import type { SettingsRepo } from '../application/ports/settings-repo.js';
import type { UsageRepo } from '../application/ports/usage-repo.js';
import type { UserMemoryRepo } from '../application/ports/user-memory-repo.js';
import type { WebAuthnRepo } from '../application/ports/webauthn-repo.js';
import { ensureDataDir, resolveDataDir } from './config/data-dir.js';
import { loadOrCreateSecretKey } from './crypto/secret-key-file.js';
import { openDatabase } from './db/database.js';
import { SqliteArtifactRepo } from './db/sqlite-artifact-repo.js';
import { SqliteChatRepo } from './db/sqlite-chat-repo.js';
import { SqliteEmbeddingsRepo } from './db/sqlite-embeddings-repo.js';
import { SqliteLlmRunsRepo } from './db/sqlite-llm-runs-repo.js';
import { SqliteMemoryRepo } from './db/sqlite-memory-repo.js';
import { SqlitePushRepo } from './db/sqlite-push-repo.js';
import { SqliteSecretsRepo } from './db/sqlite-secrets-repo.js';
import { SqliteUsageRepo } from './db/sqlite-usage-repo.js';
import { SqliteUserMemoryRepo } from './db/sqlite-user-memory-repo.js';
import { SqliteWebAuthnRepo } from './db/sqlite-webauthn-repo.js';
import { SqliteSettingsRepo } from './db/sqlite-settings-repo.js';

/** Everything the boot sequence produces for the composition root to wire. */
export interface AppContext {
  dataDir: string;
  /** The raw key that unlocks secrets and signs artifact links (§9, §14). */
  secretKey: Buffer;
  settings: SettingsRepo;
  secrets: SecretsRepo;
  chats: ChatRepo;
  artifacts: ArtifactRepo;
  llmRuns: LlmRunsRepo;
  memory: MemoryRepo;
  embeddings: EmbeddingsRepo;
  userMemory: UserMemoryRepo;
  usage: UsageRepo;
  push: PushRepo;
  webauthn: WebAuthnRepo;
}

/**
 * Prepares the runtime side of the app: data directory, database (migrated)
 * and the key that unlocks the secrets table. Called once from main.ts.
 */
export function bootstrap(): AppContext {
  const dataDir = ensureDataDir(resolveDataDir());
  const db = openDatabase(join(dataDir, 'popy.db'));
  const key = loadOrCreateSecretKey(join(dataDir, 'secret.key'));

  return {
    dataDir,
    secretKey: key,
    settings: new SqliteSettingsRepo(db),
    secrets: new SqliteSecretsRepo(db, key),
    chats: new SqliteChatRepo(db),
    artifacts: new SqliteArtifactRepo(db),
    llmRuns: new SqliteLlmRunsRepo(db),
    memory: new SqliteMemoryRepo(db),
    embeddings: new SqliteEmbeddingsRepo(db),
    userMemory: new SqliteUserMemoryRepo(db),
    usage: new SqliteUsageRepo(db),
    push: new SqlitePushRepo(db),
    webauthn: new SqliteWebAuthnRepo(db),
  };
}
