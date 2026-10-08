import { LIMITS, isHex, isTexture, type Part, type Recipe, type Vec3 } from '@coloxel/render';

export type ValidationResult =
  | { ok: true; recipe: Recipe }
  | { ok: false; reason: 'refused' | 'invalid'; message: string };

const clamp = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
};

const XY = (v: unknown) => clamp(v, -LIMITS.xy, LIMITS.xy);
const Z = (v: unknown) => clamp(v, 0, LIMITS.z);
const opt = (c: unknown) => (isHex(c) ? c : undefined);
const tex = (t: unknown) => (isTexture(t) ? t : undefined);

function cleanPart(p: unknown): Part | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  switch (o.t) {
    case 'box': {
      const x0 = XY(o.x0), x1 = XY(o.x1), y0 = XY(o.y0), y1 = XY(o.y1), z0 = Z(o.z0), z1 = Z(o.z1);
      const c = isHex(o.c) ? o.c : opt(o.top);
      if (x0 === null || x1 === null || y0 === null || y1 === null || z0 === null || z1 === null || !c) return null;
      if (x1 <= x0 || y1 <= y0 || z1 < z0) return null;
      return { t: 'box', x0, x1, y0, y1, z0, z1, c, top: opt(o.top), left: opt(o.left), right: opt(o.right), tex: tex(o.tex) };
    }
    case 'cyl': {
      const x = XY(o.x), y = XY(o.y), r = clamp(o.r, 0.5, 12), z0 = Z(o.z0), z1 = Z(o.z1);
      const side = isHex(o.side) ? o.side : opt(o.c);
      if (x === null || y === null || r === null || z0 === null || z1 === null || !side || z1 < z0) return null;
      return { t: 'cyl', x, y, r, z0, z1, side, top: opt(o.top) };
    }
    case 'sphere': {
      const x = XY(o.x), y = XY(o.y), z = Z(o.z), r = clamp(o.r, 0.5, 14);
      if (x === null || y === null || z === null || r === null || !isHex(o.c)) return null;
      return { t: 'sphere', x, y, z, r, c: o.c };
    }
    case 'circle': {
      const x = XY(o.x), y = XY(o.y), z = Z(o.z), r = clamp(o.r, 0.5, 12);
      if (x === null || y === null || z === null || r === null || !isHex(o.c)) return null;
      return { t: 'circle', x, y, z, r, c: o.c, c2: opt(o.c2) };
    }
    case 'quad': {
      if (!Array.isArray(o.pts) || o.pts.length < 3 || !isHex(o.c)) return null;
      const pts: Vec3[] = [];
      for (const a of o.pts.slice(0, LIMITS.maxQuadPoints)) {
        if (!Array.isArray(a)) return null;
        const x = XY(a[0]), y = XY(a[1]), z = Z(a[2]);
        if (x === null || y === null || z === null) return null;
        pts.push([x, y, z]);
      }
      return { t: 'quad', pts, c: o.c, tex: tex(o.tex) };
    }
    case 'pix': {
      const x = XY(o.x), y = XY(o.y), z = Z(o.z), w = clamp(o.w ?? 1, 0.5, 8), h = clamp(o.h ?? 1, 0.5, 8);
      if (x === null || y === null || z === null || w === null || h === null || !isHex(o.c)) return null;
      // Half units are allowed: the finest detail the renderer can draw.
      return { t: 'pix', x, y, z, w: Math.round(w * 2) / 2, h: Math.round(h * 2) / 2, c: o.c };
    }
    case 'glow': {
      const x = XY(o.x), y = XY(o.y), z = Z(o.z), r = clamp(o.r, 1, 30), a = clamp(o.a ?? 0.6, 0.1, 1);
      if (x === null || y === null || z === null || r === null || a === null || !isHex(o.c)) return null;
      return { t: 'glow', x, y, z, r, c: o.c, a };
    }
    default:
      return null;
  }
}

/**
 * Check and clean a model answer. The model output is untrusted: every part
 * is rebuilt from whitelisted fields, numbers are clamped, bad parts dropped.
 */
export function validateRecipe(raw: unknown, fallbackName = 'Objet mystère'): ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'invalid', message: 'Réponse vide ou illisible.' };
  const o = raw as Record<string, unknown>;

  if (typeof o.refus === 'string' && o.refus.trim()) {
    return { ok: false, reason: 'refused', message: o.refus.trim().slice(0, 160) };
  }
  if (!Array.isArray(o.parts)) return { ok: false, reason: 'invalid', message: 'Aucune forme dans la recette.' };

  const parts = o.parts.slice(0, LIMITS.maxParts).map(cleanPart).filter((p): p is Part => p !== null);
  if (parts.length < 2) return { ok: false, reason: 'invalid', message: 'Recette trop pauvre pour dessiner un objet.' };

  const rawName = typeof o.nom === 'string' ? o.nom : typeof o.name === 'string' ? o.name : fallbackName;
  const name = rawName.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || fallbackName;

  return { ok: true, recipe: { name, parts } };
}
