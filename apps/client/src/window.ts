/** Title bar shared by every floating window: a title and a close button. */
export function windowBar(title: string, onClose: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'win-bar';
  const label = document.createElement('span');
  label.className = 'win-title';
  label.textContent = title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'win-close';
  close.setAttribute('aria-label', 'Fermer');
  close.textContent = '×';
  close.addEventListener('click', onClose);
  bar.append(label, close);
  return bar;
}
