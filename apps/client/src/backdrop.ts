// The scenery behind the room: dusk sky, aurora, moon, a city skyline with lit windows and drifting lights.
// Pure DOM and CSS (see theme.css); nothing here is game state.

import { seeded, skylineSvg } from '@coloxel/render';

export function createBackdrop(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'backdrop';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="aurora a"></div><div class="aurora b"></div><div class="aurora c"></div>
    <div class="stars"></div>
    <div class="moon"></div>
    ${skylineSvg('skyline')}`;

  // Lights drifting up from the city.
  const colors = ['#ffd98a', '#ff9ccf', '#8ee8ff', '#c7a8ff'];
  const rand = seeded(99);
  for (let i = 0; i < 16; i++) {
    const b = document.createElement('i');
    b.className = 'bokeh';
    b.style.left = `${(rand() * 100).toFixed(1)}%`;
    b.style.bottom = `${(rand() * 22).toFixed(1)}vh`;
    b.style.setProperty('--c', colors[i % colors.length]!);
    b.style.animationDelay = `${(-rand() * 14).toFixed(1)}s`;
    b.style.animationDuration = `${(10 + rand() * 10).toFixed(1)}s`;
    root.append(b);
  }
  return root;
}
