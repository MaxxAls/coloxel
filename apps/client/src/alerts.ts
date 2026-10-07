import type { FriendTarget } from './api';

/** An announcement of the staff, as the server sends it. */
export interface StaffAlert {
  kind: 'hotel' | 'event' | 'room' | 'user';
  text: string;
  from: string;
  /** A page of the website (":hal"). */
  link?: string;
  /** Where an event is held (":ea"). */
  target?: FriendTarget;
}

const TITLES: Record<StaffAlert['kind'], string> = {
  hotel: 'Message de l’équipe',
  event: 'Événement !',
  room: 'Message de l’équipe à la salle',
  user: 'Message de l’équipe pour toi',
};

const DISPLAY_MS = 14_000;

function stack(): HTMLElement {
  let box = document.querySelector<HTMLElement>('.alert-stack');
  if (!box) {
    box = document.createElement('div');
    box.className = 'alert-stack';
    box.setAttribute('aria-live', 'assertive');
    document.body.append(box);
  }
  return box;
}

/** A banner at the top of the screen: whoever sent it, what it says, and a button when it leads somewhere. */
export function showAlert(alert: StaffAlert, go: (target: FriendTarget) => void) {
  const card = document.createElement('div');
  card.className = `alert-card ${alert.kind}`;
  card.setAttribute('role', 'alert');
  const title = document.createElement('strong');
  title.textContent = TITLES[alert.kind];
  const text = document.createElement('p');
  text.textContent = alert.text;
  const from = document.createElement('small');
  from.textContent = `— ${alert.from}`;
  const row = document.createElement('div');
  row.className = 'alert-actions';
  const close = () => card.remove();

  if (alert.target) {
    const target = alert.target;
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'primary';
    join.textContent = 'Rejoindre';
    join.addEventListener('click', () => {
      close();
      go(target);
    });
    row.append(join);
  }
  // Only a page of our own website: the server checks it too.
  if (alert.link && /^\/(site|admin\.html)[A-Za-z0-9/_.#?=-]*$/.test(alert.link)) {
    const more = document.createElement('a');
    more.className = 'button';
    more.href = alert.link;
    more.target = '_blank';
    more.rel = 'noopener';
    more.textContent = 'En savoir plus';
    row.append(more);
  }
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'OK';
  dismiss.addEventListener('click', close);
  row.append(dismiss);

  card.append(title, text, from, row);
  stack().append(card);
  setTimeout(close, DISPLAY_MS);
}

/** A member of the staff asks us to join them: we go if we want to. */
export function showSummon(from: string, target: FriendTarget, go: (target: FriendTarget) => void) {
  showAlert({ kind: 'user', text: `${from} te demande de le rejoindre.`, from, target }, go);
}
