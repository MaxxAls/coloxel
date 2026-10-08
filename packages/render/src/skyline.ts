// The city skyline behind the game and the website: dark towers with a few lit windows, as an SVG string.
// Seeded, so that it is the same on every visit and in every place that draws it.

/** Small seeded generator. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** One row of buildings: `lit` is the share of windows with a light, `height` the tallest tower. */
function layer(seed: number, color: string, height: number, lit: number, windowColors: string[]): string {
  const rand = seeded(seed);
  const W = 1600;
  let x = -20;
  const parts: string[] = [];
  while (x < W + 20) {
    const w = 40 + Math.floor(rand() * 70);
    const h = height * (0.35 + rand() * 0.65);
    const y = 300 - h;
    parts.push(`<rect x="${x}" y="${y.toFixed(1)}" width="${w}" height="${h.toFixed(1)}" fill="${color}"/>`);
    // A roof detail on some towers: an antenna or a stepped top.
    if (rand() > 0.72) parts.push(`<rect x="${x + w / 2 - 1}" y="${(y - 18).toFixed(1)}" width="2" height="18" fill="${color}"/>`);
    else if (rand() > 0.6) parts.push(`<rect x="${x + 8}" y="${(y - 10).toFixed(1)}" width="${w - 16}" height="10" fill="${color}"/>`);
    for (let wy = y + 10; wy < 292; wy += 11) {
      for (let wx = x + 6; wx < x + w - 8; wx += 9) {
        if (rand() < lit) {
          const c = windowColors[Math.floor(rand() * windowColors.length)]!;
          parts.push(`<rect x="${wx}" y="${wy.toFixed(1)}" width="4" height="5" fill="${c}" opacity="${(0.55 + rand() * 0.45).toFixed(2)}"/>`);
        }
      }
    }
    x += w + Math.floor(rand() * 6);
  }
  return `<g>${parts.join('')}</g>`;
}

/** The whole skyline as an `<svg>` element with the given class name, stretched to the width of its container. */
export function skylineSvg(className = 'skyline'): string {
  const far = layer(7, '#241447', 190, 0.1, ['#b9a4ff', '#ffd98a']);
  const near = layer(21, '#120a2a', 150, 0.17, ['#ffd98a', '#ffb25c', '#ff8ac0', '#8ee8ff']);
  return `<svg class="${className}" viewBox="0 0 1600 300" preserveAspectRatio="none" aria-hidden="true">
<defs><linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a3aa8" stop-opacity="0"/><stop offset="1" stop-color="#ff7ab6" stop-opacity="0.28"/></linearGradient></defs>
<rect x="0" y="120" width="1600" height="180" fill="url(#haze)"/>${far}${near}</svg>`;
}
