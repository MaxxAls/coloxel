import { api } from './api';

// The owner announces an event in their apartment ("karaoke night!"): the navigator lists it for two hours.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createEventEditor(): HTMLElement {
  const root = el('section', 'event-editor');
  root.append(el('h2', undefined, 'Événement'));
  const now = el('p', 'muted small');
  const title = el('input');
  title.maxLength = 60;
  title.placeholder = 'Soirée karaoké, défilé de mode, quiz…';
  title.setAttribute('aria-label', 'Titre de l’événement');
  const announce = el('button', 'primary', 'Annoncer pour 2 h');
  announce.type = 'button';
  const stop = el('button', undefined, 'Arrêter');
  stop.type = 'button';
  const row = el('div', 'settings-row');
  row.append(title, announce, stop);
  const result = el('p', 'muted small');
  result.setAttribute('role', 'status');
  root.append(now, row, result);

  const show = (event: { title: string; endsAt: string } | null) => {
    stop.disabled = !event;
    now.textContent = event
      ? `En cours : « ${event.title} », jusqu’à ${new Date(event.endsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`
      : 'Annonce ce qui se passe chez toi : l’événement apparaît dans le navigateur pendant 2 heures.';
  };
  announce.addEventListener('click', async () => {
    result.textContent = '';
    announce.disabled = true;
    const res = await api.announceEvent(title.value);
    announce.disabled = false;
    if (!res.ok) {
      result.textContent = res.error;
      return;
    }
    title.value = '';
    show(res.data.event);
    result.textContent = 'Événement annoncé !';
  });
  stop.addEventListener('click', async () => {
    const res = await api.endEvent();
    if (res.ok) show(null);
  });
  show(null);
  void api.myEvent().then((res) => {
    if (res.ok) show(res.data.event);
  });
  return root;
}
