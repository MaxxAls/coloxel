import { LAYOUT_PRESETS, MAX_LEVEL, N, hasFloor, layoutProblem, levelAt, sameLayout, type RoomLayout } from '@coloxel/world';
import { api } from './api';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** What a click on the drawing does to a cell. */
type Tool = { kind: 'void' } | { kind: 'floor'; level: number } | { kind: 'door' };

const CELL_W = 40;
const CELL_H = 20;
const RISE = 5;
const WIDTH = N * CELL_W;
const HEIGHT = N * CELL_H + MAX_LEVEL * RISE + 8;
const ORIGIN_X = WIDTH / 2;
const ORIGIN_Y = MAX_LEVEL * RISE + CELL_H / 2 + 2;
/** Tints of the floor, one per level: the higher, the lighter. */
const TINTS = ['#6d5fb0', '#8174c4', '#968bd6', '#b0a6e6', '#cbc3f3'];

const center = (i: number, j: number) => ({ x: ORIGIN_X + (i - j) * (CELL_W / 2), y: ORIGIN_Y + (i + j) * (CELL_H / 2) });

/** The cell under a point of the drawing (flat, like the grid itself), or null. */
function cellAt(x: number, y: number): { i: number; j: number } | null {
  const a = (x - ORIGIN_X) / (CELL_W / 2);
  const b = (y - ORIGIN_Y) / (CELL_H / 2);
  const i = Math.round((a + b) / 2);
  const j = Math.round((b - a) / 2);
  return i >= 0 && j >= 0 && i < N && j < N ? { i, j } : null;
}

const withCell = (layout: RoomLayout, i: number, j: number, ch: string): RoomLayout => {
  const k = i * N + j;
  return { ...layout, cells: layout.cells.slice(0, k) + ch + layout.cells.slice(k + 1) };
};

/**
 * Pick or draw the shape of the apartment: ready-made shapes, or cells to add, remove and raise one by one.
 * The server judges the result in the end; the same rules run here so that the player sees the problem before sending.
 */
export function createShapeEditor(): HTMLElement {
  const root = el('section', 'shape-editor');
  root.append(el('h2', undefined, 'Forme de la pièce'));

  let saved: RoomLayout | null = null;
  let draft: RoomLayout | null = null;
  let tool: Tool = { kind: 'floor', level: 0 };

  const presets = el('div', 'shape-presets');
  for (const p of LAYOUT_PRESETS) {
    const b = el('button', undefined, p.name);
    b.type = 'button';
    b.addEventListener('click', () => {
      draft = { cells: p.layout.cells, door: { ...p.layout.door } };
      refresh();
    });
    presets.append(b);
  }

  const tools = el('div', 'shape-tools');
  const toolButtons: { tool: Tool; button: HTMLButtonElement }[] = [];
  const addTool = (label: string, t: Tool, title: string) => {
    const b = el('button', undefined, label);
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', () => {
      tool = t;
      refresh();
    });
    toolButtons.push({ tool: t, button: b });
    tools.append(b);
  };
  addTool('Retirer', { kind: 'void' }, 'Enlever le sol d’une case');
  for (let level = 0; level <= MAX_LEVEL; level++) {
    addTool(level === 0 ? 'Sol' : `Niv. ${level}`, { kind: 'floor', level }, level === 0 ? 'Poser un sol plat' : `Poser un sol surélevé de ${level} niveau${level > 1 ? 'x' : ''}`);
  }
  addTool('Porte', { kind: 'door' }, 'Placer la porte, là où on entre');

  const canvas = el('canvas', 'shape-canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  canvas.setAttribute('aria-label', 'Dessin de la forme de la pièce');
  const ctx = canvas.getContext('2d')!;

  const problem = el('p', 'error small');
  problem.setAttribute('role', 'status');
  const hint = el('p', 'muted small', 'Clique ou glisse sur les cases. Une marche fait un niveau au plus. Les meubles qui n’ont plus de sol retournent dans ton inventaire.');
  const apply = el('button', undefined, 'Enregistrer la forme');
  apply.type = 'button';
  const reset = el('button', undefined, 'Annuler');
  reset.type = 'button';
  const actions = el('div', 'settings-row');
  actions.append(apply, reset);
  const result = el('p', 'muted small');
  result.setAttribute('role', 'status');

  root.append(presets, tools, canvas, problem, hint, actions, result);

  function paintCell(layout: RoomLayout, i: number, j: number) {
    const level = levelAt(layout, i, j);
    const c = center(i, j);
    if (level === null) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - CELL_H / 2 + 3);
      ctx.lineTo(c.x + CELL_W / 2 - 5, c.y);
      ctx.lineTo(c.x, c.y + CELL_H / 2 - 3);
      ctx.lineTo(c.x - CELL_W / 2 + 5, c.y);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(167,159,203,0.35)';
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    const y = c.y - level * RISE;
    // The side of a raised cell, then its top.
    if (level > 0) {
      ctx.fillStyle = '#3b3366';
      ctx.beginPath();
      ctx.moveTo(c.x - CELL_W / 2, y);
      ctx.lineTo(c.x, y + CELL_H / 2);
      ctx.lineTo(c.x + CELL_W / 2, y);
      ctx.lineTo(c.x + CELL_W / 2, y + level * RISE);
      ctx.lineTo(c.x, c.y + CELL_H / 2);
      ctx.lineTo(c.x - CELL_W / 2, y + level * RISE);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(c.x, y - CELL_H / 2);
    ctx.lineTo(c.x + CELL_W / 2, y);
    ctx.lineTo(c.x, y + CELL_H / 2);
    ctx.lineTo(c.x - CELL_W / 2, y);
    ctx.closePath();
    ctx.fillStyle = TINTS[level] ?? TINTS[0]!;
    ctx.fill();
    ctx.strokeStyle = 'rgba(23,19,42,0.55)';
    ctx.stroke();
    if (level > 0) {
      ctx.fillStyle = '#17132a';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(level), c.x, y);
    }
  }

  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!draft) return;
    // Back to front, so that a raised cell hides what is behind it.
    for (let s = 0; s <= 2 * (N - 1); s++) {
      for (let i = 0; i < N; i++) {
        const j = s - i;
        if (j >= 0 && j < N) paintCell(draft, i, j);
      }
    }
    // The door: a gold ring and a small arrow on the cell.
    const d = draft.door;
    const level = levelAt(draft, d.i, d.j);
    if (level !== null) {
      const c = center(d.i, d.j);
      const y = c.y - level * RISE;
      ctx.beginPath();
      ctx.moveTo(c.x, y - CELL_H / 2 + 2);
      ctx.lineTo(c.x + CELL_W / 2 - 4, y);
      ctx.lineTo(c.x, y + CELL_H / 2 - 2);
      ctx.lineTo(c.x - CELL_W / 2 + 4, y);
      ctx.closePath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffc857';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#ffc857';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', c.x, y);
    }
  }

  function refresh() {
    paint();
    const p = draft ? layoutProblem(draft) : null;
    problem.textContent = p ?? '';
    const changed = !!draft && !!saved && !sameLayout(draft, saved);
    apply.disabled = !!p || !changed;
    reset.disabled = !changed;
    for (const { tool: t, button } of toolButtons) {
      const active = t.kind === tool.kind && (t.kind !== 'floor' || (tool.kind === 'floor' && t.level === tool.level));
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function applyTool(i: number, j: number) {
    if (!draft) return;
    if (tool.kind === 'door') {
      if (hasFloor(draft, i, j)) draft = { ...draft, door: { i, j } };
    } else if (tool.kind === 'void') {
      draft = withCell(draft, i, j, 'x');
    } else {
      draft = withCell(draft, i, j, String(tool.level));
    }
    refresh();
  }

  let painting = false;
  const pointer = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return cellAt(((ev.clientX - r.left) / r.width) * WIDTH, ((ev.clientY - r.top) / r.height) * HEIGHT);
  };
  canvas.addEventListener('pointerdown', (ev) => {
    const cell = pointer(ev);
    if (!cell) return;
    painting = true;
    canvas.setPointerCapture(ev.pointerId);
    applyTool(cell.i, cell.j);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!painting || tool.kind === 'door') return;
    const cell = pointer(ev);
    if (cell) applyTool(cell.i, cell.j);
  });
  const stop = () => {
    painting = false;
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  reset.addEventListener('click', () => {
    if (saved) draft = { cells: saved.cells, door: { ...saved.door } };
    result.textContent = '';
    refresh();
  });
  apply.addEventListener('click', async () => {
    if (!draft) return;
    apply.disabled = true;
    result.textContent = '';
    const res = await api.updateApartment({ layout: { cells: draft.cells, door: draft.door } });
    if (!res.ok) {
      problem.textContent = res.error;
      apply.disabled = false;
      return;
    }
    saved = res.data.layout;
    draft = { cells: saved.cells, door: { ...saved.door } };
    const away = res.data.putAway ?? 0;
    result.textContent = away > 0 ? `Forme enregistrée. ${away} meuble${away > 1 ? 's sont retournés' : ' est retourné'} dans ton inventaire.` : 'Forme enregistrée.';
    refresh();
  });

  void api.myApartment().then((res) => {
    if (!res.ok) return;
    saved = res.data.layout;
    draft = { cells: saved.cells, door: { ...saved.door } };
    refresh();
  });
  return root;
}
