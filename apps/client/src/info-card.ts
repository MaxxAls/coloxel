/** The small card at the top left of the screen: where the player is, who is here, and where they can go from here. */
export interface InfoCard {
  element: HTMLElement;
  /** The line telling who is here: the scene keeps it up to date. */
  present: HTMLElement;
}

export interface InfoAction {
  label: string;
  run(): void;
  /** A quiet link rather than a button (reports). */
  quiet?: boolean;
}

export interface InfoCardOptions {
  title: string;
  subtitle?: string;
  actions: InfoAction[];
  /** More to show under the buttons (a legend, a hint). */
  extra?: HTMLElement[];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createInfoCard(options: InfoCardOptions): InfoCard {
  const root = el('section', 'room-info');
  root.setAttribute('aria-label', 'Où tu es');
  const title = el('strong', 'room-title', options.title);
  const present = el('p', 'present small');
  present.setAttribute('role', 'status');
  root.append(title);
  if (options.subtitle) root.append(el('p', 'muted small', options.subtitle));
  root.append(present);

  const buttons = el('div', 'room-actions');
  const quiet = el('div', 'room-quiet');
  for (const action of options.actions) {
    const b = el('button', action.quiet ? 'link flag' : undefined, action.label);
    b.type = 'button';
    b.addEventListener('click', action.run);
    (action.quiet ? quiet : buttons).append(b);
  }
  if (buttons.children.length) root.append(buttons);
  if (options.extra) root.append(...options.extra);
  if (quiet.children.length) root.append(quiet);
  return { element: root, present };
}
