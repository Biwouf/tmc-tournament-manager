// SaaS S8b — de la proposition Ten'Up (lue par l'Edge `tenup-site`) à la relecture, puis aux
// valeurs de groupe enregistrées par le chemin de `SiteConfigPanel` (validation, UPDATE par groupe).
// Logique pure, sans DOM ni Supabase : testée par `tests/tenup-site-import.test.mjs`.
//
// Règles (brief §4, décision 2) : tout est coché par défaut, sauf ce qui pose problème, décoché et
// signalé — valeur déjà saisie et différente (les deux visibles), prix manquant ou ≤ 1 €, ligne
// « Réduction », produit, image illisible. Les listes (bureau, terrains, tarifs) ne sont jamais
// remplacées : les lignes cochées s'AJOUTENT, et celles déjà présentes (même nom) sont écartées.
// S8b-bis : terrains regroupés (aussi en cartes d'accueil), photo de l'installation, bandeau d'appel
// final par défaut, une ligne par tarif quand la page de l'offre a été lue.
import type { TenupClubProfile } from '../../shared/tenupSite.mjs';
import type { ClubConfig } from './clubConfig';
import {
  CLUB_CONFIG_GROUPS, groupValueFromConfig, itemsOf,
  type ClubConfigGroupKey, type GroupSpec, type GroupValue, type ListEntry,
} from './clubConfigWrite';

/** Ce que l'Edge garde : le profil, images déjà copiées dans `content-images/<club>/config/`. */
export type TenupSiteProposal = TenupClubProfile & { image_errors: string[] };

export type ReviewGroup = Extract<ClubConfigGroupKey, 'brand' | 'contact' | 'social' | 'home' | 'club' | 'infra' | 'pricing'>;

export const REVIEW_CARDS: { group: ReviewGroup; title: string }[] = [
  { group: 'brand', title: 'Identité' },
  { group: 'contact', title: 'Contact' },
  { group: 'social', title: 'Réseaux' },
  { group: 'home', title: 'Accueil' },
  { group: 'club', title: 'Le club' },
  { group: 'infra', title: 'Infrastructures' },
  { group: 'pricing', title: 'Tarifs' },
];

export type ReviewItem = {
  id: string;
  group: ReviewGroup;
  /** Champ du groupe (clé de l'état de formulaire), ou entrée ajoutée à une liste. */
  field?: string;
  list?: string;
  label: string;
  /** Valeur actuelle affichée (« actuel : … »), vide si le champ est vide. */
  current: string;
  /** Valeur proposée ; pour une entrée de liste, son résumé. */
  next: string;
  entry?: ListEntry;
  image?: boolean;
  /** Pourquoi la ligne est décochée (« à vérifier »). */
  warning?: string;
  /** Texte d'appoint (description d'une offre Ten'Up), pour corriger le prix. */
  note?: string;
  checked: boolean;
  /** Ligne inutilisable (image illisible) : affichée, jamais cochable. */
  disabled?: boolean;
  /** Modifiable sur place : un texte, ou le nom et le prix d'un tarif. */
  editable?: 'text' | 'offer';
};

const spec = (key: ReviewGroup): GroupSpec => CLUB_CONFIG_GROUPS.find((g) => g.key === key)!;
const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** « MOISSAC » → « Moissac », « Zoé MICHEL » → « Zoé Michel » ; les mots en minuscules restent. */
export function tidyCase(value: string): string {
  return value.replace(/[\p{L}]+/gu, (word) =>
    word.length > 1 && word === word.toUpperCase() ? word[0] + word.slice(1).toLowerCase() : word);
}

/** « 0629334604 » → « 06 29 33 46 04 » ; tout autre format est gardé tel quel. */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return /^0\d{9}$/.test(digits) ? digits.replace(/(\d{2})(?=\d)/g, '$1 ') : value.trim();
}

/** Année entre parenthèses (« (2027) ») → « 2026/2027 » ; à défaut la saison en cours (sept. → août). */
export function pricingSeason(offers: TenupClubProfile['offers'], today = new Date()): string {
  const years = offers.map((o) => o.year).filter((y): y is number => y !== null);
  if (years.length) {
    const year = Math.max(...years);
    return `${year - 1}/${year}`;
  }
  const y = today.getFullYear();
  return today.getMonth() >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

const euros = (price: number) => (Number.isInteger(price) ? String(price) : price.toFixed(2).replace('.', ','));
const LESSON = /\b(cours|mini[- ]?tennis|[ée]cole|stages?)\b/i;

const lowerFirst = (v: string) => (v ? v[0].toLowerCase() + v.slice(1) : v);
const surfaceList = (rows: TenupClubProfile['courts']) =>
  [...new Set(rows.map((r) => r.surface).filter(Boolean))].map((v, i) => (i ? lowerFirst(v) : v)).join(', ');

export type CourtGroup = { count: number; label: string; detail: string; noun: string };
/** S8b-bis — les terrains regroupés comme le site du CAC : le tennis en « Courts extérieurs » et
 * « Courts couverts » (surfaces en détail), chaque autre sport en une carte. */
export function courtGroups(courts: TenupClubProfile['courts']): CourtGroup[] {
  const groups: CourtGroup[] = [];
  const tennis = courts.filter((c) => /^tennis$/i.test(c.sport));
  const outdoor = tennis.reduce((n, c) => n + c.count - c.covered, 0);
  const covered = tennis.reduce((n, c) => n + c.covered, 0);
  const courtNoun = (n: number) => (n > 1 ? 'courts' : 'court');
  if (outdoor) groups.push({ count: outdoor, label: outdoor > 1 ? 'Courts extérieurs' : 'Court extérieur', detail: surfaceList(tennis.filter((c) => c.count > c.covered)), noun: courtNoun(outdoor) });
  if (covered) groups.push({ count: covered, label: covered > 1 ? 'Courts couverts' : 'Court couvert', detail: surfaceList(tennis.filter((c) => c.covered > 0)), noun: courtNoun(covered) });
  for (const sport of [...new Set(courts.map((c) => c.sport))].filter((s) => !/^tennis$/i.test(s))) {
    const rows = courts.filter((c) => c.sport === sport);
    const count = rows.reduce((n, c) => n + c.count, 0);
    const roofed = rows.reduce((n, c) => n + c.covered, 0);
    const noun = count > 1 ? 'terrains' : 'terrain';
    const cover = roofed ? (roofed === count ? (count > 1 ? 'couverts' : 'couvert') : `dont ${roofed} couvert${roofed > 1 ? 's' : ''}`) : '';
    groups.push({ count, label: `${count > 1 ? 'Terrains' : 'Terrain'} de ${lowerFirst(sport)}`, detail: [surfaceList(rows), cover].filter(Boolean).join(' · '), noun });
  }
  return groups;
}

/** Bandeau d'appel final proposé quand il est vide : le texte du site du CAC. */
export const DEFAULT_HOME_CTA = {
  cta_title: 'Rejoignez notre club',
  cta_text: 'Une question, une envie d’essayer, nouer un partenariat ? Écrivez-nous, on vous répond vite.',
  cta_button: 'Nous contacter',
} as const;

type OfferTarget = { list: 'lessons' | 'membership' | 'other_fees'; warning?: string };
/** Brief §4 : type Ten'Up → liste de tarifs, et pourquoi la ligne doit être vérifiée. */
export function offerTarget(offer: TenupClubProfile['offers'][number]): OfferTarget | null {
  let target: OfferTarget;
  if (offer.type === 'Adhésion') target = { list: LESSON.test(offer.title) ? 'lessons' : 'membership' };
  else if (/^Enseignement/.test(offer.type)) target = { list: 'lessons' };
  else if (offer.type === 'Carnet de tickets') target = { list: 'other_fees' };
  else if (offer.type === 'Produit') target = { list: 'other_fees', warning: 'produit (balles, stage…) : à garder ?' };
  else return null; // animations, événements : hors périmètre
  if (offer.tariffs?.length) return target; // prix vérifiés tarif par tarif
  if (offer.price === null) return { ...target, warning: 'prix manquant' };
  if (offer.price <= 1 || /r[ée]duction/i.test(offer.title)) return { ...target, warning: 'prix à vérifier' };
  return target;
}

/** Une entrée de liste complète (toutes les clés du formulaire, vides par défaut). */
function blankEntry(group: ReviewGroup, list: string, values: Record<string, string>): ListEntry {
  const item = itemsOf(spec(group)).find((i) => i.kind === 'list' && i.key === list);
  const fields = item && item.kind === 'list' ? item.fields : [];
  return { ...Object.fromEntries(fields.map((f) => [f.key, ''])), ...values };
}

/** Construit la relecture : une ligne par valeur Ten'Up utile, comparée à la config actuelle. */
export function buildReview(proposal: TenupSiteProposal, config: ClubConfig): ReviewItem[] {
  const items: ReviewItem[] = [];
  const values = Object.fromEntries(REVIEW_CARDS.map(({ group }) => [group, groupValueFromConfig(spec(group), config)])) as Record<ReviewGroup, GroupValue>;

  const field = (group: ReviewGroup, key: string, label: string, next: string, extra: Partial<ReviewItem> = {}) => {
    const current = String(values[group][key] ?? '').trim();
    next = next.trim();
    if (!next && !extra.disabled) return;
    const same = extra.image ? current === next : norm(current) === norm(next) ||
      (key === 'phone' && current.replace(/\D/g, '') === next.replace(/\D/g, ''));
    if (same && !extra.disabled) return;
    const warning = extra.warning ?? (current ? 'remplace la valeur actuelle' : undefined);
    items.push({ id: `${group}.${key}`, group, field: key, label, current, next, checked: !warning && !extra.disabled, ...extra, warning });
  };

  const { club } = proposal;
  field('brand', 'logo', 'Logo', club.logo, proposal.image_errors.includes('logo')
    ? { image: true, disabled: true, warning: 'image illisible : ajoutez-la à la main' } : { image: true });
  field('contact', 'address_street', 'Rue', club.street);
  field('contact', 'address_postal_code', 'Code postal', club.postal_code);
  field('contact', 'address_city', 'Ville', tidyCase(club.city));
  field('contact', 'phone', 'Téléphone', formatPhone(club.phone));
  field('contact', 'email', 'E-mail', club.email);
  field('social', 'facebook_url', 'Facebook', club.facebook_url);
  field('social', 'instagram_url', 'Instagram', club.instagram_url);
  field('home', 'hero_image', 'Photo du bandeau', club.banner, proposal.image_errors.includes('banner')
    ? { image: true, disabled: true, warning: 'image illisible : ajoutez-la à la main' } : { image: true });
  // Ten'Up n'a pas de texte d'accueil : un titre par défaut, modifiable (décision 5).
  if (!String(values.home.hero_title ?? '').trim()) {
    const name = String(values.brand.name ?? '').trim() || tidyCase(club.name);
    field('home', 'hero_title', 'Titre d’accueil (proposé)', `Bienvenue au ${name}`, { editable: 'text' });
  }
  // S8b-bis : bandeau d'appel final par défaut, seulement s'il est entièrement vide.
  if (!['cta_title', 'cta_text', 'cta_button'].some((k) => String(values.home[k] ?? '').trim())) {
    field('home', 'cta_title', 'Appel final : titre (proposé)', DEFAULT_HOME_CTA.cta_title, { editable: 'text' });
    field('home', 'cta_text', 'Appel final : texte (proposé)', DEFAULT_HOME_CTA.cta_text, { editable: 'text' });
    field('home', 'cta_button', 'Appel final : bouton (proposé)', DEFAULT_HOME_CTA.cta_button, { editable: 'text' });
  }

  // Bureau : le président à sa place, les autres dans la liste.
  const president = proposal.board.find((m) => m.roles.some((r) => /^présidente?$/i.test(r)));
  if (president) {
    field('club', 'president_name', 'Président·e', tidyCase(president.name));
    field('club', 'president_role', 'Fonction du président·e', president.roles.find((r) => /^présidente?$/i.test(r))!);
  }
  type NewEntry = { id: string; label: string; entry: ListEntry; next: string; warning?: string; note?: string; editable?: 'offer' };
  /** `key` : le champ qui identifie une entrée déjà sur le site, ou une fonction. */
  const addEntries = (group: ReviewGroup, list: string, key: string | ((e: ListEntry) => string), entries: NewEntry[], max = Infinity) => {
    const keyOf = (e: ListEntry) => norm(typeof key === 'function' ? key(e) : e[key] ?? '');
    const current = (values[group][list] as ListEntry[] | undefined) ?? [];
    const existing = new Set(current.map(keyOf));
    let room = max - current.length;
    for (const e of entries) {
      if (room <= 0) break;
      if (existing.has(keyOf(e.entry))) continue; // déjà sur le site
      existing.add(keyOf(e.entry));
      room -= 1;
      items.push({ id: e.id, group, list, label: e.label, current: '', next: e.next, entry: e.entry, warning: e.warning, note: e.note, editable: e.editable, checked: !e.warning });
    }
  };
  addEntries('club', 'board', 'name', proposal.board.filter((m) => m !== president).map((m, i) => {
    const name = tidyCase(m.name), role = m.roles.join(' · ');
    return { id: `club.board.${i}`, label: 'Membre du bureau', next: `${name} — ${role}`, entry: blankEntry('club', 'board', { name, role }) };
  }));

  // Terrains regroupés (S8b-bis) ; la photo de l'installation sur la première carte, ici et à l'accueil.
  const groups = courtGroups(proposal.courts);
  const photo = proposal.club.installation_image ?? '';
  const photoHome = proposal.club.installation_image_home ?? '';
  const withPhoto = (image: string) => (image ? ' · avec la photo du club' : '');
  addEntries('infra', 'courts', 'label', groups.map((g, i) => {
    const image = i === 0 ? photo : '';
    return { id: `infra.courts.${i}`, label: 'Terrains', next: `${g.count} — ${g.label}${g.detail ? ` (${g.detail})` : ''}${withPhoto(image)}`, entry: blankEntry('infra', 'courts', { count: String(g.count), label: g.label, detail: g.detail, image }) };
  }));
  // Accueil : les mêmes groupes en cartes, trois au plus (recommandation du panneau).
  addEntries('home', 'infra_teaser', 'label', groups.map((g, i) => {
    const detail = [`${g.count} ${g.noun}`, lowerFirst(g.detail)].filter(Boolean).join(' · ');
    const image = i === 0 ? photoHome : '';
    return { id: `home.infra_teaser.${i}`, label: 'Carte infrastructures', next: `${g.label} — ${detail}${withPhoto(image)}`, entry: blankEntry('home', 'infra_teaser', { label: g.label, detail, image }) };
  }), 3);

  // Tarifs : la saison, puis une ligne par offre utile, nom et prix modifiables.
  const offers = proposal.offers.map((offer, i) => ({ offer, i, target: offerTarget(offer) })).filter((o) => o.target);
  if (offers.length) field('pricing', 'season', 'Saison', pricingSeason(proposal.offers));
  for (const list of ['membership', 'lessons', 'other_fees'] as const) {
    const key = list === 'other_fees' ? 'label' : 'name';
    const label = list === 'membership' ? 'Adhésion' : list === 'lessons' ? 'Adhésion + cours' : 'Autres frais';
    // Une ligne de grille se reconnaît à son nom ET à son offre (« Adulte » peut exister deux fois).
    const tariffKey = (e: ListEntry) => (e.subtitle && e.subtitle !== 'à partir de' ? `${e[key] ?? ''}|${e.subtitle}` : e[key] ?? '');
    addEntries('pricing', list, list === 'other_fees' ? key : tariffKey, offers.filter((o) => o.target!.list === list).flatMap(({ offer, i, target }): NewEntry[] => {
      // S8b-bis : grille lue sur la page de l'offre → une ligne par tarif, l'offre en sous-titre.
      if (offer.tariffs?.length) {
        return offer.tariffs.map((t, j) => {
          const entry = list === 'other_fees'
            ? blankEntry('pricing', list, { label: `${offer.title} — ${t.name}`, price: t.price === null ? '' : `${euros(t.price)} €` })
            : blankEntry('pricing', list, { name: t.name, subtitle: offer.title, price: t.price === null ? '' : String(t.price) });
          const warning = target!.warning ?? (t.price === null ? 'prix manquant' : t.price <= 1 ? 'prix à vérifier' : undefined);
          return { id: `pricing.${list}.${i}.${j}`, label, next: offerSummary(list, entry), entry, warning, note: t.note, editable: 'offer' };
        });
      }
      const price = offer.price === null ? '' : list === 'other_fees' ? `${offer.from ? 'à partir de ' : ''}${euros(offer.price)} €` : String(offer.price);
      const entry = list === 'other_fees'
        ? blankEntry('pricing', list, { label: offer.title, price })
        : blankEntry('pricing', list, { name: offer.title, price, subtitle: offer.from ? 'à partir de' : '' });
      return [{ id: `pricing.${list}.${i}`, label, next: offerSummary(list, entry), entry, warning: target!.warning, note: offer.description, editable: 'offer' }];
    }));
  }
  return items;
}

export function offerSummary(list: string, entry: ListEntry): string {
  if (list === 'other_fees') return `${entry.label} — ${entry.price || 'sans prix'}`;
  const from = entry.subtitle === 'à partir de';
  const offer = entry.subtitle && !from ? ` (${entry.subtitle})` : '';
  return `${entry.name}${offer} — ${entry.price ? `${from ? 'à partir de ' : ''}${entry.price.replace('.', ',')} €` : 'sans prix'}`;
}

export type ReviewWrite = {
  /** Groupes touchés, dans l'ordre des panneaux, prêts pour `saveClubConfigGroup`. */
  groups: { group: GroupSpec; value: GroupValue }[];
  filled: number;
  /** Images remplacées (à supprimer après l'enregistrement, comme le fait `SiteConfigPanel`). */
  replaced: string[];
};

/** Les lignes cochées → valeurs de groupe complètes (config actuelle + ajouts). Rien d'autre. */
export function applyReview(config: ClubConfig, items: ReviewItem[]): ReviewWrite {
  const chosen = items.filter((i) => i.checked && !i.disabled);
  const groups: ReviewWrite['groups'] = [];
  const replaced: string[] = [];
  for (const { group } of REVIEW_CARDS) {
    const mine = chosen.filter((i) => i.group === group);
    if (!mine.length) continue;
    const value = groupValueFromConfig(spec(group), config);
    for (const item of mine) {
      if (item.field) {
        if (item.image && item.current) replaced.push(item.current);
        value[item.field] = item.next.trim();
      } else if (item.list && item.entry) {
        // Un prix saisi « 117,50 » : le formulaire attend « 117.50 » pour un montant.
        const entry = item.list === 'other_fees' || item.entry.price === undefined ? item.entry : { ...item.entry, price: item.entry.price.replace(',', '.').trim() };
        value[item.list] = [...((value[item.list] as ListEntry[] | undefined) ?? []), entry];
      }
    }
    groups.push({ group: spec(group), value });
  }
  return { groups, filled: chosen.length, replaced };
}

/** Images copiées pour la proposition et non retenues : à supprimer une fois la relecture enregistrée. */
export function unusedProposalImages(proposal: TenupSiteProposal, items: ReviewItem[]): string[] {
  const kept = items.filter((i) => i.checked && !i.disabled);
  const used = new Set([...kept.filter((i) => i.image).map((i) => i.next), ...kept.map((i) => i.entry?.image ?? '')]);
  return [proposal.club.logo, proposal.club.banner, proposal.club.installation_image ?? '', proposal.club.installation_image_home ?? '']
    .filter((url) => url && !used.has(url));
}
