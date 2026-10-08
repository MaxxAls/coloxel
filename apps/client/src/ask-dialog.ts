import { windowBar } from './window';

export interface AskOptions {
  title: string;
  /** What is being asked, one sentence. */
  label: string;
  value?: string;
  maxLength: number;
  /** Text of the confirm button. */
  confirm?: string;
  /** An empty answer is allowed (it clears something). */
  allowEmpty?: boolean;
}

/**
 * A small window that asks for one line of text, in the style of the game (instead of the browser's own box).
 * Resolves with the text, or null when the player cancels.
 */
export function askText(options: AskOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const dialog = document.createElement('div');
    dialog.className = 'window modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', options.title);
    const body = document.createElement('form');
    body.className = 'win-body ask-form';
    const label = document.createElement('label');
    label.className = 'ask-label';
    label.textContent = options.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = options.maxLength;
    input.value = options.value ?? '';
    input.autocomplete = 'off';
    label.append(input);
    const count = document.createElement('span');
    count.className = 'muted small';
    const update = () => {
      count.textContent = `${input.value.length}/${options.maxLength}`;
      ok.disabled = !options.allowEmpty && !input.value.trim();
    };
    const buttons = document.createElement('div');
    buttons.className = 'ask-buttons';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = options.confirm ?? 'Valider';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Annuler';
    buttons.append(cancel, ok);
    body.append(label, count, buttons);
    dialog.append(windowBar(options.title, () => finish(null)), body);
    back.append(dialog);
    document.body.append(back);

    const finish = (value: string | null) => {
      back.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish(null);
    };
    document.addEventListener('keydown', onKey);
    cancel.addEventListener('click', () => finish(null));
    input.addEventListener('input', update);
    body.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!ok.disabled) finish(input.value);
    });
    update();
    input.focus();
    input.select();
  });
}
