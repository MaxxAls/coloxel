import { api } from './api';
import { startApp } from './app';
import './base.css';
import './game.css';
import './theme.css';

// Accounts live on the website: whoever is not signed in is sent there to sign in or sign up,
// and comes back here once done.
const SITE_SIGN_IN = '/site/connexion';

async function main() {
  const me = await api.me();
  if (!me.ok) {
    if (me.status === 401) {
      location.replace(SITE_SIGN_IN);
      return;
    }
    // The server does not answer (or is in maintenance): say so, and let the player try again.
    document.body.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'toast show';
    box.style.cssText = 'position:static;margin:20vh auto 0;transform:none;text-align:center';
    const text = document.createElement('p');
    text.textContent = me.error;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'primary';
    retry.textContent = 'Réessayer';
    retry.addEventListener('click', () => location.reload());
    box.append(text, retry);
    document.body.append(box);
    return;
  }
  await startApp(me.data.user);
}

main();
