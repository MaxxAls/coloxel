// Behaviour of the website's pages: forms that talk to the game's API, the sign-up steps, small animations.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const game = document.body.dataset.game || '/';

  async function post(url, body) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      return { ok: res.ok, status: res.status, error: json.error || 'Quelque chose s’est mal passé, réessaie.' };
    } catch {
      return { ok: false, status: 0, error: 'Le serveur ne répond pas, réessaie dans un instant.' };
    }
  }

  // Sections slide in when they scroll into view.
  const revealed = $$('.reveal');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    revealed.forEach((el) => io.observe(el));
  } else {
    revealed.forEach((el) => el.classList.add('in'));
  }

  // Sign out.
  $$('[data-logout]').forEach((b) =>
    b.addEventListener('click', async () => {
      await post('/api/auth/logout', {});
      location.href = '/site';
    }),
  );

  // Show or hide a password.
  $$('[data-peek]').forEach((b) =>
    b.addEventListener('click', () => {
      const input = $('input', b.closest('.pw'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.textContent = show ? 'Cacher' : 'Voir';
      b.setAttribute('aria-pressed', String(show));
    }),
  );

  // Sign in (the page's own form, or the small one on the home page).
  $$('form[data-login]').forEach((form) =>
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const error = $('.form-error', form);
      const button = $('button[type=submit]', form);
      error.textContent = '';
      button.disabled = true;
      const res = await post('/api/auth/login', { email: form.email.value, password: form.password.value });
      if (res.ok) {
        location.href = game;
        return;
      }
      error.textContent = res.error;
      button.disabled = false;
    }),
  );

  // Sign up, in three steps.
  const wizard = $('form[data-register]');
  if (wizard) {
    const steps = $$('.step', wizard);
    const dots = $$('.dots li', wizard);
    const error = $('.form-error', wizard);
    let at = 0;
    const show = (n) => {
      at = n;
      steps.forEach((s, k) => (s.hidden = k !== n));
      dots.forEach((d, k) => {
        d.classList.toggle('on', k === n);
        d.classList.toggle('done', k < n);
      });
      error.textContent = '';
      const first = $('input', steps[n]);
      if (first) first.focus();
    };
    const check = (n) => {
      const f = wizard;
      if (n === 0) {
        if (!/^[A-Za-z0-9_-]{3,20}$/.test(f.nickname.value.trim())) return 'Le pseudo fait 3 à 20 caractères : lettres, chiffres, _ et -.';
      } else if (n === 1) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim())) return 'Cette adresse email ne semble pas valide.';
        if (f.password.value.length < 8) return 'Le mot de passe doit faire au moins 8 caractères.';
        if (f.password.value !== f.password2.value) return 'Les deux mots de passe ne sont pas identiques.';
      } else if (n === 2) {
        if (!f.birth.value) return 'Indique ta date de naissance.';
        const [y, m, d] = f.birth.value.split('-').map(Number);
        const now = new Date();
        let age = now.getFullYear() - y;
        if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
        if (age < 18) return 'Coloxel est réservé aux adultes (18 ans et plus) pendant l’alpha. Reviens nous voir bientôt !';
        if (!f.rules.checked) return 'Accepte les règles du jeu pour continuer.';
      }
      return '';
    };
    $$('[data-next]', wizard).forEach((b) =>
      b.addEventListener('click', () => {
        const problem = check(at);
        if (problem) {
          error.textContent = problem;
          return;
        }
        show(at + 1);
      }),
    );
    $$('[data-back]', wizard).forEach((b) => b.addEventListener('click', () => show(at - 1)));
    wizard.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (at < 2) return $('[data-next]', steps[at]).click();
      const problem = check(2);
      if (problem) {
        error.textContent = problem;
        return;
      }
      const button = $('button[type=submit]', wizard);
      button.disabled = true;
      const res = await post('/api/auth/register', {
        nickname: wizard.nickname.value.trim(),
        email: wizard.email.value.trim(),
        password: wizard.password.value,
        birthDate: wizard.birth.value,
      });
      if (res.ok) {
        location.href = game;
        return;
      }
      error.textContent = res.error;
      button.disabled = false;
      // Go back to the step the answer is about.
      if (/pseudo/i.test(res.error)) show(0);
      else if (/email|mot de passe/i.test(res.error)) show(1);
    });
    show(0);
  }

  // The creations strip scrolls with its arrows.
  $$('[data-strip]').forEach((strip) => {
    const row = $('.strip-row', strip);
    $$('[data-scroll]', strip).forEach((b) =>
      b.addEventListener('click', () => row.scrollBy({ left: Number(b.dataset.scroll) * (row.clientWidth * 0.8), behavior: 'smooth' })),
    );
  });
})();
