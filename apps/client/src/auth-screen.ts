import './auth.css';
import { api, type User } from './api';
import { startLoginScene } from './login-scene';

type Mode = 'login' | 'register';

const LOGO_COLORS = ['#ff5a7a', '#ffc857', '#6be2a3', '#5ab8ff', '#b78cff', '#ff9a5a', '#ff5a7a'];

function field(label: string, name: string, type: string, extra: Partial<HTMLInputElement> = {}) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  input.required = true;
  Object.assign(input, extra);
  wrap.append(span, input);
  return { wrap, input };
}

function logo() {
  const h1 = document.createElement('h1');
  h1.className = 'logo';
  h1.setAttribute('aria-label', 'Coloxel');
  [...'COLOXEL'].forEach((ch, k) => {
    const s = document.createElement('span');
    s.textContent = ch;
    s.setAttribute('aria-hidden', 'true');
    s.style.color = LOGO_COLORS[k]!;
    s.style.animationDelay = `${k * 110}ms`;
    h1.append(s);
  });
  return h1;
}

/** Shows the sign-in / sign-up screen and resolves with the user once authenticated. */
export function showAuthScreen(): Promise<User> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'auth';

    const scene = document.createElement('canvas');
    scene.className = 'scene';
    scene.setAttribute('aria-hidden', 'true');

    const card = document.createElement('form');
    card.className = 'card';

    const pitch = document.createElement('p');
    pitch.className = 'pitch';

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.setAttribute('role', 'tablist');
    const tabLogin = document.createElement('button');
    tabLogin.type = 'button';
    tabLogin.textContent = 'Connexion';
    const tabRegister = document.createElement('button');
    tabRegister.type = 'button';
    tabRegister.textContent = 'Inscription';
    for (const tab of [tabLogin, tabRegister]) tab.setAttribute('role', 'tab');
    tabs.append(tabLogin, tabRegister);

    const email = field('Email', 'email', 'email', { autocomplete: 'email' as AutoFill });
    const password = field('Mot de passe', 'password', 'password');
    const nickname = field('Pseudo', 'nickname', 'text', {
      minLength: 3,
      maxLength: 20,
      pattern: '[A-Za-z0-9_\\-]{3,20}',
      title: '3 à 20 caractères : lettres, chiffres, _ et -',
      autocomplete: 'nickname' as AutoFill,
    });
    const birth = field('Date de naissance', 'birthDate', 'date', { autocomplete: 'bday' as AutoFill });
    birth.input.max = new Date().toISOString().slice(0, 10);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Alpha réservée aux adultes (18 ans et plus).';

    const error = document.createElement('p');
    error.className = 'error';
    error.setAttribute('role', 'alert');

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'play';

    const perks = document.createElement('ul');
    perks.className = 'perks';
    for (const text of ['Décris', 'Invente', 'Expose']) {
      const li = document.createElement('li');
      li.textContent = text;
      perks.append(li);
    }

    card.append(logo(), pitch, tabs, email.wrap, password.wrap, nickname.wrap, birth.wrap, hint, error, submit, perks);
    root.append(scene, card);
    document.body.append(root);
    const stopScene = startLoginScene(scene);

    let mode: Mode = 'login';
    const setMode = (next: Mode) => {
      mode = next;
      const reg = mode === 'register';
      nickname.wrap.hidden = !reg;
      birth.wrap.hidden = !reg;
      hint.hidden = !reg;
      nickname.input.required = reg;
      birth.input.required = reg;
      password.input.autocomplete = reg ? 'new-password' : 'current-password';
      password.input.minLength = reg ? 8 : 0;
      tabLogin.classList.toggle('active', !reg);
      tabRegister.classList.toggle('active', reg);
      tabLogin.setAttribute('aria-selected', String(!reg));
      tabRegister.setAttribute('aria-selected', String(reg));
      pitch.textContent = reg
        ? 'Crée ton avatar et invente ton premier objet en moins de 2 minutes.'
        : 'Content de te revoir ! Ton appart t’attend.';
      submit.textContent = reg ? 'C’est parti !' : 'Jouer';
      error.textContent = '';
    };
    tabLogin.addEventListener('click', () => setMode('login'));
    tabRegister.addEventListener('click', () => setMode('register'));
    setMode('login');

    card.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      submit.disabled = true;
      error.textContent = '';
      const result =
        mode === 'login'
          ? await api.login(email.input.value.trim(), password.input.value)
          : await api.register({
              email: email.input.value.trim(),
              password: password.input.value,
              nickname: nickname.input.value.trim(),
              birthDate: birth.input.value,
            });
      submit.disabled = false;
      if (!result.ok) {
        error.textContent = result.error;
        return;
      }
      stopScene();
      root.remove();
      resolve(result.data.user);
    });
  });
}
