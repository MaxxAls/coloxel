import { api, type ApartmentAccess, type MyApartment } from './api';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const ACCESS: { value: ApartmentAccess; label: string; hint: string }[] = [
  { value: 'closed', label: 'Fermé', hint: 'Personne d’autre ne peut entrer chez toi.' },
  { value: 'building', label: 'Ouvert à l’immeuble', hint: 'Tous les habitants peuvent te rendre visite.' },
];

/** Name and opening of the player's own apartment. The server checks every word of the name. */
export function createApartmentSettings(): HTMLElement {
  const root = el('section', 'apartment-settings');
  root.append(el('h2', undefined, 'Mon appartement'));

  const form = el('form', 'settings-name');
  const input = el('input');
  input.maxLength = 30;
  input.placeholder = 'Le salon de…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Nom de ton appart');
  const save = el('button', undefined, 'Enregistrer');
  save.type = 'submit';
  const row = el('div', 'settings-row');
  row.append(input, save);
  form.append(el('span', 'muted small', 'Nom de ton appart'), row);

  const error = el('p', 'error small');
  error.setAttribute('role', 'alert');

  const access = el('div', 'access');
  const buttons = new Map<ApartmentAccess, HTMLButtonElement>();
  const hint = el('p', 'muted small');
  for (const option of ACCESS) {
    const b = el('button', undefined, option.label);
    b.type = 'button';
    b.addEventListener('click', () => void apply({ access: option.value }));
    buttons.set(option.value, b);
    access.append(b);
  }
  root.append(form, error, access, hint);

  const show = (apartment: MyApartment) => {
    input.value = apartment.name ?? '';
    for (const option of ACCESS) {
      const active = option.value === apartment.access || (option.value === 'closed' && apartment.access === 'friends');
      buttons.get(option.value)!.classList.toggle('active', active);
      buttons.get(option.value)!.setAttribute('aria-pressed', String(active));
      if (active) hint.textContent = option.hint;
    }
  };

  async function apply(body: { name?: string | null; access?: ApartmentAccess }) {
    error.textContent = '';
    const res = await api.updateApartment(body);
    if (res.ok) show(res.data);
    else error.textContent = res.error;
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void apply({ name: input.value });
  });

  void api.myApartment().then((res) => {
    if (res.ok) show(res.data);
  });
  return root;
}
