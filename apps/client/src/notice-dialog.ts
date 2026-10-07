import { windowBar } from './window';

const queue: { text: string; onClose?: () => void }[] = [];
let showing: HTMLElement | null = null;

function next() {
  const item = queue.shift();
  if (!item) return;
  const back = document.createElement('div');
  back.className = 'modal-back';
  const dialog = document.createElement('div');
  dialog.className = 'window modal';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-label', 'Message de l’équipe');
  const body = document.createElement('div');
  body.className = 'win-body';
  const text = document.createElement('p');
  text.className = 'notice-text';
  text.textContent = item.text;
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'primary';
  ok.textContent = 'J’ai compris';
  const close = () => {
    back.remove();
    showing = null;
    item.onClose?.();
    next();
  };
  ok.addEventListener('click', close);
  body.append(text, ok);
  dialog.append(windowBar('Message de l’équipe', close), body);
  back.append(dialog);
  document.body.append(back);
  showing = back;
  ok.focus();
}

/** A message from the staff the player must read: shown over everything, one after the other. */
export function showNotice(text: string, onClose?: () => void) {
  queue.push({ text, onClose });
  if (!showing) next();
}
