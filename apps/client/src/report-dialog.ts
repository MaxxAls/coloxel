import { api, type ReportKind, type ReportReason } from './api';
import { windowBar } from './window';

export interface ReportTarget {
  kind: ReportKind;
  /** The player, message, creation or apartment owner being reported. */
  id: string | number;
  /** What the player sees: « le joueur Léa », « ce message »… */
  label: string;
}

const REASONS: [ReportReason, string][] = [
  ['insult', 'Insultes ou propos injurieux'],
  ['harassment', 'Harcèlement ou menaces'],
  ['inappropriate', 'Contenu inapproprié'],
  ['personal_info', 'Informations personnelles (téléphone, adresse, réseaux)'],
  ['spam', 'Spam ou publicité'],
  ['other', 'Autre chose'],
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let open: HTMLElement | null = null;

/** Ask why, then send the report: the staff reads it. Only one dialog at a time. */
export function openReportDialog(target: ReportTarget, notify: (text: string) => void) {
  open?.remove();
  const back = el('div', 'modal-back');
  const dialog = el('form', 'window modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Signaler');
  const close = () => {
    removeEventListener('keydown', onKey);
    back.remove();
    open = null;
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };
  addEventListener('keydown', onKey);

  const body = el('div', 'win-body');
  body.append(el('p', undefined, `Tu signales ${target.label}. Pourquoi ?`));
  const group = el('fieldset', 'report-reasons');
  group.append(el('legend', 'muted small', 'Motif'));
  let chosen: ReportReason | null = null;
  const send = el('button', 'primary', 'Envoyer le signalement');
  send.type = 'submit';
  send.disabled = true;
  for (const [value, label] of REASONS) {
    const row = el('label');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'reason';
    radio.addEventListener('change', () => {
      chosen = value;
      send.disabled = false;
    });
    row.append(radio, document.createTextNode(` ${label}`));
    group.append(row);
  }
  const details = el('textarea');
  details.maxLength = 300;
  details.rows = 3;
  details.placeholder = 'Dis-nous en plus si tu veux (facultatif)';
  details.setAttribute('aria-label', 'Détails');
  const error = el('p', 'error small');
  error.setAttribute('role', 'alert');
  const cancel = el('button', undefined, 'Annuler');
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  const actions = el('div', 'item-card-actions');
  actions.append(send, cancel);
  body.append(group, details, error, actions, el('p', 'muted small', 'Un faux signalement peut te valoir une sanction.'));
  dialog.append(windowBar('Signaler', close), body);
  back.append(dialog);
  back.addEventListener('pointerdown', (ev) => {
    if (ev.target === back) close();
  });

  dialog.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!chosen) return;
    send.disabled = true;
    const res = await api.report({ kind: target.kind, targetId: target.id, reason: chosen, details: details.value.trim() || undefined });
    if (res.ok) {
      close();
      notify('Merci, ton signalement a été transmis à l’équipe.');
    } else {
      error.textContent = res.error;
      send.disabled = false;
    }
  });

  document.body.append(back);
  open = back;
}
