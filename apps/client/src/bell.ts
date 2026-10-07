import { api } from './api';
import type { SceneHost } from './scene';

const POLL_MS = 2000;
const GIVE_UP_MS = 60_000;

let waiting = false;

/**
 * Ring at somebody's door, then wait for an answer: as soon as the owner lets us in we walk in.
 * Asking the server again and again (rather than waiting for a push) works from any screen, the building view included.
 */
export async function ringAndWait(host: Pick<SceneHost, 'go' | 'notify'>, ownerId: string, nickname: string) {
  if (waiting) return host.notify('Tu attends déjà une réponse.');
  const res = await api.ring(ownerId);
  if (!res.ok) return host.notify(res.error);
  if (res.data.status === 'open') return host.go({ kind: 'apartment', ownerId });
  host.notify(`Tu as sonné chez ${nickname}… patiente un instant.`);
  waiting = true;
  try {
    const started = Date.now();
    while (Date.now() - started < GIVE_UP_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const visit = await api.apartment(ownerId);
      if (visit.ok) return host.go({ kind: 'apartment', ownerId });
    }
    host.notify(`${nickname} ne répond pas.`);
  } finally {
    waiting = false;
  }
}

/** The owner's side: somebody rings. A small card with two buttons, gone after a minute. */
export function showRing(visitorId: string, nickname: string, notify: (text: string) => void) {
  const id = `ring-${visitorId}`;
  document.getElementById(id)?.remove();
  const card = document.createElement('div');
  card.id = id;
  card.className = 'ring-card';
  card.setAttribute('role', 'alertdialog');
  const text = document.createElement('p');
  text.textContent = `${nickname} sonne à ta porte.`;
  const answer = (accept: boolean) => async () => {
    const res = await api.answerBell(visitorId, accept);
    card.remove();
    notify(res.ok ? (accept ? `${nickname} peut entrer.` : `${nickname} reste dehors.`) : res.error);
  };
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'primary';
  yes.textContent = 'Ouvrir';
  yes.addEventListener('click', answer(true));
  const no = document.createElement('button');
  no.type = 'button';
  no.textContent = 'Refuser';
  no.addEventListener('click', answer(false));
  const buttons = document.createElement('div');
  buttons.className = 'ring-buttons';
  buttons.append(yes, no);
  card.append(text, buttons);
  let stack = document.querySelector('.ring-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'ring-stack';
    document.body.append(stack);
  }
  stack.append(card);
  setTimeout(() => card.remove(), 60_000);
}
