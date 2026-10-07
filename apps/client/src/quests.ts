import { api, type Quest } from './api';
import { windowBar } from './window';

export interface Quests {
  element: HTMLElement;
  isOpen(): boolean;
  toggle(): void;
  close(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The challenges: what to do, how far the player is, what each step pays. The server counts; this only shows. */
export function createQuests(options: { onToggle(open: boolean): void }): Quests {
  const root = el('section', 'window navigator quests');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Défis');
  const list = el('ul', 'nav-list');
  const status = el('p', 'muted small');
  const body = el('div', 'win-body');
  body.append(status, list);
  root.append(windowBar('Défis', () => hide()), body);

  const card = (q: Quest) => {
    const li = el('li', q.done ? 'quest done' : 'quest');
    const next = q.tiers.find((t) => !t.done);
    const head = el('div', 'quest-head');
    head.append(el('strong', undefined, q.title), el('span', 'badge', q.done ? 'Terminé' : `${q.tier}/${q.tiers.length}`));
    li.append(head, el('p', 'muted small', q.description));
    // Progress towards the next goal, or the last one when everything is done.
    const goal = next ?? q.tiers[q.tiers.length - 1]!;
    const bar = el('div', 'quest-bar');
    const fill = el('span');
    fill.style.width = `${Math.min(100, Math.round((q.count / goal.goal) * 100))}%`;
    bar.append(fill);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(goal.goal));
    bar.setAttribute('aria-valuenow', String(Math.min(q.count, goal.goal)));
    li.append(bar);
    li.append(
      el('p', 'small', next ? `${Math.min(q.count, next.goal)} / ${next.goal} — prochaine récompense : ${next.reward} Pixels` : `${q.count} fois. Toutes les récompenses sont prises.`),
    );
    return li;
  };

  async function refresh() {
    const res = await api.quests();
    if (!res.ok) {
      status.textContent = res.error;
      return;
    }
    status.textContent = '';
    list.replaceChildren(...res.data.quests.map(card));
  }

  function hide() {
    if (root.hidden) return;
    root.hidden = true;
    options.onToggle(false);
  }
  const open = () => {
    root.hidden = false;
    status.textContent = 'Chargement…';
    void refresh();
    options.onToggle(true);
  };
  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') hide();
  });
  addEventListener('pointerdown', (ev) => {
    const t = ev.target as Node;
    if (!root.hidden && !root.contains(t) && !(t as HTMLElement).closest?.('[data-quests-toggle]')) hide();
  });

  return { element: root, isOpen: () => !root.hidden, toggle: () => (root.hidden ? open() : hide()), close: hide };
}
