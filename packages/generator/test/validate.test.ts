import { describe, expect, it } from 'vitest';
import { SEEDS, renderSprite } from '@coloxel/render';
import { buildPrompt, extractJson, validateRecipe } from '../src';

describe('validateRecipe', () => {
  it('accepts the seed objects unchanged in shape', () => {
    for (const s of SEEDS) {
      const r = validateRecipe({ nom: s.name, parts: s.parts });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.recipe.parts.length).toBe(s.parts.length);
    }
  });

  it('passes a refusal through', () => {
    const r = validateRecipe({ refus: 'Personne réelle' });
    expect(r).toEqual({ ok: false, reason: 'refused', message: 'Personne réelle' });
  });

  it('drops bad parts and clamps numbers', () => {
    const r = validateRecipe({
      nom: 'Test',
      parts: [
        { t: 'box', x0: -100, x1: 100, y0: -2, y1: 2, z0: 0, z1: 500, c: '#ff0000' },
        { t: 'box', x0: 1, x1: 2, y0: 1, y1: 2, z0: 0, z1: 1, c: 'red' },
        { t: 'evil', x: 1 },
        { t: 'sphere', x: 0, y: 0, z: 5, r: 3, c: '#00ff00', onload: 'alert(1)' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.parts).toHaveLength(2);
    const box = r.recipe.parts[0]!;
    expect(box.t === 'box' && box.x0 === -14 && box.x1 === 14 && box.z1 === 70).toBe(true);
    expect(Object.keys(r.recipe.parts[1]!)).not.toContain('onload');
  });

  it('rejects empty or near empty recipes', () => {
    expect(validateRecipe(null).ok).toBe(false);
    expect(validateRecipe({ parts: [] }).ok).toBe(false);
    expect(validateRecipe({ parts: 'nope' }).ok).toBe(false);
  });

  it('cleans the name', () => {
    const r = validateRecipe({ nom: '<b>Super</b> objet avec un nom beaucoup trop long pour tenir', parts: SEEDS[1]!.parts });
    expect(r.ok && r.recipe.name.length <= 40 && !r.recipe.name.includes('<')).toBe(true);
  });

  it('survives random junk and the result always renders', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const types = ['box', 'cyl', 'sphere', 'circle', 'quad', 'pix', 'x'];
    for (let n = 0; n < 200; n++) {
      const parts = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => ({
        t: types[Math.floor(rnd() * types.length)],
        x: rnd() * 60 - 30, y: rnd() * 60 - 30, z: rnd() * 200 - 50, r: rnd() * 30 - 5,
        x0: rnd() * 40 - 20, x1: rnd() * 40 - 20, y0: rnd() * 40 - 20, y1: rnd() * 40 - 20,
        z0: rnd() * 80, z1: rnd() * 80, w: rnd() * 20, h: rnd() * 20,
        pts: [[rnd() * 30, rnd() * 30, rnd() * 30], [rnd() * 30, 1, 2], [3, rnd() * 30, 4]],
        c: rnd() > 0.2 ? '#a1b2c3' : 'nope', side: '#334455',
      }));
      const r = validateRecipe({ nom: 'x', parts });
      if (r.ok) expect(() => renderSprite(r.recipe.parts)).not.toThrow();
    }
  });
});

describe('prompt helpers', () => {
  it('puts the description at the end, trimmed', () => {
    const p = buildPrompt('  un   requin \n dans un bocal  ');
    expect(p.endsWith('Description du joueur : un requin dans un bocal')).toBe(true);
  });

  it('injects the style guide: outline, palette and scale', () => {
    const p = buildPrompt('une lampe');
    expect(p).toContain('bible graphique');
    expect(p).toContain('contour');
    expect(p).toContain('Échelle');
  });

  it('extracts JSON from fenced or chatty answers', () => {
    expect(extractJson('```json\n{"nom":"A","parts":[]}\n```')).toEqual({ nom: 'A', parts: [] });
    expect(extractJson('Voici : {"nom":"B"} voilà')).toEqual({ nom: 'B' });
    expect(extractJson('rien')).toBeNull();
  });

  it('keeps known textures and glows, drops unknown textures', () => {
    const r = validateRecipe({
      nom: 'Test',
      parts: [
        { t: 'box', x0: -4, x1: 4, y0: -4, y1: 4, z0: 0, z1: 6, c: '#8b5e3c', tex: 'wood' },
        { t: 'box', x0: -4, x1: 4, y0: -4, y1: 4, z0: 6, z1: 8, c: '#8b5e3c', tex: 'lava<script>' },
        { t: 'glow', x: 0, y: 0, z: 10, r: 999, c: '#ffd070', a: 5 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.parts[0]).toMatchObject({ tex: 'wood' });
    expect((r.recipe.parts[1] as { tex?: string }).tex).toBeUndefined();
    expect(r.recipe.parts[2]).toMatchObject({ t: 'glow', r: 30, a: 1 });
  });

  it('reads the footprint and widens the bounds with it', () => {
    const big = validateRecipe({
      nom: 'Grand lit',
      size: [2, 9],
      parts: [
        { t: 'box', x0: -6, x1: 90, y0: -6, y1: 6, z0: 0, z1: 5, c: '#4060a0' },
        { t: 'box', x0: 0, x1: 4, y0: 0, y1: 4, z0: 0, z1: 5, c: '#4060a0' },
      ],
    });
    expect(big.ok).toBe(true);
    if (!big.ok) return;
    expect(big.recipe.size).toEqual([2, 3]);
    // x may reach 16 * (2 - 1) + 14 = 30 on two tiles, and no further.
    expect(big.recipe.parts[0]).toMatchObject({ x1: 30 });
    const plain = validateRecipe({ nom: 'Chaise', parts: big.recipe.parts });
    expect(plain.ok && plain.recipe.size).toBeFalsy();
    if (plain.ok) expect(plain.recipe.parts[0]).toMatchObject({ x1: 14 });
  });
});
