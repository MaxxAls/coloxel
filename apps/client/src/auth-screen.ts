import { api, type User } from './api';

type Mode = 'login' | 'register';

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

/** Shows the sign-in / sign-up screen and resolves with the user once authenticated. */
export function showAuthScreen(): Promise<User> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'auth';
    const card = document.createElement('form');
    card.className = 'card';
    card.noValidate = false;

    const title = document.createElement('h1');
    title.textContent = 'Coloxel';
    const tagline = document.createElement('p');
    tagline.className = 'muted';
    tagline.textContent = 'Invente des objets uniques, un seul exemplaire pour chacun.';

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    const tabLogin = document.createElement('button');
    tabLogin.type = 'button';
    tabLogin.textContent = 'Connexion';
    const tabRegister = document.createElement('button');
    tabRegister.type = 'button';
    tabRegister.textContent = 'Inscription';
    tabs.append(tabLogin, tabRegister);

    const email = field('Email', 'email', 'email', { autocomplete: 'email' });
    const password = field('Mot de passe', 'password', 'password', { minLength: 8 });
    const nickname = field('Pseudo', 'nickname', 'text', {
      minLength: 3,
      maxLength: 20,
      pattern: '[A-Za-z0-9_\\-]{3,20}',
      title: '3 Ã  20 caractÃ¨res : lettres, chiffres, _ et -',
      autocomplete: 'nickname' as AutoFill,
    });
    const birth = field('Date de naissance', 'birthDate', 'date', { autocomplete: 'bday' as AutoFill });
    birth.input.max = new Date().toISOString().slice(0, 10);

    const hint = document.createElement('p');
    hint.className = 'muted small';
    hint.textContent = 'Lâ€™alpha est rÃ©servÃ©e aux adultes (18 ans et plus).';

    const error = document.createElement('p');
    error.className = 'error';
    error.setAttribute('role', 'alert');

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'primary';

    card.append(title, tagline, tabs, email.wrap, password.wrap, nickname.wrap, birth.wrap, hint, error, submit);
    root.append(card);
    document.body.append(root);

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
      submit.textContent = reg ? 'CrÃ©er mon compte' : 'Se connecter';
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
      root.remove();
      resolve(result.data.user);
    });
  });
}
