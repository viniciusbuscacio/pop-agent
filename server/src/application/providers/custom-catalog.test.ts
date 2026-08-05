import { describe, expect, it } from 'vitest';
import { customProviderDefinition } from './provider-definitions.js';

/**
 * Which models a custom endpoint is known to serve (popy.spec §15).
 *
 * The engine registers a provider with exactly these and then refuses
 * anything else. Registering only the configured model meant the picker
 * offered every model the endpoint really has and five of six failed --
 * and failed while the session was being opened, so the run hung rather
 * than said so (Vinicius, 05/08).
 */
const MARITACA = {
  id: 'custom-8e4e682bfd',
  name: 'Maritaca IA',
  baseURL: 'https://chat.maritaca.ai/api',
  defaultModel: 'sabiazinho-4',
};

const CATALOG = [
  { id: 'sabia-4', context: 128_000 },
  { id: 'sabia-4-thinking', context: 128_000 },
  { id: 'sabiazinho-4', context: 128_000 },
];

describe('a custom provider knows what its endpoint serves', () => {
  it('registers the whole fetched catalog, not just the configured model', () => {
    const definition = customProviderDefinition(MARITACA, CATALOG);
    expect(definition.staticModels.map((model) => model.id)).toEqual([
      'sabia-4',
      'sabia-4-thinking',
      'sabiazinho-4',
    ]);
  });

  it('keeps the context length the endpoint reported', () => {
    const definition = customProviderDefinition(MARITACA, CATALOG);
    expect(definition.staticModels.find((model) => model.id === 'sabia-4')?.context).toBe(128_000);
  });

  it('falls back to the configured model when nothing has been fetched', () => {
    // A brand new instance, or an endpoint that lists nothing: what the user
    // typed still has to work.
    const definition = customProviderDefinition(MARITACA);
    expect(definition.staticModels.map((model) => model.id)).toEqual(['sabiazinho-4']);
  });

  it('keeps the configured model even when the catalog omits it', () => {
    // The user's own word beats a catalog that is late, partial, or wrong.
    const definition = customProviderDefinition(MARITACA, [{ id: 'sabia-4' }]);
    expect(definition.staticModels.map((model) => model.id)).toEqual(['sabiazinho-4', 'sabia-4']);
  });

  it('never lists the same model twice', () => {
    const definition = customProviderDefinition(MARITACA, CATALOG);
    const ids = definition.staticModels.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says nothing when there is neither a catalog nor a configured model', () => {
    const definition = customProviderDefinition({ ...MARITACA, defaultModel: '' });
    expect(definition.staticModels).toEqual([]);
  });
});
