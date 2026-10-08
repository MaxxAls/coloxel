import { catalogueEntry, isSwitchable } from '@coloxel/render';
import { N } from '@coloxel/world';
import { api, type FurnitureItem, type Rule, type RuleCell, type RuleCondition, type RuleEffect, type RuleTrigger } from './api';

export interface RulesEditor {
  element: HTMLElement;
  /** Read the rules again (they may have changed elsewhere). */
  reload(): Promise<void>;
  /** Draw them again: the furniture they name may have been loaded, moved or taken back. */
  rerender(): void;
}

export interface RulesEditorOptions {
  /** The furniture the player owns, as the room knows it. */
  furniture(): FurnitureItem[];
  /** Ask the player to click a cell of the room. */
  pickCell(done: (cell: RuleCell) => void): void;
  notify(text: string): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const cellText = (c: RuleCell) => `(${c.i}, ${c.j})`;

// ----- Rules as sentences ----------------------------------------------------------------
export function describeTrigger(t: RuleTrigger): string {
  switch (t.type) {
    case 'enter':
      return 'Quand quelqu’un entre';
    case 'step':
      return `Quand quelqu’un marche sur la case ${cellText(t.cell)}`;
    case 'use':
      return `Quand on clique sur le bouton en ${cellText(t.cell)}`;
    case 'say':
      return `Quand quelqu’un dit « ${t.word} »`;
    case 'every':
      return `Toutes les ${t.seconds} secondes`;
    case 'leave':
      return `Quand quelqu’un quitte la case ${cellText(t.cell)}`;
    case 'score':
      return `Quand le compteur arrive à ${t.n}`;
  }
}

export function describeCondition(c: RuleCondition, nameOf: (id: string) => string): string {
  switch (c.type) {
    case 'players':
      return `s’il y a ${c.n} joueur(s) ou ${c.op === '>=' ? 'plus' : 'moins'}`;
    case 'lit':
      return `si ${nameOf(c.piece)} est ${c.on ? 'allumé' : 'éteint'}`;
    case 'on-cell':
      return `si le joueur est sur la case ${cellText(c.cell)}`;
    case 'someone-on':
      return `si quelqu’un est sur la case ${cellText(c.cell)}`;
    case 'hours':
      return `entre ${c.from} h et ${c.to} h`;
  }
}

export function describeEffect(e: RuleEffect, nameOf: (id: string) => string): string {
  switch (e.type) {
    case 'light':
      return `${e.mode === 'on' ? 'allumer' : e.mode === 'off' ? 'éteindre' : 'inverser'} ${nameOf(e.piece)}`;
    case 'teleport':
      return `téléporter le joueur en ${cellText(e.cell)}`;
    case 'message':
      return `lui dire « ${e.text} »`;
    case 'dance':
      return 'le faire danser';
    case 'score':
      return e.mode === 'reset' ? `remettre ${nameOf(e.piece)} à zéro` : `ajouter ${e.points} point(s) à ${nameOf(e.piece)}`;
    case 'rotate':
      return `tourner ${nameOf(e.piece)}`;
    case 'move':
      return `déplacer ${nameOf(e.piece)} en ${cellText(e.cell)}`;
  }
}

/** The owner's mechanisms: what happens in the apartment when somebody steps, speaks, clicks or comes in. */
export function createRulesEditor(options: RulesEditorOptions): RulesEditor {
  const root = el('details', 'rules-editor');
  const summary = el('summary', undefined, 'Mécanismes');
  const intro = el(
    'p',
    'muted small',
    'Fais réagir ton appart : quand quelqu’un marche sur une plaque, clique sur un bouton, dit un mot ou entre, allume une lampe, téléporte-le, parle-lui… Les règles fonctionnent même quand tu es absent.',
  );
  const list = el('ul', 'rule-list');
  const status = el('p', 'error small');
  status.setAttribute('role', 'alert');
  const add = el('button', 'primary', 'Ajouter une règle');
  add.type = 'button';
  const builderBox = el('div');
  root.append(summary, intro, list, status, add, builderBox);

  let rules: Rule[] = [];

  const pieces = () => options.furniture();
  const nameOf = (id: string) => {
    const f = pieces().find((p) => p.id === id);
    return f ? `${f.name}${f.placement ? ` ${cellText(f.placement)}` : ''}` : 'un meuble qui n’est plus là';
  };

  async function save(next: Rule[]) {
    status.textContent = '';
    const res = await api.saveRules(next);
    if (!res.ok) {
      status.textContent = res.error;
      return false;
    }
    rules = res.data.rules;
    render();
    return true;
  }

  function render() {
    list.replaceChildren();
    if (!rules.length) list.append(el('li', 'muted small', 'Aucune règle pour l’instant.'));
    rules.forEach((rule, k) => {
      const li = el('li', rule.enabled ? 'rule' : 'rule off');
      const text = el('div', 'rule-text');
      text.append(
        el('strong', undefined, describeTrigger(rule.trigger)),
        el('span', undefined, rule.conditions.length ? ` ${rule.conditions.map((c) => describeCondition(c, nameOf)).join(', ')}` : ''),
        el('span', 'muted', ` → ${rule.effects.map((e) => describeEffect(e, nameOf)).join(', puis ')}.`),
      );
      const actions = el('div', 'rule-actions');
      const toggle = el('button', undefined, rule.enabled ? 'Désactiver' : 'Activer');
      toggle.type = 'button';
      toggle.addEventListener('click', () => void save(rules.map((r, n) => (n === k ? { ...r, enabled: !r.enabled } : r))));
      const remove = el('button', 'link', 'Supprimer');
      remove.type = 'button';
      remove.addEventListener('click', () => void save(rules.filter((_, n) => n !== k)));
      actions.append(toggle, remove);
      li.append(text, actions);
      list.append(li);
    });
    add.disabled = rules.length >= 20;
  }

  // ----- Building a rule -----------------------------------------------------------------
  const select = (choices: [string, string][], value?: string) => {
    const s = el('select');
    for (const [v, label] of choices) {
      const o = el('option', undefined, label);
      o.value = v;
      o.selected = v === value;
      s.append(o);
    }
    return s;
  };
  const number = (min: number, max: number, value: number, label: string) => {
    const input = el('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.setAttribute('aria-label', label);
    input.className = 'num';
    return input;
  };

  /** A cell: two numbers, or a click on the room. */
  function cellField(label: string): { element: HTMLElement; get(): RuleCell } {
    const box = el('span', 'cell-field');
    const i = number(0, N - 1, 3, `${label} : colonne`);
    const j = number(0, N - 1, 3, `${label} : ligne`);
    const pick = el('button', undefined, 'Choisir sur la salle');
    pick.type = 'button';
    pick.addEventListener('click', () => {
      options.notify('Clique sur la case de ton choix dans la salle.');
      options.pickCell((cell) => {
        i.value = String(cell.i);
        j.value = String(cell.j);
      });
    });
    box.append(el('span', 'muted small', 'case'), i, j, pick);
    return { element: box, get: () => ({ i: Number(i.value), j: Number(j.value) }) };
  }

  /** A piece of the apartment to point at: the lights, the score counters, or any piece on the floor. */
  function pieceField(kind: 'light' | 'counter' | 'floor' = 'light'): { element: HTMLSelectElement; get(): string } {
    const fits = pieces().filter((f) => {
      const entry = catalogueEntry(f.key);
      return kind === 'light' ? isSwitchable(entry) : kind === 'counter' ? !!entry?.counter : !!f.placement && !entry?.wall;
    });
    const none = kind === 'light' ? 'Aucun meuble lumineux' : kind === 'counter' ? 'Aucun compteur de points' : 'Aucun meuble posé';
    const s = select(fits.length ? fits.map((f) => [f.id, `${f.name}${f.placement ? ` ${cellText(f.placement)}` : ' (rangé)'}`] as [string, string]) : [['', none]]);
    return { element: s, get: () => s.value };
  }

  const TRIGGERS: [RuleTrigger['type'], string][] = [
    ['enter', 'Quand quelqu’un entre'],
    ['step', 'Quand quelqu’un marche sur une case'],
    ['use', 'Quand on clique sur un bouton'],
    ['say', 'Quand quelqu’un dit un mot'],
    ['every', 'Toutes les N secondes'],
    ['leave', 'Quand quelqu’un quitte une case'],
    ['score', 'Quand un compteur arrive à un nombre'],
  ];
  const CONDITIONS: [RuleCondition['type'], string][] = [
    ['players', 'Nombre de joueurs'],
    ['lit', 'Une lampe est allumée ou éteinte'],
    ['on-cell', 'Le joueur est sur une case'],
    ['someone-on', 'Quelqu’un est sur une case'],
    ['hours', 'Entre deux heures'],
  ];
  const EFFECTS: [RuleEffect['type'], string][] = [
    ['light', 'Allumer ou éteindre un meuble'],
    ['teleport', 'Téléporter le joueur'],
    ['message', 'Lui montrer un message'],
    ['dance', 'Le faire danser'],
    ['score', 'Compter des points'],
    ['rotate', 'Tourner un meuble'],
    ['move', 'Déplacer un meuble'],
  ];

  function openBuilder() {
    const form = el('form', 'rule-builder');
    form.append(el('strong', undefined, 'Nouvelle règle'));

    // Trigger
    const triggerType = select(TRIGGERS);
    const triggerParams = el('span', 'params');
    let triggerGet: () => RuleTrigger = () => ({ type: 'enter' });
    const fillTrigger = () => {
      triggerParams.replaceChildren();
      const type = triggerType.value as RuleTrigger['type'];
      if (type === 'step' || type === 'use' || type === 'leave') {
        const c = cellField('Case');
        triggerParams.append(c.element);
        triggerGet = () => ({ type, cell: c.get() });
      } else if (type === 'score') {
        const piece = pieceField('counter');
        const n = number(0, 99, 10, 'Le nombre');
        triggerParams.append(piece.element, el('span', 'muted small', 'arrive à'), n);
        triggerGet = () => ({ type, piece: piece.get(), n: Number(n.value) });
      } else if (type === 'say') {
        const word = el('input');
        word.placeholder = 'abracadabra';
        word.maxLength = 20;
        word.setAttribute('aria-label', 'Le mot');
        triggerParams.append(word);
        triggerGet = () => ({ type, word: word.value });
      } else if (type === 'every') {
        const seconds = number(5, 3600, 10, 'Secondes');
        triggerParams.append(seconds, el('span', 'muted small', 'secondes'));
        triggerGet = () => ({ type, seconds: Number(seconds.value) });
      } else {
        triggerGet = () => ({ type: 'enter' });
      }
    };
    triggerType.addEventListener('change', fillTrigger);
    fillTrigger();
    const triggerRow = el('div', 'rule-row');
    triggerRow.append(el('span', 'rule-label', 'QUAND'), triggerType, triggerParams);

    // Conditions and effects: a list of lines that can be added and removed.
    interface Line<T> {
      row: HTMLElement;
      get(): T;
    }
    const conditions: Line<RuleCondition>[] = [];
    const effects: Line<RuleEffect>[] = [];
    const conditionBox = el('div');
    const effectBox = el('div');

    const addCondition = () => {
      const row = el('div', 'rule-row');
      const type = select(CONDITIONS);
      const params = el('span', 'params');
      let get: () => RuleCondition = () => ({ type: 'players', op: '>=', n: 2 });
      const fill = () => {
        params.replaceChildren();
        const t = type.value as RuleCondition['type'];
        if (t === 'players') {
          const op = select([['>=', 'ou plus'], ['<=', 'ou moins']]);
          const n = number(0, 50, 2, 'Nombre de joueurs');
          params.append(n, op);
          get = () => ({ type: 'players', op: op.value as '>=' | '<=', n: Number(n.value) });
        } else if (t === 'lit') {
          const piece = pieceField();
          const on = select([['true', 'allumé'], ['false', 'éteint']]);
          params.append(piece.element, on);
          get = () => ({ type: 'lit', piece: piece.get(), on: on.value === 'true' });
        } else if (t === 'hours') {
          const from = number(0, 23, 18, 'De');
          const to = number(0, 23, 23, 'À');
          params.append(el('span', 'muted small', 'de'), from, el('span', 'muted small', 'h à'), to, el('span', 'muted small', 'h'));
          get = () => ({ type: 'hours', from: Number(from.value), to: Number(to.value) });
        } else {
          const c = cellField('Case');
          params.append(c.element);
          get = () => ({ type: t === 'someone-on' ? 'someone-on' : 'on-cell', cell: c.get() });
        }
      };
      type.addEventListener('change', fill);
      fill();
      const remove = el('button', 'link', 'Retirer');
      remove.type = 'button';
      const line: Line<RuleCondition> = { row, get: () => get() };
      remove.addEventListener('click', () => {
        conditions.splice(conditions.indexOf(line), 1);
        row.remove();
        addConditionButton.disabled = false;
      });
      row.append(el('span', 'rule-label', 'SI'), type, params, remove);
      conditions.push(line);
      conditionBox.append(row);
      addConditionButton.disabled = conditions.length >= 3;
    };

    const addEffect = () => {
      const row = el('div', 'rule-row');
      const type = select(EFFECTS);
      const params = el('span', 'params');
      let get: () => RuleEffect = () => ({ type: 'dance' });
      const fill = () => {
        params.replaceChildren();
        const t = type.value as RuleEffect['type'];
        if (t === 'light') {
          const piece = pieceField();
          const mode = select([['on', 'allumer'], ['off', 'éteindre'], ['toggle', 'inverser']]);
          params.append(mode, piece.element);
          get = () => ({ type: 'light', piece: piece.get(), mode: mode.value as 'on' | 'off' | 'toggle' });
        } else if (t === 'teleport') {
          const c = cellField('Arrivée');
          params.append(c.element);
          get = () => ({ type: 'teleport', cell: c.get() });
        } else if (t === 'message') {
          const text = el('input');
          text.placeholder = 'Bienvenue chez moi !';
          text.maxLength = 80;
          text.setAttribute('aria-label', 'Le message');
          params.append(text);
          get = () => ({ type: 'message', text: text.value });
        } else if (t === 'score') {
          const piece = pieceField('counter');
          const mode = select([['add', 'ajouter'], ['reset', 'remettre à zéro']]);
          const points = number(1, 10, 1, 'Points');
          params.append(mode, points, piece.element);
          get = () => ({ type: 'score', piece: piece.get(), mode: mode.value as 'add' | 'reset', points: Number(points.value) });
        } else if (t === 'rotate') {
          const piece = pieceField('floor');
          params.append(piece.element);
          get = () => ({ type: 'rotate', piece: piece.get() });
        } else if (t === 'move') {
          const piece = pieceField('floor');
          const c = cellField('Vers');
          params.append(piece.element, c.element);
          get = () => ({ type: 'move', piece: piece.get(), cell: c.get() });
        } else {
          get = () => ({ type: 'dance' });
        }
      };
      type.addEventListener('change', fill);
      fill();
      const remove = el('button', 'link', 'Retirer');
      remove.type = 'button';
      const line: Line<RuleEffect> = { row, get: () => get() };
      remove.addEventListener('click', () => {
        if (effects.length <= 1) return;
        effects.splice(effects.indexOf(line), 1);
        row.remove();
        addEffectButton.disabled = false;
      });
      row.append(el('span', 'rule-label', 'ALORS'), type, params, remove);
      effects.push(line);
      effectBox.append(row);
      addEffectButton.disabled = effects.length >= 4;
    };

    const addConditionButton = el('button', undefined, '+ Condition');
    addConditionButton.type = 'button';
    addConditionButton.addEventListener('click', addCondition);
    const addEffectButton = el('button', undefined, '+ Effet');
    addEffectButton.type = 'button';
    addEffectButton.addEventListener('click', addEffect);
    addEffect();

    const error = el('p', 'error small');
    error.setAttribute('role', 'alert');
    const buttons = el('div', 'rule-actions');
    const submit = el('button', 'primary', 'Enregistrer la règle');
    submit.type = 'submit';
    const cancel = el('button', undefined, 'Annuler');
    cancel.type = 'button';
    cancel.addEventListener('click', () => builderBox.replaceChildren());
    buttons.append(submit, cancel);

    form.append(triggerRow, conditionBox, addConditionButton, effectBox, addEffectButton, error, buttons);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      const rule: Rule = { enabled: true, trigger: triggerGet(), conditions: conditions.map((c) => c.get()), effects: effects.map((e) => e.get()) };
      submit.disabled = true;
      const res = await api.saveRules([...rules, rule]);
      submit.disabled = false;
      if (!res.ok) {
        error.textContent = res.error;
        return;
      }
      rules = res.data.rules;
      builderBox.replaceChildren();
      render();
      options.notify('Règle enregistrée.');
    });
    builderBox.replaceChildren(form);
  }

  add.addEventListener('click', openBuilder);

  async function reload() {
    const res = await api.rules();
    if (res.ok) {
      rules = res.data.rules;
      render();
    }
  }
  render();
  void reload();
  return { element: root, reload, rerender: render };
}
