import { LOOK_ITEMS, MAX_PETS, PET_SPECIES, petSpecies, type Slot } from '@coloxel/render';
import { api, type CatalogueData, type MyApartment, type PetData } from './api';
import { appearance } from './appearance';
import { lookCanvas, thumbCanvas } from './look-art';
import { petCanvas, type PetFrame } from './pets';
import { pixelIcon } from './pixel-icons';
import { furnitureThumb } from './thumb';
import { pixelsLabel, wallet } from './wallet';
import { windowBar } from './window';

type Page = 'home' | 'furniture' | 'clothes' | 'pets' | 'vip';

const PAGES: [Page, string][] = [
  ['home', 'Accueil'],
  ['furniture', 'Mobilier'],
  ['clothes', 'Vêtements'],
  ['pets', 'Animaux'],
  ['vip', 'Abonnements'],
];

/** A rubric of the furniture tree: a category, the new pieces, the floors or the walls. */
type Rubric = { kind: 'furniture'; category: string } | { kind: 'floors' } | { kind: 'walls' };

const RUBRICS: { id: string; label: string; text: string; heading?: string }[] = [
  { id: 'new', label: 'Nouveautés', text: 'Les dernières pièces de la boutique, à acheter avec tes Pixels.', heading: 'À la une' },
  { id: 'all', label: 'Tout le mobilier', text: 'Le mobilier de base est gratuit, le reste s’achète en Pixels.', heading: 'Par type' },
  { id: 'sleep', label: 'Chambre', text: 'Pour dormir et se reposer.' },
  { id: 'seat', label: 'Sièges', text: 'Chaises, fauteuils et canapés : on peut s’y asseoir.' },
  { id: 'table', label: 'Tables', text: 'Pour poser, manger, travailler.' },
  { id: 'storage', label: 'Rangements', text: 'Étagères, armoires et commodes.' },
  { id: 'light', label: 'Lumières', text: 'Une ambiance chaleureuse.' },
  { id: 'decor', label: 'Décoration', text: 'Plantes, tapis et petits plaisirs.' },
  { id: 'tech', label: 'Multimédia', text: 'Écrans, bornes et gadgets.' },
];

const SLOT_LABELS: [Slot, string, string][] = [
  ['hair', 'Cheveux', 'Une nouvelle coupe, une nouvelle humeur.'],
  ['top', 'Hauts', 'T-shirts, pulls, vestes et robes.'],
  ['bottom', 'Bas', 'Jeans, shorts, jupes et joggings.'],
  ['shoes', 'Chaussures', 'Baskets, bottes et montantes.'],
  ['hat', 'Chapeaux', 'Couronnes, bonnets et chapeaux de sorcier.'],
  ['glasses', 'Lunettes', 'Rondes, carrées, de soleil ou en cœurs.'],
  ['extra', 'Extras', 'Écharpes, sacs, ailes et capes.'],
];

export interface Shop {
  element: HTMLElement;
  isOpen(): boolean;
  toggle(): void;
  open(page?: Page): void;
  close(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * The shop: furniture, clothes, companions and (soon) subscriptions. Every
 * price shown comes from the catalogues; the server charges what the catalogue
 * says and refuses anything the player cannot afford.
 */
export function createShop(options: {
  /** Furniture or the look of the player's apartment changed. */
  onChanged(): void;
  /** The player's look or companion changed: the room must tell the others. */
  onAppearance(): void;
  onToggle(open: boolean): void;
  notify(text: string): void;
  openWardrobe(): void;
}): Shop {
  const root = el('section', 'window shop');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Boutique');

  const tabs = el('div', 'tabs shop-tabs');
  tabs.setAttribute('role', 'tablist');
  const banner = el('header', 'shop-banner');
  const bannerIcon = el('span', 'shop-banner-icon');
  const bannerText = el('div');
  const bannerTitle = el('h2');
  const bannerSub = el('p');
  bannerText.append(bannerTitle, bannerSub);
  const bannerBalance = el('div', 'shop-banner-balance');
  banner.append(bannerIcon, bannerText, bannerBalance);
  const body = el('div', 'shop-body');
  const status = el('p', 'muted small shop-status');
  status.setAttribute('role', 'status');
  root.append(windowBar('Boutique', () => hide()), tabs, banner, body, status);

  let page: Page = 'home';
  let catalogue: CatalogueData | null = null;
  let mine: MyApartment | null = null;
  let pets: PetData[] = [];
  let loading = false;

  // Furniture state.
  let rubric: Rubric & { id?: string } = { kind: 'furniture', category: 'new' };
  let query = '';
  let selectedFurniture: string | null = null;
  // Clothes state.
  let slot: Slot = 'hair';
  let selectedPiece: number | null = null;
  // Pets state.
  let speciesKey = PET_SPECIES[0]!.key;
  let petColor = 0;
  let petName = '';
  let petFrame: PetFrame = 0;
  let petTimer: ReturnType<typeof setInterval> | undefined;
  let busy = false;

  const tabButtons = new Map<Page, HTMLButtonElement>();
  const say = (text: string) => (status.textContent = text);

  async function load() {
    if (loading) return;
    loading = true;
    const [cat, apt, list] = await Promise.all([api.catalogue(), api.myApartment(), api.pets(), appearance.load(), wallet.refresh()]);
    loading = false;
    if (cat.ok) catalogue = cat.data;
    else say(cat.error);
    if (apt.ok) mine = apt.data;
    if (list.ok) pets = list.data.pets;
    render();
  }

  // ----- Shared bits ------------------------------------------------------------
  const priceChip = (price: number) => (price > 0 ? pixelsLabel(price, 'px chip') : el('span', 'chip free', 'Gratuit'));

  const spend = async (run: () => Promise<{ ok: boolean; message: string }>, button?: HTMLButtonElement) => {
    if (busy) return;
    busy = true;
    if (button) button.disabled = true;
    const res = await run();
    busy = false;
    say(res.message);
    options.notify(res.message);
    render();
  };

  // ----- Home -------------------------------------------------------------------
  const promo = (cls: string, title: string, sub: string, art: HTMLElement | null, go: () => void) => {
    const b = el('button', `promo ${cls}`);
    b.type = 'button';
    if (art) {
      art.classList.add('promo-art');
      b.append(art);
    }
    const label = el('span', 'promo-label');
    label.append(el('strong', undefined, title), el('span', undefined, sub));
    b.append(label);
    b.addEventListener('click', go);
    return b;
  };

  const jump = (target: Page, action?: () => void) => () => {
    page = target;
    action?.();
    render();
  };

  function renderHome() {
    const wrap = el('div', 'shop-home');
    const looks = el('div', 'promo-people');
    for (const [hair, top, hat] of [[6, 4, 0], [7, 8, 8], [2, 5, 4]] as const) {
      looks.append(lookCanvas({ ...appearance.look, hair, top, hat, topColor: (hair * 3) % 16, hairColor: (hair * 5) % 12, glasses: 0, extra: 0 }, { zoom: 3 }));
    }
    wrap.append(
      promo('tall', 'Styles tendance', 'Coiffures, robes et chapeaux : change de look !', looks, jump('clothes', () => (selectedPiece = null))),
      promo('wide', 'NOUVEAU : la salle de jeux', 'Borne d’arcade et fauteuil poire', furnitureThumb('arcade', 'lg'), jump('furniture', () => {
        rubric = { kind: 'furniture', category: 'new' };
        selectedFurniture = 'arcade';
      })),
      promo('wide', 'Pack chambre étoilée', 'Lit étoilé, lampe à lave et ours en peluche', furnitureThumb('litetoile', 'lg'), jump('furniture', () => {
        rubric = { kind: 'furniture', category: 'sleep' };
        selectedFurniture = 'litetoile';
      })),
      promo('wide', 'NOUVEAU : les compagnons', 'Un chat, un chien, un lapin ou un caneton te suit partout', petCanvas('chat', 0, 0), jump('pets')),
    );

    const strip = el('div', 'shop-strip');
    const redeem = el('form', 'redeem');
    const code = el('input');
    code.type = 'text';
    code.placeholder = 'Un code à échanger ?';
    code.maxLength = 24;
    code.autocomplete = 'off';
    code.setAttribute('aria-label', 'Code à échanger');
    const go = el('button', 'primary', 'Échanger');
    go.type = 'submit';
    redeem.append(pixelIcon('gift', 18), code, go);
    redeem.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!code.value.trim()) return;
      void spend(async () => {
        const res = await wallet.redeem(code.value);
        if (res.ok) code.value = '';
        return res;
      }, go);
    });
    const daily = el('button', 'daily-button');
    daily.type = 'button';
    daily.append(pixelIcon('star', 18), el('span', undefined, wallet.get().dailyAvailable ? `Récompense du jour : +${wallet.get().dailyPixels} Pixels` : 'Récompense du jour déjà prise, à demain !'));
    daily.disabled = !wallet.get().dailyAvailable;
    daily.addEventListener('click', () => void spend(() => wallet.claimDaily(), daily));
    strip.append(redeem, daily);
    body.append(wrap, strip);
  }

  // ----- Furniture --------------------------------------------------------------
  const rubricId = () => (rubric.kind === 'furniture' ? rubric.category : rubric.kind);

  function renderFurniture() {
    const layout = el('div', 'shop-layout');
    const side = el('div', 'shop-side');
    const search = el('div', 'shop-search');
    const input = el('input');
    input.type = 'search';
    input.placeholder = 'Chercher un meuble…';
    input.value = query;
    input.setAttribute('aria-label', 'Chercher un meuble');
    search.append(input, pixelIcon('search', 16));
    input.addEventListener('input', () => {
      query = input.value;
      selectedFurniture = null;
      renderResults();
    });
    const nav = el('nav', 'cat-nav');
    const add = (id: string, label: string, target: Rubric, heading?: string) => {
      if (heading) nav.append(el('h3', undefined, heading));
      const b = el('button', rubricId() === id && !query ? 'active' : undefined, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        rubric = target;
        query = '';
        selectedFurniture = null;
        render();
      });
      nav.append(b);
    };
    for (const r of RUBRICS) add(r.id, r.label, { kind: 'furniture', category: r.id }, r.heading);
    add('floors', 'Sols', { kind: 'floors' }, 'Ton appart');
    add('walls', 'Murs', { kind: 'walls' });
    side.append(search, nav);

    const main = el('div', 'shop-main');
    const results = el('div', 'shop-results');
    const preview = el('div', 'cat-preview');
    main.append(results, preview);
    layout.append(side, main);
    body.append(layout);

    function renderResults() {
      results.replaceChildren();
      preview.replaceChildren();
      preview.hidden = true;
      if (!catalogue) {
        results.append(el('p', 'muted', 'Chargement…'));
        return;
      }
      const q = norm(query.trim());
      if (q) {
        bannerTitle.textContent = `Résultats pour « ${query.trim()} »`;
        bannerSub.textContent = 'Dans tout le mobilier de la boutique.';
      } else {
        const info = RUBRICS.find((r) => r.id === rubricId());
        bannerTitle.textContent = info ? info.label : rubric.kind === 'floors' ? 'Sols' : 'Murs';
        bannerSub.textContent = info ? info.text : rubric.kind === 'floors' ? 'Change le sol de ton appart, gratuitement.' : 'Change le papier peint de ton appart, gratuitement.';
      }
      const grid = el('div', 'catalogue-grid furniture');
      if (rubric.kind === 'furniture' || q) {
        const category = rubric.kind === 'furniture' ? rubric.category : 'all';
        const list = catalogue.furniture.filter((f) => {
          if (q) return norm(f.name).includes(q);
          if (category === 'new') return f.price > 0;
          return category === 'all' || f.category === category;
        });
        if (!list.length) results.append(el('p', 'muted', 'Rien ne correspond. Essaie un autre mot !'));
        for (const f of list) {
          const tile = el('button', `cat-tile${f.key === selectedFurniture ? ' active' : ''}`);
          tile.type = 'button';
          tile.title = f.name;
          tile.setAttribute('aria-pressed', String(f.key === selectedFurniture));
          tile.append(furnitureThumb(f.key, 'lg'), el('span', undefined, f.name), priceChip(f.price));
          tile.addEventListener('click', () => {
            selectedFurniture = f.key;
            renderResults();
          });
          grid.append(tile);
        }
        results.append(grid);
        const piece = catalogue.furniture.find((f) => f.key === selectedFurniture);
        if (piece) {
          preview.hidden = false;
          const info = el('div', 'cat-preview-info');
          info.append(el('strong', undefined, piece.name), priceChip(piece.price));
          const buy = el('button', 'primary', piece.price > 0 ? 'Acheter' : 'Prendre');
          buy.type = 'button';
          const poor = piece.price > wallet.get().pixels;
          buy.disabled = poor;
          if (poor) buy.title = `Il te manque ${piece.price - wallet.get().pixels} Pixels`;
          buy.addEventListener('click', () =>
            void spend(async () => {
              const res = await api.buy({ kind: 'furniture', key: piece.key });
              if (!res.ok) return { ok: false, message: res.error };
              wallet.setPixels(res.data.pixels);
              options.onChanged();
              return { ok: true, message: `« ${piece.name} » est dans ton inventaire.` };
            }, buy),
          );
          preview.append(furnitureThumb(piece.key, 'lg'), info, buy);
        }
      } else if (rubric.kind === 'floors') {
        for (const f of catalogue.floors) {
          grid.append(swatch(f.name, `linear-gradient(135deg, ${hex(f.a)} 50%, ${hex(f.b)} 50%)`, mine?.floorStyle === f.id, { floor: f.id }));
        }
        grid.className = 'catalogue-grid floors';
        results.append(grid);
      } else {
        for (const w of catalogue.walls) {
          grid.append(swatch(w.name, `linear-gradient(90deg, ${hex(w.left)} 50%, ${hex(w.right)} 50%)`, mine?.wallStyle === w.id, { wall: w.id }));
        }
        grid.className = 'catalogue-grid walls';
        results.append(grid);
      }
    }

    function swatch(name: string, background: string, active: boolean, body: { floor?: string; wall?: string }) {
      const b = el('button', `swatch-card${active ? ' active' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(active));
      const chip = el('span', 'chip-swatch');
      chip.style.background = background;
      b.append(chip, el('span', undefined, name));
      b.addEventListener('click', async () => {
        const res = await api.updateApartment(body);
        if (res.ok) {
          mine = res.data;
          say('Ton appart a changé de look !');
          options.onChanged();
          renderResults();
        } else say(res.error);
      });
      return b;
    }
    renderResults();
  }

  // ----- Clothes ----------------------------------------------------------------
  function renderClothes() {
    const layout = el('div', 'shop-layout');
    const side = el('div', 'shop-side');
    const nav = el('nav', 'cat-nav');
    nav.append(el('h3', undefined, 'Garde-robe'));
    for (const [key, label] of SLOT_LABELS) {
      const b = el('button', key === slot ? 'active' : undefined, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        slot = key;
        selectedPiece = null;
        render();
      });
      nav.append(b);
    }
    const mineBtn = el('button', 'primary shop-wardrobe', 'Mon personnage');
    mineBtn.type = 'button';
    mineBtn.addEventListener('click', () => options.openWardrobe());
    side.append(nav, mineBtn);

    const info = SLOT_LABELS.find(([key]) => key === slot)!;
    bannerTitle.textContent = info[1];
    bannerSub.textContent = info[2];

    const main = el('div', 'shop-main');
    const grid = el('div', 'catalogue-grid furniture');
    for (const piece of LOOK_ITEMS[slot]) {
      if (piece.id === 0 && (slot === 'hat' || slot === 'glasses' || slot === 'extra')) continue;
      const owns = appearance.owns(slot, piece.id);
      const worn = appearance.look[slot] === piece.id;
      const tile = el('button', `cat-tile${piece.id === selectedPiece ? ' active' : ''}`);
      tile.type = 'button';
      tile.setAttribute('aria-pressed', String(piece.id === selectedPiece));
      tile.append(thumbCanvas({ ...appearance.look, [slot]: piece.id }, slot, 3), el('span', undefined, piece.name));
      tile.append(worn ? el('span', 'chip free', 'Porté') : piece.price === 0 ? el('span', 'chip free', 'Gratuit') : owns ? el('span', 'chip free', 'À toi') : priceChip(piece.price));
      tile.addEventListener('click', () => {
        selectedPiece = piece.id;
        render();
      });
      grid.append(tile);
    }
    const preview = el('div', 'cat-preview');
    preview.hidden = selectedPiece === null;
    if (selectedPiece !== null) {
      const piece = LOOK_ITEMS[slot][selectedPiece]!;
      const owns = appearance.owns(slot, piece.id);
      const worn = appearance.look[slot] === piece.id;
      const tryOn = { ...appearance.look, [slot]: piece.id };
      const person = el('div', 'shop-person');
      person.append(lookCanvas(tryOn, { zoom: 3 }));
      const text = el('div', 'cat-preview-info');
      text.append(el('strong', undefined, piece.name), piece.price === 0 ? el('span', 'chip free', 'Gratuit') : owns ? el('span', 'chip free', 'À toi') : priceChip(piece.price));
      const action = el('button', 'primary');
      action.type = 'button';
      if (!owns) {
        action.textContent = 'Acheter';
        action.disabled = piece.price > wallet.get().pixels;
        if (action.disabled) action.title = `Il te manque ${piece.price - wallet.get().pixels} Pixels`;
        action.addEventListener('click', () => void spend(() => appearance.buy(slot, piece.id), action));
      } else if (worn) {
        action.textContent = 'Déjà porté';
        action.disabled = true;
      } else {
        action.textContent = 'Porter';
        action.addEventListener('click', () =>
          void spend(async () => {
            const res = await appearance.save({ ...appearance.look, [slot]: piece.id });
            if (res.ok) options.onAppearance();
            return res;
          }, action),
        );
      }
      preview.append(person, text, action);
    }
    main.append(el('div', 'shop-results').appendChild(grid).parentElement!, preview);
    layout.append(side, main);
    body.append(layout);
  }

  // ----- Pets -------------------------------------------------------------------
  function renderPets() {
    bannerTitle.textContent = 'Compagnons';
    bannerSub.textContent = `Adopte un petit animal qui te suit partout. Tu peux en avoir ${MAX_PETS}, un seul vient avec toi.`;
    const species = petSpecies(speciesKey)!;
    const layout = el('div', 'shop-layout pets');
    const side = el('div', 'shop-side');
    const nav = el('nav', 'cat-nav');
    nav.append(el('h3', undefined, 'À adopter'));
    for (const s of PET_SPECIES) {
      const b = el('button', s.key === speciesKey ? 'active' : undefined);
      b.type = 'button';
      b.append(document.createTextNode(s.name));
      b.addEventListener('click', () => {
        speciesKey = s.key;
        petColor = 0;
        petName = '';
        render();
      });
      nav.append(b);
    }
    side.append(nav);

    const main = el('div', 'shop-main pets-main');
    const stage = el('div', 'pet-stage');
    const picture = petCanvas(species.key, petColor, petFrame);
    picture.className = 'pixel-art pet-picture';
    picture.style.width = `${picture.width * 6}px`;
    picture.style.height = `${picture.height * 6}px`;
    stage.append(picture);
    const form = el('form', 'pet-form');
    form.append(el('h3', undefined, species.name), el('p', 'muted small', species.description));
    const swatchRow = el('div', 'wd-swatches');
    species.colors.forEach((c, k) => {
      const b = el('button', `wd-swatch${k === petColor ? ' active' : ''}`);
      b.type = 'button';
      b.style.background = hex(c.body);
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.addEventListener('click', () => {
        petColor = k;
        render();
      });
      swatchRow.append(b);
    });
    const name = el('input');
    name.type = 'text';
    name.maxLength = 20;
    name.placeholder = `Nom (par défaut : ${species.name})`;
    name.value = petName;
    name.setAttribute('aria-label', 'Nom du compagnon');
    name.addEventListener('input', () => (petName = name.value));
    const adopt = el('button', 'primary');
    adopt.type = 'submit';
    adopt.append(document.createTextNode('Adopter '), pixelsLabel(species.price, 'px dark'));
    const full = pets.length >= MAX_PETS;
    adopt.disabled = full || species.price > wallet.get().pixels;
    if (full) adopt.title = `Tu as déjà ${MAX_PETS} compagnons`;
    else if (adopt.disabled) adopt.title = `Il te manque ${species.price - wallet.get().pixels} Pixels`;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void spend(async () => {
        const res = await api.buy({ kind: 'pet', species: species.key, color: petColor, name: (petName.trim() || species.name).slice(0, 20) });
        if (!res.ok) return { ok: false, message: res.error };
        wallet.setPixels(res.data.pixels);
        const list = await api.pets();
        if (list.ok) pets = list.data.pets;
        petName = '';
        options.onAppearance();
        return { ok: true, message: `${res.data.pet?.name ?? species.name} a rejoint ta famille !` };
      }, adopt);
    });
    form.append(el('p', 'small', 'Couleur'), swatchRow, name, adopt);
    const top = el('div', 'pet-top');
    top.append(stage, form);

    const mineBox = el('div', 'pet-list');
    mineBox.append(el('h3', undefined, `Mes compagnons (${pets.length}/${MAX_PETS})`));
    if (!pets.length) mineBox.append(el('p', 'muted small', 'Tu n’as pas encore de compagnon.'));
    for (const pet of pets) {
      const row = el('div', `pet-row${pet.active ? ' active' : ''}`);
      const thumb = petCanvas(pet.species, pet.color, 0);
      thumb.className = 'pixel-art';
      thumb.style.width = `${thumb.width * 2}px`;
      thumb.style.height = `${thumb.height * 2}px`;
      const label = el('div', 'pet-name');
      label.append(el('strong', undefined, pet.name), el('span', 'muted small', petSpecies(pet.species)?.name ?? ''));
      const withMe = el('button', undefined, pet.active ? 'Avec moi' : 'Emmener');
      withMe.type = 'button';
      withMe.classList.toggle('active', pet.active);
      withMe.addEventListener('click', () =>
        void spend(async () => {
          const res = await api.setActivePet(pet.active ? null : pet.id);
          if (!res.ok) return { ok: false, message: res.error };
          pets = res.data.pets;
          options.onAppearance();
          return { ok: true, message: pet.active ? `${pet.name} reste à la maison.` : `${pet.name} vient avec toi !` };
        }, withMe),
      );
      const rename = el('button', undefined, 'Renommer');
      rename.type = 'button';
      rename.addEventListener('click', () => {
        const next = prompt('Nouveau nom (20 caractères au maximum) :', pet.name);
        if (next === null) return;
        void spend(async () => {
          const res = await api.renamePet(pet.id, next);
          if (!res.ok) return { ok: false, message: res.error };
          pets = res.data.pets;
          options.onAppearance();
          return { ok: true, message: 'Nom changé !' };
        });
      });
      const release = el('button', 'danger', 'Laisser partir');
      release.type = 'button';
      release.addEventListener('click', () => {
        if (!confirm(`Laisser partir ${pet.name} ? Les Pixels ne sont pas remboursés.`)) return;
        void spend(async () => {
          const res = await api.releasePet(pet.id);
          if (!res.ok) return { ok: false, message: res.error };
          pets = res.data.pets;
          options.onAppearance();
          return { ok: true, message: `${pet.name} est parti(e) vers de nouvelles aventures.` };
        });
      });
      row.append(thumb, label, withMe, rename, release);
      mineBox.append(row);
    }
    main.append(top, mineBox);
    layout.append(side, main);
    body.append(layout);
  }

  // ----- Subscriptions ----------------------------------------------------------
  function renderVip() {
    bannerTitle.textContent = 'Abonnements';
    bannerSub.textContent = 'Bientôt : le VIP Atelier pour créer plus, et des packs de crédits.';
    const card = el('div', 'vip-card');
    const crown = el('div', 'vip-crown');
    crown.append(pixelIcon('crown', 48));
    const text = el('div', 'vip-text');
    text.append(el('h3', undefined, 'VIP Atelier'), el('p', 'muted', 'Pour les créateurs qui veulent aller plus loin.'));
    const perks = el('ul', 'vip-perks');
    for (const perk of ['Plus de charges de création chaque jour', 'Objets animés', 'Séries limitées et palettes exclusives', 'Un badge à côté de ton pseudo']) {
      const li = el('li');
      li.append(pixelIcon('check', 14), document.createTextNode(perk));
      perks.append(li);
    }
    const soon = el('button', 'primary', 'Bientôt disponible');
    soon.type = 'button';
    soon.disabled = true;
    text.append(perks, soon, el('p', 'muted small', 'Les prix seront fixés après la bêta. Pendant l’alpha, tout se gagne avec des Pixels.'));
    card.append(crown, text);
    body.append(card);
  }

  // ----- Frame ------------------------------------------------------------------
  function render() {
    for (const [key, button] of tabButtons) {
      button.classList.toggle('active', key === page);
      button.setAttribute('aria-selected', String(key === page));
    }
    body.replaceChildren();
    bannerBalance.replaceChildren(el('span', undefined, 'Tes Pixels'), pixelsLabel(wallet.get().pixels));
    bannerIcon.replaceChildren(pixelIcon(({ home: 'gift', furniture: 'catalogue', clothes: 'shirt', pets: 'paw', vip: 'crown' } as const)[page], 28));
    root.dataset.page = page;
    if (page === 'home') {
      bannerTitle.textContent = 'Boutique';
      bannerSub.textContent = 'Meubles, vêtements et compagnons : dépense tes Pixels !';
      renderHome();
    } else if (page === 'furniture') renderFurniture();
    else if (page === 'clothes') renderClothes();
    else if (page === 'pets') renderPets();
    else renderVip();
    clearInterval(petTimer);
    if (page === 'pets' && !root.hidden) {
      petTimer = setInterval(() => {
        petFrame = ((petFrame + 1) % 2) as PetFrame;
        const picture = body.querySelector<HTMLCanvasElement>('.pet-picture');
        if (picture) picture.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(petPixelsOf()), picture.width, picture.height), 0, 0);
      }, 260);
    }
  }
  const petPixelsOf = () => {
    const c = petCanvas(speciesKey, petColor, petFrame);
    return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  };

  for (const [key, label] of PAGES) {
    const b = el('button', undefined, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      page = key;
      say('');
      render();
    });
    tabButtons.set(key, b);
    tabs.append(b);
  }

  function hide() {
    if (root.hidden) return;
    root.hidden = true;
    clearInterval(petTimer);
    options.onToggle(false);
  }
  function open(next?: Page) {
    const wasHidden = root.hidden;
    if (next) page = next;
    root.hidden = false;
    say('');
    render();
    void load();
    if (wasHidden) options.onToggle(true);
  }

  wallet.onChange(() => {
    if (!root.hidden && !busy) render();
  });
  appearance.onChange(() => {
    if (!root.hidden && page === 'clothes') render();
  });
  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') hide();
  });
  addEventListener('pointerdown', (ev) => {
    const t = ev.target as HTMLElement;
    if (!root.hidden && !root.contains(t) && !t.closest?.('[data-shop-toggle]') && !t.closest?.('.toast') && !t.closest?.('.wardrobe')) hide();
  });

  return { element: root, isOpen: () => !root.hidden, toggle: () => (root.hidden ? open() : hide()), open, close: hide };
}
