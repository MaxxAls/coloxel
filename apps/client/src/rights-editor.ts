import { api } from './api';

// The owner lets friends arrange the apartment: they may move and turn what is placed, nothing else.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createRightsEditor(): HTMLElement {
  const root = el('section', 'rights-editor');
  root.append(el('h2', undefined, 'Droits'));
  root.append(el('p', 'muted small', 'Les amis qui ont les droits peuvent déplacer et tourner tes meubles posés. Ils ne peuvent ni en poser, ni en ranger.'));
  const list = el('ul', 'rights-list');
  const status = el('p', 'muted small');
  status.setAttribute('role', 'status');
  root.append(list, status);

  async function load() {
    const [friends, rights] = await Promise.all([api.friends(), api.rights()]);
    if (!friends.ok || !rights.ok) {
      status.textContent = 'Impossible de charger tes amis pour l’instant.';
      return;
    }
    const granted = new Set(rights.data.rights.map((r) => r.id));
    const accepted = friends.data.friends;
    list.replaceChildren();
    status.textContent = accepted.length ? '' : 'Ajoute des amis pour leur donner les droits.';
    for (const f of accepted) {
      const li = el('li');
      const label = el('label');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = granted.has(f.id);
      box.addEventListener('change', async () => {
        box.disabled = true;
        const res = box.checked ? await api.grantRights(f.id) : await api.revokeRights(f.id);
        box.disabled = false;
        if (!res.ok) {
          box.checked = !box.checked;
          status.textContent = res.error;
        } else {
          status.textContent = box.checked ? `${f.nickname} peut arranger ton appart.` : `${f.nickname} n’a plus les droits.`;
        }
      });
      label.append(box, document.createTextNode(` ${f.nickname}`));
      li.append(label);
      list.append(li);
    }
  }
  void load();
  return root;
}
