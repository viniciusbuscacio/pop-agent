import { join } from 'node:path';
import type { ChatRepo } from '../application/ports/chat-repo.js';
import type { EmbeddingsRepo } from '../application/ports/embeddings-repo.js';
import type { LlmRunsRepo } from '../application/ports/llm-runs-repo.js';
import type { MemoryRepo } from '../application/ports/memory-repo.js';
import type { McpRepo } from '../application/ports/mcp-repo.js';
import type { PushRepo } from '../application/ports/push-repo.js';
import type { QueuedMessageRepo } from '../application/ports/queued-message-repo.js';
import type { SecretsRepo } from '../application/ports/secrets-repo.js';
import type { SettingsRepo } from '../application/ports/settings-repo.js';
import type { SkillUsageRepo } from '../application/ports/skill-usage-repo.js';
import type {
  DistillationRepo,
  SkillRevisionsRepo,
} from '../application/ports/skill-distillation-repo.js';
import type { SkillVectorsRepo } from '../application/ports/skill-vectors-repo.js';
import type { TaskRepo } from '../application/ports/task-repo.js';
import type { UsageRepo } from '../application/ports/usage-repo.js';
import type { StorageRepo } from '../application/ports/storage-repo.js';
import type { UserMemoryRepo } from '../application/ports/user-memory-repo.js';
import type { FileProvenanceRepo } from '../application/ports/file-provenance-repo.js';
import type { WebAuthnRepo } from '../application/ports/webauthn-repo.js';
import { ensureDataDir, ensureFilesDir, resolveDataDir, resolveArtifactsDir } from './config/data-dir.js';
import { loadOrCreateSecretKey } from './crypto/secret-key-file.js';
import { openDatabase } from './db/database.js';
import { SqliteChatRepo } from './db/sqlite-chat-repo.js';
import { SqliteEmbeddingsRepo } from './db/sqlite-embeddings-repo.js';
import { SqliteLlmRunsRepo } from './db/sqlite-llm-runs-repo.js';
import { SqliteMemoryRepo } from './db/sqlite-memory-repo.js';
import { SqlitePushRepo } from './db/sqlite-push-repo.js';
import { SqliteQueuedMessageRepo } from './db/sqlite-queued-message-repo.js';
import { SqliteSecretsRepo } from './db/sqlite-secrets-repo.js';
import { SqliteUsageRepo } from './db/sqlite-usage-repo.js';
import { SqliteStorageRepo } from './db/sqlite-storage-repo.js';
import { SqliteUserMemoryRepo } from './db/sqlite-user-memory-repo.js';
import { SqliteWebAuthnRepo } from './db/sqlite-webauthn-repo.js';
import { SqliteSettingsRepo } from './db/sqlite-settings-repo.js';
import { SqliteSkillUsageRepo } from './db/sqlite-skill-usage-repo.js';
import {
  SqliteDistillationRepo,
  SqliteSkillRevisionsRepo,
} from './db/sqlite-skill-distillation-repo.js';
import { SqliteSkillVectorsRepo } from './db/sqlite-skill-vectors-repo.js';
import { SqliteTaskRepo } from './db/sqlite-task-repo.js';
import { SqliteMcpRepo } from './db/sqlite-mcp-repo.js';
import { SqliteFileProvenanceRepo } from './db/sqlite-file-provenance-repo.js';
import { readLegacyCatalog, writeLegacyFiles } from './db/legacy-files-export.js';

/** Everything the boot sequence produces for the composition root to wire. */
export interface AppContext {
  dataDir: string;
  /** The raw key that unlocks secrets and signs Files download links (§9, §14). */
  secretKey: Buffer;
  settings: SettingsRepo;
  secrets: SecretsRepo;
  chats: ChatRepo;
  /** One durable follow-up row per chat. */
  queuedMessages: QueuedMessageRepo;
  /** Which chat wrote which Files path -- append-only history (§6, §14). */
  fileProvenance: FileProvenanceRepo;
  llmRuns: LlmRunsRepo;
  memory: MemoryRepo;
  embeddings: EmbeddingsRepo;
  /** The skill router's vectors, so a restart does not re-embed the vault (§8). */
  skillVectors: SkillVectorsRepo;
  /** How often each skill earns its slot; the collector's evidence (§8). */
  skillUsage: SkillUsageRepo;
  /** How far the background distiller has read each conversation (§8, fase c). */
  distillation: DistillationRepo;
  /** Rewrites it proposed for skills that already exist, waiting on the user. */
  skillRevisions: SkillRevisionsRepo;
  userMemory: UserMemoryRepo;
  usage: UsageRepo;
  /** What the database can say about its own weight (pop-agent.spec §14). */
  storage: StorageRepo;
  /** Background tasks (pop-agent.spec §21). */
  tasks: TaskRepo;
  mcp: McpRepo;
  push: PushRepo;
  webauthn: WebAuthnRepo;
  /** The health endpoint's cheap liveness query (pop-agent.spec §13). */
  pingDb: () => void;
}

/**
 * Prepares the runtime side of the app: data directory, database (migrated)
 * and the key that unlocks the secrets table. Called once from main.ts.
 */
export function bootstrap(): AppContext {
  const dataDir = ensureDataDir(resolveDataDir());
  // Files as a plain folder (spec 1.58): if the pre-migration file still has
  // the artifact catalog, read it NOW -- migration 027 drops those tables the
  // moment openDatabase runs -- and land it on disk right after.
  const legacy = readLegacyCatalog(join(dataDir, 'pop-agent.db'), resolveArtifactsDir(dataDir));
  const db = openDatabase(join(dataDir, 'pop-agent.db'));
  const key = loadOrCreateSecretKey(join(dataDir, 'secret.key'));
  if (legacy !== undefined) {
    writeLegacyFiles(legacy, ensureFilesDir(dataDir), new SqliteFileProvenanceRepo(db), (line) =>
      console.log(line),
    );
  }

  return {
    dataDir,
    secretKey: key,
    settings: new SqliteSettingsRepo(db),
    secrets: new SqliteSecretsRepo(db, key),
    chats: new SqliteChatRepo(db),
    queuedMessages: new SqliteQueuedMessageRepo(db),
    fileProvenance: new SqliteFileProvenanceRepo(db),
    llmRuns: new SqliteLlmRunsRepo(db),
    memory: new SqliteMemoryRepo(db),
    embeddings: new SqliteEmbeddingsRepo(db),
    skillVectors: new SqliteSkillVectorsRepo(db),
    skillUsage: new SqliteSkillUsageRepo(db),
    distillation: new SqliteDistillationRepo(db),
    skillRevisions: new SqliteSkillRevisionsRepo(db),
    userMemory: new SqliteUserMemoryRepo(db),
    usage: new SqliteUsageRepo(db),
    storage: new SqliteStorageRepo(db),
    tasks: new SqliteTaskRepo(db),
    mcp: new SqliteMcpRepo(db),
    push: new SqlitePushRepo(db),
    webauthn: new SqliteWebAuthnRepo(db),
    pingDb: () => {
      db.prepare('SELECT 1').get();
    },
  };
}
