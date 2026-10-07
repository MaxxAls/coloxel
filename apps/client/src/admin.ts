import './base.css';
import './game.css';
import { api } from './api';
import { createStaffPanel } from './staff-panel';

// The administration: the staff panel on a page of its own, for working with a big screen.
// The server decides who is staff; this page only asks, and leaves if the answer is no.

async function main() {
  const me = await api.me();
  if (!me.ok) {
    location.replace(me.status === 401 ? '/site/connexion' : '/site');
    return;
  }
  const staff = await api.staffMe();
  if (!staff.ok) {
    location.replace('/site');
    return;
  }

  document.body.classList.add('admin');
  const bar = document.createElement('div');
  bar.className = 'admin-bar';
  const title = document.createElement('h1');
  title.textContent = 'Administration';
  const links = document.createElement('p');
  links.className = 'small';
  const site = document.createElement('a');
  site.href = '/site';
  site.textContent = '← Le site';
  const play = document.createElement('a');
  play.href = '/';
  play.textContent = 'Jouer';
  links.append(site, document.createTextNode('  ·  '), play, document.createTextNode(`  ·  ${me.data.user.nickname}`));
  bar.append(title, links);

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = (text: string) => {
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => (toast.hidden = true), 3500);
  };

  const panel = createStaffPanel({
    notify,
    // It is the whole page: closing it makes no sense.
    onToggle: (open) => {
      if (!open) setTimeout(() => panel.toggle());
    },
  });
  document.body.append(bar, panel.element, toast);
  panel.toggle();
}

void main();
