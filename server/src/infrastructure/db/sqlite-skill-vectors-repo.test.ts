import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { SqliteSkillVectorsRepo } from './sqlite-skill-vectors-repo.js';

let db: Database.Database;
let vectors: SqliteSkillVectorsRepo;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  vectors = new SqliteSkillVectorsRepo(db);
});

describe('SqliteSkillVectorsRepo', () => {
  it('round-trips a vector and its signature', () => {
    vectors.save('recipes', 'Recipes. Cooking. when cooking', Float32Array.from([0.1, 0.2]));
    const [stored] = vectors.all();
    expect(stored?.slug).toBe('recipes');
    expect(stored?.signature).toBe('Recipes. Cooking. when cooking');
    expect(Array.from(stored?.vector ?? [])).toEqual([Math.fround(0.1), Math.fround(0.2)]);
  });

  it('replaces the vector when the skill is saved again', () => {
    vectors.save('recipes', 'old', Float32Array.from([1, 0]));
    vectors.save('recipes', 'new', Float32Array.from([0, 1]));
    expect(vectors.all()).toHaveLength(1);
    expect(vectors.all()[0]?.signature).toBe('new');
  });

  it('keeps only the slugs it is given', () => {
    vectors.save('a', 's', Float32Array.from([1]));
    vectors.save('b', 's', Float32Array.from([1]));
    vectors.keepOnly(['a']);
    expect(vectors.all().map((row) => row.slug)).toEqual(['a']);
  });

  it('empties the table when nothing is worth keeping', () => {
    vectors.save('a', 's', Float32Array.from([1]));
    vectors.keepOnly([]);
    expect(vectors.all()).toEqual([]);
  });
});
