// Backdrop of the website: a pixel-art dusk over a city of cut-away apartments, where tiny people
// walk from room to room. Drawn at a low resolution and scaled up without smoothing.
(() => {
  const canvas = document.getElementById('city');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 480;
  const H = 240;
  canvas.width = W;
  canvas.height = H;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SKY = ['#150d3a', '#1d1150', '#2a1468', '#411a79', '#6a2288', '#9a2d90', '#cf4a8c', '#f06a7e', '#ff9a78', '#ffc680'];
  const WALLS = ['#8a7fc0', '#e58fb0', '#7fc4c0', '#f0b86e', '#9a8ae0', '#86c47a'];
  const FLOORS = ['#b88b56', '#a67a49', '#c79a62'];
  const SKIN = ['#f3c9a0', '#e0a878', '#b9835a', '#8a5a3c'];
  const SHIRTS = ['#ff5a7a', '#ffc857', '#6be2a3', '#5ab8ff', '#b78cff', '#ff9a5a', '#f1ecff'];

  function rand(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const rnd = rand(20261007);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const rect = (x, y, w, h, c, a = 1) => {
    ctx.globalAlpha = a;
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
    ctx.globalAlpha = 1;
  };

  // ----- Static scenery, drawn once -----------------------------------------
  const back = document.createElement('canvas');
  back.width = W;
  back.height = H;
  const bctx = back.getContext('2d');
  const brect = (x, y, w, h, c, a = 1) => {
    bctx.globalAlpha = a;
    bctx.fillStyle = c;
    bctx.fillRect(Math.round(x), Math.round(y), w, h);
    bctx.globalAlpha = 1;
  };
  const GROUND = 204;
  SKY.forEach((c, k) => brect(0, (k * GROUND) / SKY.length, W, Math.ceil(GROUND / SKY.length) + 1, c));
  // Two layers of far skyline.
  for (const [layer, color, base, top] of [[0, '#3a1a6e', GROUND - 4, 46], [1, '#2a1255', GROUND, 66]]) {
    let x = layer * 11 - 8;
    while (x < W) {
      const w = 12 + Math.floor(rnd() * 22);
      const h = 14 + Math.floor(rnd() * top);
      brect(x, base - h, w, h + 4, color);
      for (let wy = base - h + 4; wy < base - 4; wy += 6) {
        for (let wx = x + 3; wx < x + w - 3; wx += 5) if (rnd() < 0.3) brect(wx, wy, 2, 3, '#ffc680', 0.7);
      }
      x += w + 1 + Math.floor(rnd() * 3);
    }
  }
  // Street.
  brect(0, GROUND, W, H - GROUND, '#1c1236');
  brect(0, GROUND, W, 2, '#3b2c6e');
  brect(0, GROUND + 12, W, 1, '#2c2152');
  for (let x = 6; x < W; x += 58) {
    brect(x, GROUND - 22, 1, 22, '#5a4d99');
    brect(x - 2, GROUND - 24, 6, 2, '#5a4d99');
  }

  // ----- Buildings ------------------------------------------------------------
  const rooms = [];
  function building(x0, floors, cols, colW) {
    const floorH = 30;
    const w = cols * colW + 4;
    const h = floors * floorH + 4;
    const y0 = GROUND - h;
    brect(x0 - 2, y0 - 4, w + 4, h + 4, '#2a1d52');
    brect(x0 - 2, y0 - 6, w + 4, 3, '#4a3a86');
    brect(x0 + 8, y0 - 14, 6, 9, '#3a2c6e');
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        const rx = x0 + 2 + c * colW;
        const ry = y0 + 2 + f * floorH;
        const wall = pick(WALLS);
        brect(rx, ry, colW - 2, floorH - 2, wall);
        brect(rx, ry + floorH - 7, colW - 2, 5, pick(FLOORS));
        brect(rx, ry + floorH - 8, colW - 2, 1, '#00000030', 1);
        // A picture on the wall, a window.
        brect(rx + 4, ry + 5, 9, 7, '#f1ecff');
        brect(rx + 5, ry + 6, 7, 5, pick(['#5ab8ff', '#6be2a3', '#ffc857']));
        const room = { x: rx, y: ry + floorH - 8, w: colW - 2, lamp: rnd() < 0.7, lampX: rx + 6 + Math.floor(rnd() * (colW - 16)), people: [] };
        // A small piece of furniture.
        const kind = Math.floor(rnd() * 3);
        const fx = rx + colW - 18;
        if (kind === 0) {
          brect(fx, room.y - 8, 14, 8, '#c4527a');
          brect(fx, room.y - 11, 14, 4, '#e07a9a');
        } else if (kind === 1) {
          brect(fx + 2, room.y - 9, 10, 3, '#8b5e3c');
          brect(fx + 3, room.y - 6, 2, 6, '#6e4a2c');
          brect(fx + 9, room.y - 6, 2, 6, '#6e4a2c');
        } else {
          brect(fx + 5, room.y - 6, 4, 6, '#a0522d');
          brect(fx + 2, room.y - 13, 10, 8, '#4fb35a');
        }
        rooms.push(room);
      }
    }
  }
  const sx = W * 0.64;
  building(Math.round(sx), 3, 3, 40);
  building(Math.round(sx - 128), 2, 2, 40);
  building(Math.round(sx + 134), 2, 1, 40);

  // ----- Little people ----------------------------------------------------------
  const folks = [];
  for (const room of rooms) {
    if (rnd() < 0.75) {
      folks.push({
        room,
        x: room.x + 4 + rnd() * (room.w - 14),
        dir: rnd() < 0.5 ? -1 : 1,
        speed: 0.05 + rnd() * 0.08,
        pause: Math.floor(rnd() * 60),
        skin: pick(SKIN),
        shirt: pick(SHIRTS),
        pants: pick(['#2a3a6e', '#3a2a5e', '#2f4f3a', '#5a3a2a']),
        phase: rnd() * 10,
      });
    }
  }
  const walkers = [];
  for (let k = 0; k < 6; k++) {
    walkers.push({ x: rnd() * W, dir: rnd() < 0.5 ? -1 : 1, speed: 0.1 + rnd() * 0.15, skin: pick(SKIN), shirt: pick(SHIRTS), pants: '#2a2a4a', phase: rnd() * 10 });
  }

  function person(x, y, p, step) {
    const f = Math.floor(step) % 2;
    rect(x + 1, y - 10, 4, 4, p.skin); // head
    rect(x, y - 11, 6, 2, '#2a1a1a'); // hair
    rect(x + 1, y - 6, 4, 4, p.shirt); // body
    rect(x + 1, y - 2, 2, 2, p.pants);
    rect(x + 3, y - 2, 2, 2, p.pants);
    if (f) {
      rect(x + 1, y, 2, 1, '#1a1a1a');
    } else {
      rect(x + 3, y, 2, 1, '#1a1a1a');
    }
  }

  const stars = Array.from({ length: 70 }, () => ({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * 100), p: rnd() * 6, s: rnd() < 0.2 ? 2 : 1 }));
  const clouds = Array.from({ length: 4 }, () => ({ x: rnd() * W, y: 30 + rnd() * 60, w: 24 + rnd() * 30, v: 0.02 + rnd() * 0.03 }));

  let t = 0;
  function frame() {
    t += 1;
    ctx.drawImage(back, 0, 0);
    // Stars and moon.
    for (const s of stars) {
      const a = 0.4 + 0.6 * Math.abs(Math.sin(t / 30 + s.p));
      rect(s.x, s.y, s.s, s.s, '#fff7d6', a);
    }
    rect(W - 70, 24, 16, 16, '#fff3c0');
    rect(W - 64, 24, 10, 16, '#fff3c0');
    rect(W - 66, 26, 3, 3, '#e8d8a0');
    // Clouds.
    for (const c of clouds) {
      if (!reduce) c.x += c.v;
      if (c.x > W + 40) c.x = -60;
      rect(c.x, c.y, c.w, 5, '#ff9a8a', 0.35);
      rect(c.x + 6, c.y - 3, c.w - 14, 4, '#ffb59a', 0.35);
    }
    // Lamps of the rooms glow.
    for (const r of rooms) {
      if (!r.lamp) continue;
      const flick = 0.1 + 0.03 * Math.sin(t / 14 + r.lampX);
      rect(r.lampX, r.y - 12, 2, 12, '#6e4a2c');
      rect(r.lampX - 2, r.y - 17, 6, 5, '#ffd870');
      rect(r.lampX - 12, r.y - 28, 26, 28, '#ffd870', flick);
    }
    // Folks in the rooms.
    for (const p of folks) {
      if (!reduce) {
        if (p.pause > 0) p.pause -= 1;
        else {
          p.x += p.dir * p.speed;
          if (p.x < p.room.x + 2 || p.x > p.room.x + p.room.w - 8) {
            p.dir *= -1;
            p.pause = 30 + Math.floor(rnd() * 120);
          }
        }
      }
      person(p.x, p.room.y, p, p.pause > 0 ? 0 : p.x / 3 + p.phase);
    }
    // People on the street.
    for (const p of walkers) {
      if (!reduce) {
        p.x += p.dir * p.speed;
        if (p.x < -10) p.x = W + 6;
        if (p.x > W + 10) p.x = -6;
      }
      person(p.x, GROUND + 10, p, p.x / 3 + p.phase);
    }
    // A last warm haze at the horizon.
    rect(0, GROUND - 14, W, 14, '#ff9a78', 0.08);
  }

  frame();
  if (reduce) return;
  let last = 0;
  function loop(now) {
    if (now - last > 55) {
      last = now;
      frame();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
