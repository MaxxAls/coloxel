import { Container, Graphics, Text, type Ticker } from 'pixi.js';
import { wallStyle } from '@coloxel/render';
import { api, apartmentTitle, type BuildingApartment } from './api';
import { FONT, type Scene, type SceneHost } from './scene';

const W = 300;
const CELL_W = 50;
const CELL_H = 34;
const ROOF_H = 34;
const HALL_H = 40;
const STREET_H = 18;
const REFRESH_MS = 4000;

interface Layout {
  floors: number;
  perFloor: number;
  /** Left edge of the building body. */
  x0: number;
  /** Top of the topmost floor. */
  y0: number;
  height: number;
}

function layoutFor(apartments: BuildingApartment[]): Layout {
  const floors = Math.max(6, ...apartments.map((a) => a.floor));
  const perFloor = Math.max(5, ...apartments.map((a) => a.slot + 1));
  const x0 = Math.floor((W - perFloor * CELL_W) / 2);
  return { floors, perFloor, x0, y0: ROOF_H, height: ROOF_H + floors * CELL_H + HALL_H + STREET_H };
}

const cellRect = (l: Layout, a: BuildingApartment) => ({
  x: l.x0 + a.slot * CELL_W + 1,
  y: l.y0 + (l.floors - a.floor) * CELL_H + 1,
  w: CELL_W - 2,
  h: CELL_H - 2,
});

const hallRect = (l: Layout) => ({
  x: l.x0 + Math.floor((l.perFloor * CELL_W) / 2) - 40,
  y: l.y0 + l.floors * CELL_H + 6,
  w: 80,
  h: HALL_H - 8,
});

const shortName = (name: string) => (name.length > 5 ? name.slice(0, 5) : name);

function statusText(a: BuildingApartment): string {
  if (!a.owner) return 'Appartement libre';
  const people = a.visitors > 0 ? ` · ${a.visitors} ${a.visitors > 1 ? 'personnes' : 'personne'} dedans` : '';
  if (a.mine) return `${a.name ?? 'Ton appart'}${people}`;
  const owner = a.name ? ` · ${a.owner.nickname}` : '';
  return `${apartmentTitle(a.name, a.owner.nickname)}${owner} · ${a.open ? 'ouvert' : 'fermé'}${people}`;
}

export async function createBuildingScene(host: SceneHost): Promise<Scene | { error: string }> {
  const { app } = host;
  const first = await api.building();
  if (!first.ok) {
    if (first.status === 401) location.reload();
    return { error: first.error };
  }
  let apartments = first.data.apartments;
  let layout = layoutFor(apartments);

  const abort = new AbortController();
  const world = new Container();
  app.stage.addChild(world);

  const backdrop = new Graphics();
  const facade = new Graphics();
  const figures = new Graphics();
  const highlight = new Graphics();
  const labels = new Container();
  const hallSign = new Text({
    text: 'HALL',
    style: { fontFamily: FONT, fontSize: 8, fill: 0xffc857 },
  });
  hallSign.anchor.set(0.5, 0);
  world.addChild(backdrop, facade, figures, highlight, labels, hallSign);

  // Fixed stars, so the sky does not flicker on every redraw.
  const stars = Array.from({ length: 46 }, (_, k) => ({
    x: (k * 97) % W,
    y: (k * 53) % 150,
    phase: k * 1.7,
    big: k % 7 === 0,
  }));

  function drawBackdrop(now: number) {
    const H = layout.height;
    backdrop.clear();
    // Dusk sky in bands.
    const bands = [0x1a1046, 0x2a1a5e, 0x3e2477, 0x5a2f86, 0x7a3b8f, 0xa14a93];
    bands.forEach((c, k) => backdrop.rect(0, (k * H) / bands.length, W, H / bands.length + 1).fill(c));
    for (const s of stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(now / 600 + s.phase);
      backdrop.rect(s.x, s.y, s.big ? 2 : 1, s.big ? 2 : 1).fill({ color: 0xfff3d6, alpha: 0.35 + 0.6 * twinkle });
    }
    // Moon.
    backdrop.circle(256, 22, 11).fill(0xfff3d6);
    backdrop.circle(260, 19, 10).fill(0x2a1a5e);
    // Drifting clouds.
    for (const [k, y] of [[0, 56], [1, 98]] as const) {
      const x = ((now / (k ? 420 : 300) + k * 140) % (W + 80)) - 40;
      backdrop.ellipse(x, y, 20, 5).fill({ color: 0xe9d6ff, alpha: 0.16 });
      backdrop.ellipse(x + 10, y - 3, 12, 4).fill({ color: 0xe9d6ff, alpha: 0.16 });
    }
    // Skyline behind the building.
    const base = layout.y0 + layout.floors * CELL_H;
    const towers = [[0, 28, 70], [24, 22, 96], [250, 26, 84], [274, 26, 60]] as const;
    for (const [x, w, h] of towers) {
      backdrop.rect(x, base - h, w, h).fill(0x241552);
      for (let wy = base - h + 6; wy < base - 8; wy += 9) {
        for (let wx = x + 4; wx < x + w - 4; wx += 7) {
          if ((wx * 7 + wy * 3) % 5 < 2) backdrop.rect(wx, wy, 3, 4).fill({ color: 0xffc857, alpha: 0.55 });
        }
      }
    }
    // Street and sidewalk.
    const streetY = layout.y0 + layout.floors * CELL_H + HALL_H;
    backdrop.rect(0, streetY, W, STREET_H).fill(0x1b1530);
    backdrop.rect(0, streetY, W, 3).fill(0x5a4a8a);
    for (let x = 6; x < W; x += 26) backdrop.rect(x, streetY + 10, 12, 2).fill(0x5a4a8a);
    for (const lx of [10, 290]) {
      backdrop.rect(lx - 1, streetY - 30, 2, 30).fill(0x1b1530);
      backdrop.circle(lx, streetY - 31, 3).fill(0xffe9a8);
      backdrop.circle(lx, streetY - 31, 7).fill({ color: 0xffe9a8, alpha: 0.18 });
    }
  }

  function drawFacade(now: number) {
    const { x0, y0, floors, perFloor } = layout;
    const bw = perFloor * CELL_W;
    facade.clear();
    // Body, with the parapet and the antenna on the roof.
    facade.rect(x0 - 4, y0 - 6, bw + 8, floors * CELL_H + HALL_H + 6).fill(0x2f2760);
    facade.rect(x0 - 6, y0 - 10, bw + 12, 6).fill(0x4a3f7a);
    facade.rect(x0 - 6, y0 - 10, bw + 12, 2).fill(0x6c61a3);
    facade.rect(x0 + bw - 24, y0 - 24, 2, 14).fill(0x1b1530);
    const blink = Math.sin(now / 500) > 0;
    facade.circle(x0 + bw - 23, y0 - 25, 2).fill(blink ? 0xff5a5a : 0x7a2a3a);
    // Chimney-like water tank.
    facade.rect(x0 + 10, y0 - 22, 14, 12).fill(0x4a3f7a);
    facade.rect(x0 + 8, y0 - 24, 18, 3).fill(0x6c61a3);

    for (const a of apartments) {
      const r = cellRect(layout, a);
      const lit = !!a.owner;
      // The wallpaper its owner picked tints the whole apartment.
      const color = wallStyle(a.wall).left;
      if (!lit) {
        // Empty apartment: dark, waiting for someone.
        facade.rect(r.x, r.y, r.w, r.h).fill(0x241d44);
        facade.rect(r.x + 6, r.y + 6, 12, 12).fill(0x1a1536);
        facade.rect(r.x + r.w - 14, r.y + r.h - 9, 8, 3).fill(0x3b3366);
        continue;
      }
      // Wall, floor, window, a little lamp glow.
      facade.rect(r.x, r.y, r.w, r.h).fill(color);
      facade.rect(r.x, r.y, r.w, 8).fill({ color: 0xffffff, alpha: 0.16 });
      facade.rect(r.x, r.y + r.h - 8, r.w, 8).fill(0xb88b56);
      facade.rect(r.x, r.y + r.h - 8, r.w, 1).fill(0x8f6a3e);
      facade.rect(r.x + r.w - 17, r.y + 8, 12, 12).fill(0x4a3f7a);
      facade.rect(r.x + r.w - 16, r.y + 9, 10, 10).fill(0x9fd3f0);
      facade.rect(r.x + r.w - 12, r.y + 9, 1, 10).fill(0x4a3f7a);
      if (!a.open && !a.mine) {
        // Closed to this player: shaded, with a padlock.
        facade.rect(r.x, r.y, r.w, r.h).fill({ color: 0x1a1046, alpha: 0.55 });
        const lx = r.x + r.w / 2 - 4;
        const ly = r.y + r.h / 2 - 1;
        facade.rect(lx, ly + 3, 8, 6).fill(0xffc857);
        facade.rect(lx + 1, ly - 1, 1, 4).fill(0xffc857);
        facade.rect(lx + 6, ly - 1, 1, 4).fill(0xffc857);
        facade.rect(lx + 1, ly - 2, 6, 1).fill(0xffc857);
      }
      if (a.mine) {
        facade.rect(r.x, r.y, r.w, 2).fill(0xffc857);
        facade.rect(r.x, r.y + r.h - 2, r.w, 2).fill(0xffc857);
        facade.rect(r.x, r.y, 2, r.h).fill(0xffc857);
        facade.rect(r.x + r.w - 2, r.y, 2, r.h).fill(0xffc857);
      }
    }
    // Floor slabs between the rows.
    for (let f = 0; f <= floors; f++) facade.rect(x0, y0 + f * CELL_H - 1, bw, 2).fill(0x1b1530);
    for (let s = 0; s <= perFloor; s++) facade.rect(x0 + s * CELL_W - 1, y0, 2, floors * CELL_H).fill(0x1b1530);

    // Ground floor: glass doors under a striped awning.
    const h = hallRect(layout);
    facade.rect(h.x - 4, h.y - 2, h.w + 8, h.h + 2).fill(0x4a3f7a);
    facade.rect(h.x, h.y + 14, h.w, h.h - 14).fill(0x9fd3f0);
    facade.rect(h.x + h.w / 2 - 1, h.y + 14, 2, h.h - 14).fill(0x4a3f7a);
    facade.rect(h.x, h.y + 14, h.w, 4).fill({ color: 0xffffff, alpha: 0.25 });
    // Lit sign plaque under the striped awning.
    facade.rect(h.x + 12, h.y + 3, h.w - 24, 11).fill(0x1b1530);
    for (let k = 0; k < 10; k++) facade.rect(h.x - 4 + k * 8.8, h.y - 4, 8.8, 5).fill(k % 2 ? 0xfff3d6 : 0xe2483d);
    hallSign.position.set(h.x + h.w / 2, h.y + 4);
  }

  function drawFigures(now: number) {
    figures.clear();
    for (const a of apartments) {
      if (!a.owner || a.visitors <= 0) continue;
      const r = cellRect(layout, a);
      const count = Math.min(3, a.visitors);
      for (let k = 0; k < count; k++) {
        const sway = Math.sin(now / 700 + k * 2 + a.id) * 1.2;
        const fx = r.x + 8 + k * 11 + sway;
        const fy = r.y + r.h - 8;
        // A shadow of a person: head and body, dark and a little see-through.
        figures.circle(fx, fy - 11, 2.6).fill({ color: 0x1b1530, alpha: 0.82 });
        figures.roundRect(fx - 3, fy - 8, 6, 8, 2).fill({ color: 0x1b1530, alpha: 0.82 });
      }
    }
  }

  function rebuildLabels() {
    labels.removeChildren().forEach((c) => c.destroy());
    for (const a of apartments) {
      if (!a.owner) continue;
      const r = cellRect(layout, a);
      const t = new Text({
        text: shortName(a.owner.nickname),
        style: { fontFamily: FONT, fontSize: 8, fill: a.mine ? 0xffc857 : 0xffffff, stroke: { color: 0x1b1530, width: 2 } },
      });
      t.position.set(r.x + 2, r.y + 2);
      labels.addChild(t);
    }
  }

  // ----- Panel -------------------------------------------------------------
  const panel = document.createElement('aside');
  panel.className = 'panel building-panel';
  const title = document.createElement('h2');
  title.textContent = 'L’immeuble';
  const intro = document.createElement('p');
  intro.className = 'muted small';
  intro.textContent = 'Clique sur un appartement éclairé pour y entrer. Les silhouettes montrent qui est chez soi.';
  const legend = document.createElement('ul');
  legend.className = 'legend';
  for (const [swatch, text] of [
    ['mine', 'Ton appart'],
    ['open', 'Ouvert aux visiteurs'],
    ['closed', 'Fermé'],
    ['empty', 'Libre'],
  ] as const) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = `swatch ${swatch}`;
    li.append(dot, text);
    legend.append(li);
  }
  const summary = document.createElement('p');
  summary.className = 'present small';
  summary.setAttribute('role', 'status');
  const buttons = document.createElement('div');
  buttons.className = 'visit-links';
  const goHome = document.createElement('button');
  goHome.type = 'button';
  goHome.className = 'primary';
  goHome.textContent = 'Mon appart';
  goHome.addEventListener('click', () => host.go({ kind: 'apartment', ownerId: host.user.id }));
  const goHall = document.createElement('button');
  goHall.type = 'button';
  goHall.textContent = 'Le hall';
  goHall.addEventListener('click', () => host.go({ kind: 'hall' }));
  buttons.append(goHome, goHall);
  panel.append(title, intro, legend, summary, buttons);

  const updateSummary = () => {
    const inside = apartments.reduce((n, a) => n + a.visitors, 0);
    const taken = apartments.filter((a) => a.owner).length;
    summary.textContent = `${taken}/${apartments.length} appartements habités · ${inside} ${inside > 1 ? 'personnes chez elles' : 'personne chez elle'}`;
  };

  // ----- Pointer -----------------------------------------------------------
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.hidden = true;
  document.body.append(tooltip);

  type Hit = { kind: 'apartment'; apartment: BuildingApartment } | { kind: 'hall' } | null;
  const toGame = (ev: PointerEvent | MouseEvent) => {
    const r = app.canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) * W) / r.width, y: ((ev.clientY - r.top) * layout.height) / r.height };
  };
  const hit = (x: number, y: number): Hit => {
    const h = hallRect(layout);
    if (x >= h.x - 4 && x <= h.x + h.w + 4 && y >= h.y - 4 && y <= h.y + h.h) return { kind: 'hall' };
    for (const a of apartments) {
      const r = cellRect(layout, a);
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return { kind: 'apartment', apartment: a };
    }
    return null;
  };
  let hovered: Hit = null;

  app.canvas.addEventListener(
    'pointermove',
    (ev) => {
      const p = toGame(ev);
      hovered = hit(p.x, p.y);
      app.canvas.style.cursor = hovered && (hovered.kind === 'hall' || hovered.apartment.owner) ? 'pointer' : 'default';
      if (!hovered) {
        tooltip.hidden = true;
        return;
      }
      tooltip.textContent = hovered.kind === 'hall' ? 'Le hall · rez-de-chaussée' : statusText(hovered.apartment);
      tooltip.style.left = `${ev.clientX + 14}px`;
      tooltip.style.top = `${ev.clientY + 14}px`;
      tooltip.hidden = false;
    },
    { signal: abort.signal },
  );
  app.canvas.addEventListener(
    'pointerleave',
    () => {
      hovered = null;
      tooltip.hidden = true;
    },
    { signal: abort.signal },
  );
  app.canvas.addEventListener(
    'click',
    (ev) => {
      const p = toGame(ev);
      const target = hit(p.x, p.y);
      if (!target) return;
      if (target.kind === 'hall') return host.go({ kind: 'hall' });
      const a = target.apartment;
      if (!a.owner) return host.notify('Cet appartement est libre : un nouveau voisin arrivera bientôt.');
      if (a.mine || a.open) return host.go({ kind: 'apartment', ownerId: a.owner.id });
      host.notify(`L’appartement de ${a.owner.nickname} est fermé.`);
    },
    { signal: abort.signal },
  );

  // ----- Refresh and frame loop --------------------------------------------
  const apply = (next: BuildingApartment[]) => {
    apartments = next;
    layout = layoutFor(next);
    rebuildLabels();
    updateSummary();
  };
  apply(apartments);

  const timer = setInterval(async () => {
    const res = await api.building();
    if (res.ok) apply(res.data.apartments);
  }, REFRESH_MS);

  const tick = (_ticker: Ticker) => {
    const now = performance.now();
    drawBackdrop(now);
    drawFacade(now);
    drawFigures(now);
    highlight.clear();
    if (hovered) {
      const r = hovered.kind === 'hall' ? hallRect(layout) : cellRect(layout, hovered.apartment);
      highlight.rect(r.x, r.y, r.w, r.h).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
    }
  };
  app.ticker.add(tick);

  return {
    panel,
    get size() {
      return { w: W, h: layout.height };
    },
    destroy() {
      abort.abort();
      clearInterval(timer);
      app.ticker.remove(tick);
      tooltip.remove();
      app.canvas.style.cursor = 'default';
      world.destroy({ children: true });
    },
  };
}
