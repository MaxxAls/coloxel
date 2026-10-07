import { api } from './api';
import { startApp } from './app';
import { showAuthScreen } from './auth-screen';
import './game.css';

async function main() {
  const me = await api.me();
  const user = me.ok ? me.data.user : await showAuthScreen();
  await startApp(user);
}

main();
