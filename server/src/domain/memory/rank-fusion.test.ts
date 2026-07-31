import { describe, expect, it } from 'vitest';
import { dot, fuseRankings, topKByCosine } from './rank-fusion.js';

describe('fuseRankings', () => {
  it('rewards an item ranked well in both lists', () => {
    const lexical = ['a', 'b', 'c'];
    const semantic = ['c', 'a', 'd'];

    const fused = fuseRankings([lexical, semantic], (item) => item);
    // "a" is 1st + 2nd, "c" is 3rd + 1st -- both beat items in one list only.
    expect(fused[0]?.key).toBe('a');
    expect(fused.slice(0, 2).map((entry) => entry.key).sort()).toEqual(['a', 'c']);
  });

  it('keeps an item that only one list found', () => {
    const fused = fuseRankings([['x'], ['y']], (item) => item);
    expect(fused.map((entry) => entry.key).sort()).toEqual(['x', 'y']);
  });

  it('honours the limit', () => {
    const fused = fuseRankings([['a', 'b', 'c', 'd']], (item) => item, { limit: 2 });
    expect(fused).toHaveLength(2);
  });
});

describe('cosine helpers', () => {
  it('dot of normalized vectors is their cosine', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0]);
    const c = new Float32Array([0, 1]);
    expect(dot(a, b)).toBeCloseTo(1);
    expect(dot(a, c)).toBeCloseTo(0);
  });

  it('ranks the nearest vectors first', () => {
    const query = new Float32Array([1, 0, 0]);
    const vectors = [
      { key: 'far', vector: new Float32Array([0, 1, 0]) },
      { key: 'near', vector: new Float32Array([0.9, 0.1, 0]) },
      { key: 'mid', vector: new Float32Array([0.5, 0.5, 0]) },
    ];
    const top = topKByCosine(query, vectors, 2);
    expect(top[0]?.key).toBe('near');
    expect(top).toHaveLength(2);
  });
});
