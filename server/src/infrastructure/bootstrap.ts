import { join } from 'node:path';
import type { ChatRepo } from '../application/ports/chat-repo.js';
import type { LlmRunsRepo } from '../application/ports/llm-runs-repo.js';
import type { MemoryRepo } from '../application/ports/memory-repo.js';
import type { SecretsRepo } from '../application/ports/secrets-repo.js';
import type { SettingsRepo } from '../application/ports/settings-repo.js';
import { ensureDataDir, resolveDataDir } from './config/data-dir.js';
import { loadOrCreateSecretKey } from './crypto/secret-key-file.js';
import { openDatabase } from './db/database.js';
import { SqliteChatRepo } from './db/sqlite-chat-repo.js';
import { SqliteLlmRunsRepo } from './db/sqlite-llm-runs-repo.js';
import { SqliteMemoryRepo } from './db/sqlite-memory-repo.js';
import { SqliteSecretsRepo } from './db/sqlite-secrets-repo.js';
import { SqliteSettingsRepo } from './db/sqlite-settings-repo.js';

/** Everything the boot sequence produces for the composition root to wire. */
export interface AppContext {
  dataDir: string;
  settings: SettingsRepo;
  secrets: SecretsRepo;
  chats: ChatRepo;
  llmRuns: LlmRunsRepo;
  memory: MemoryRepo;
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
    settings: new SqliteSettingsRepo(db),
    secrets: new SqliteSecretsRepo(db, key),
    chats: new SqliteChatRepo(db),
    llmRuns: new SqliteLlmRunsRepo(db),
    memory: new SqliteMemoryRepo(db),
  };
}
