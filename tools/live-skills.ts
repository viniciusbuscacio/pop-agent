/**
 * The auto-skill loop against a real model (popy.spec §8, fases b and c).
 *
 * The gate proves the distiller's control flow against a scripted answer, and
 * proves the router's ranking against fixed vectors. Neither can answer the
 * question this file exists for: given a real conversation and a real model,
 * does a skill actually come out -- and does the router bring that skill back
 * when a later message calls for it? A parser that is right about a fixture
 * and wrong about what models really emit passes every test in the gate.
 *
 * So this runs the whole loop end to end on a throwaway database and vault:
 * plant a conversation, distil it, approve what comes out, then ask the router
 * a question the skill should answer and see whether it is selected.
 *
 * Deliberately not in the gate: it spends money, like `live-check.ts`. Run it
 * by hand, read what it prints, close the terminal.
 *
 *   npx tsx tools/live-skills.ts
 *
 * The key comes from OPENROUTER_API_KEY, or from the repo's .env.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SkillDistiller } from '../server/src/application/skills/skill-distiller.js';
import { SkillRouterService } from '../server/src/application/skills/skill-router-service.js';
import { SkillCollector } from '../server/src/application/skills/skill-collector.js';
import type { Message } from '../server/src/domain/chat/chat.js';
import { migrate } from '../server/src/infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../server/src/infrastructure/db/sqlite-chat-repo.js';
import {
  SqliteDistillationRepo,
  SqliteSkillRevisionsRepo,
} from '../server/src/infrastructure/db/sqlite-skill-distillation-repo.js';
import { SqliteSkillUsageRepo } from '../server/src/infrastructure/db/sqlite-skill-usage-repo.js';
import { SqliteSkillVectorsRepo } from '../server/src/infrastructure/db/sqlite-skill-vectors-repo.js';
import { TransformersEmbedder } from '../server/src/infrastructure/embeddings/transformers-embedder.js';
import { SkillsVault } from '../server/src/infrastructure/skills/skills-vault.js';
import { ProviderService } from '../server/src/application/providers/provider-service.js';
import { ProviderCooldown } from '../server/src/application/providers/provider-cooldown.js';
import { SqliteSettingsRepo } from '../server/src/infrastructure/db/sqlite-settings-repo.js';
import { SqliteSecretsRepo } from '../server/src/infrastructure/db/sqlite-secrets-repo.js';
import { loadOrCreateSecretKey } from '../server/src/infrastructure/crypto/secret-key-file.js';
import { AnthropicGateway } from '../server/src/infrastructure/providers/anthropic-gateway.js';
import {
  OpenAiCompatibleGateway,
  createOpenRouterGateway,
} from '../server/src/infrastructure/providers/openai-compatible-gateway.js';

const offline = process.argv.includes('--offline');

/**
 * What the model actually answered on 08/08, replayed.
 *
 * The slug, name, description and whenToUse are verbatim from the live run --
 * the raw answer is in that run's output. The body is the model's opening
 * paragraph plus the four steps of the transcript, written out by hand,
 * because the live answer was cut off by the token ceiling. (Which is the bug
 * that run found: the parser read the cut-off array as an empty one and the
 * watermark moved past a conversation that had a good skill in it.)
 *
 * Replaying it makes the second half of this check -- does the router bring a
 * learned skill back? -- runnable for nothing, with the real embedder, on text
 * a model really produced rather than text written to be easy to retrieve.
 */
const RECORDED_BODY = `# Fix stale 404s after a Cloudflare Pages deploy

Symptom: the build passed (e.g. GitHub Actions green), the push went out, but the site serves 404s or the old build.

1. Confirm the push actually landed on \`main\` -- Cloudflare Pages only publishes production deployments from that branch.
2. In the Cloudflare Pages dashboard, check the latest deployment reads "Success" and not "Building".
3. Purge the cache through the API with the zone id, not the dashboard button -- the button only clears HTML.
4. Wait ~30s and test with \`curl -I\`, checking \`cf-cache-status\` comes back MISS on the first call.
5. Only then open a browser. Testing in the browser first caches the 404 locally, which looks like the purge failed and leads to a pointless redeploy.
`;

const RECORDED_ANSWER = JSON.stringify([
  {
    slug: 'cloudflare-pages-stale-cache',
    name: 'Fix stale 404s after Cloudflare Pages deploy',
    description:
      'Clear Cloudflare edge cache correctly when a successful deploy still serves 404s or the old build.',
    whenToUse:
      'Deploy passed but the site still returns 404 on all pages or serves the old version after a push; ' +
      'Cloudflare Pages (or any Cloudflare-fronted site) serving stale content; need to purge Cloudflare ' +
      'cache and verify it actually cleared.',
    body: RECORDED_BODY,
  },
]);
const CHAT_ID = 'chat-liveskill01';
const NOW = Date.parse('2026-08-07T20:00:00.000Z');


/**
 * A conversation with a real procedure in it, in Portuguese, of the shape the
 * maintainer actually has: a thing that went wrong, and the steps that fixed
 * it. Written by hand rather than generated, so the distiller is being read on
 * material nobody tuned it against.
 */
const TRANSCRIPT: [Message['role'], string][] = [
  ['user', 'o deploy do blog falhou de novo, deu 404 em todas as paginas depois do push'],
  [
    'assistant',
    'Isso costuma ser o Cloudflare servindo o build antigo. Confere se o push foi pra main, ' +
      'porque o Pages so publica dessa branch.',
  ],
  ['user', 'foi pra main sim. e o build passou no Actions'],
  [
    'assistant',
    'Entao e cache de borda. O caminho que resolve: (1) confirmar no painel do Cloudflare Pages ' +
      'que o deployment mais recente esta como "Success" e nao "Building"; (2) rodar o purge de ' +
      'cache pela API, com o zone id do dominio, nao pelo botao do painel, que so limpa HTML; ' +
      '(3) esperar uns 30 segundos e testar com curl -I, olhando o header cf-cache-status, que ' +
      'tem que voltar MISS na primeira chamada; (4) so entao abrir no navegador, senao voce testa ' +
      'o cache local e acha que continua quebrado.',
  ],
  ['user', 'purguei pela api e voltou. o cf-cache-status veio MISS mesmo'],
  [
    'assistant',
    'Perfeito. O erro classico aqui e testar no navegador antes do purge terminar: o 404 fica ' +
      'em cache local e parece que o purge nao funcionou, ai a pessoa refaz o deploy sem precisar.',
  ],
  ['user', 'boa, era exatamente isso que eu tava fazendo errado'],
];

/** A later message that has nothing in common with the skill's words but everything with its subject. */
const FUTURE_QUESTION = 'as paginas do site continuam mostrando conteudo velho depois que publiquei';

async function main(): Promise<void> {
  // The real instance's providers, read from the real data directory: which
  // provider is first, which model each one serves, and the credentials. Read
  // only -- nothing here writes to the live database, and the distiller under
  // test writes to the throwaway one below.
  const liveDir = join(process.env['HOME'] ?? '.', '.popy');
  const liveDb = new Database(join(liveDir, 'popy.db'), { readonly: true });
  const liveSettings = new SqliteSettingsRepo(liveDb);
  const providers = new ProviderService({
    secrets: new SqliteSecretsRepo(liveDb, loadOrCreateSecretKey(join(liveDir, 'secret.key'))),
    settings: liveSettings,
    gateways: {
      openrouter: createOpenRouterGateway(),
      openai: new OpenAiCompatibleGateway('https://api.openai.com/v1'),
      anthropic: new AnthropicGateway(),
    },
    customGateway: (baseURL) => new OpenAiCompatibleGateway(baseURL),
    clock: { now: () => Date.now() },
    envKey: () => process.env['OPENROUTER_API_KEY'],
    cooldown: new ProviderCooldown({ clock: { now: () => Date.now() } }),
    // A check must not rewrite the instance's default provider.
    setDefaultProvider: () => undefined,
    // Subscription providers ask the engine whether a credential exists; no
    // engine is running here, so they answer "no" and drop out of the chain.
    // The key-based providers -- which is what this instance uses -- are
    // unaffected.
    engineModels: () => Promise.resolve([]),
    engineHasAuth: () => false,
    engineCheckAuth: () => Promise.resolve({ ok: false }),
    engineLogout: () => Promise.resolve(),
    defaults: () => {
      const doc = liveSettings.get<{ defaultProvider?: string; defaultModel?: string }>('app');
      return { provider: doc?.defaultProvider ?? '', model: doc?.defaultModel ?? '' };
    },
  });
  const dataDir = mkdtempSync(join(tmpdir(), 'popy-live-skills-'));
  const db = new Database(join(dataDir, 'popy.db'));
  migrate(db);

  const chats = new SqliteChatRepo(db);
  const vault = new SkillsVault(join(dataDir, 'skills'));
  const marks = new SqliteDistillationRepo(db);
  const revisions = new SqliteSkillRevisionsRepo(db);
  const usage = new SqliteSkillUsageRepo(db);
  const vectors = new SqliteSkillVectorsRepo(db);
  // The real model, from the real cache: this is the embedder the server uses.
  const embedder = new TransformersEmbedder({ cacheDir: join(process.env['HOME'] ?? '.', '.popy', 'models') });

  const before = vault.all().map((skill) => skill.slug);
  console.log(`vault starts with ${String(before.length)} built-in skills`);

  chats.create({
    id: CHAT_ID,
    title: 'Deploy do blog',
    model: '',
    provider: '',
    archived: false,
    piSessionId: '',
    summary: '',
    autoTitle: true,
    createdAt: new Date(NOW - 3_600_000).toISOString(),
    updatedAt: new Date(NOW - 3_600_000).toISOString(),
  });
  TRANSCRIPT.forEach(([role, content], index) => {
    chats.appendMessage({
      id: `msg-live${String(index).padStart(2, '0')}`,
      chatId: CHAT_ID,
      role,
      content,
      thinking: '',
      tools: [],
      attachments: [],
      createdAt: new Date(NOW - 3_600_000 + index * 1_000).toISOString(),
    });
  });

  let spent = 0;
  const distiller = new SkillDistiller({
    chats,
    marks,
    revisions,
    skills: vault,
    embedder,
    vectors,
    // `completeAsService`, exactly as the server calls it: the provider comes
    // from the chat, the model is that provider's Service Model, and a refusal
    // walks the same failover chain a run does.
    //
    // The first version of this file called OpenRouter directly with a
    // hardcoded model id, which was worse than a shortcut: the Service Model
    // resolution added in 1.60 is one of the things this check exists to
    // exercise, and bypassing it meant the run proved nothing about the path
    // production takes. It also produced a wrong conclusion -- an out-of-credit
    // error on a provider the instance does not even use first, read as a fact
    // about Popy.
    complete: async (request, ctx) => {
      if (offline) return RECORDED_ANSWER;
      spent += 1;
      const result = await providers.completeAsService(request, ctx);
      console.log(`  --- answered by ${result.providerId} / ${result.modelId} ---`);
      for (const line of result.text.split('\n')) console.log(`  | ${line}`);
      console.log(`  --- end (${String(result.text.length)} chars) ---`);
      return result.text;
    },
    clock: { now: () => Date.now() },
    enabled: () => true,
    autoApprove: () => false,
    everyMs: () => 600_000,
    idleMs: 0,
    onJournal: (line) => console.log(`  ${line}`),
  });

  console.log('\n--- fase (c): distilling one real conversation ---');
  await distiller.run();

  const learned = vault.all().filter((skill) => !before.includes(skill.slug));
  if (learned.length === 0) {
    console.log('\nNOTHING LEARNED. The loop ran but produced no skill.');
    console.log(`(${String(spent)} model call(s) spent.)`);
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(1);
  }

  for (const skill of learned) {
    console.log(`\n  slug        ${skill.slug}`);
    console.log(`  source      ${skill.source}   pending: ${String(skill.pending === true)}`);
    console.log(`  name        ${skill.name}`);
    console.log(`  description ${skill.description}`);
    console.log(`  whenToUse   ${skill.whenToUse}`);
    console.log(`  body\n${skill.body.split('\n').map((line) => `    | ${line}`).join('\n')}`);
  }

  console.log('\n--- the promise: a pending skill is NOT routed ---');
  const router = new SkillRouterService({ skills: vault, embedder, vectors, usage, clock: { now: () => Date.now() } });
  const beforeApproval = await router.route(FUTURE_QUESTION);
  const leaked = learned.filter((skill) => beforeApproval.includes(skill.body));
  console.log(`  routed ${String(beforeApproval.length)} skill(s); the new one is ${leaked.length === 0 ? 'correctly absent' : 'LEAKING'}`);

  console.log('\n--- fase (b) + router: approve it, then ask a different question ---');
  for (const skill of learned) vault.approve(skill.slug);

  const routed = new SkillRouterService({
    skills: vault,
    embedder,
    vectors,
    usage,
    clock: { now: () => Date.now() },
    onRoute: (selection) => {
      for (const entry of selection) {
        const cosine = entry.similarity === undefined ? '' : ` cos=${entry.similarity.toFixed(2)}`;
        console.log(`  ${entry.slug} (rrf=${entry.score.toFixed(4)} lex=${entry.lexical.toFixed(2)}${cosine})`);
      }
    },
  });
  console.log(`  question: "${FUTURE_QUESTION}"`);
  const bodies = await routed.route(FUTURE_QUESTION);
  const hit = learned.some((skill) => bodies.includes(skill.body));
  console.log(`\n  the learned skill was ${hit ? 'SELECTED' : 'NOT selected'}`);
  console.log(`  use counts: ${JSON.stringify(usage.all())}`);

  console.log('\n--- the collector, with the cap lowered to zero ---');
  new SkillCollector({
    skills: vault,
    archive: vault,
    usage,
    cap: 0,
    onJournal: (line) => console.log(`  ${line}`),
  }).run();
  console.log(`  archived now: ${JSON.stringify(vault.archived().map((skill) => skill.slug))}`);
  console.log(`  still routable: ${JSON.stringify(vault.all().filter((s) => s.source === 'auto').map((s) => s.slug))}`);

  console.log(`\n${String(spent)} model call(s) spent.`);
  rmSync(dataDir, { recursive: true, force: true });
  if (!hit) process.exit(1);
}

void main();
