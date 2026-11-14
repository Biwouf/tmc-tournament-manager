// SaaS S8b — de la proposition Ten'Up (lue par l'Edge `tenup-site`) à la relecture, puis aux
// valeurs de groupe enregistrées par le chemin de `SiteConfigPanel` (validation, UPDATE par groupe).
// Logique pure, sans DOM ni Supabase : testée par `tests/tenup-site-import.test.mjs`.
//
// Règles (brief §4, décision 2) : tout est coché par défaut, sauf ce qui pose problème, décoché et
// signalé — valeur déjà saisie et différente (les deux visibles), prix manquant ou ≤ 1 €, ligne
// « Réduction », produit, image illisible. Les listes (bureau, terrains, tarifs) ne sont jamais
// remplacées : les lignes cochées s'AJOUTENT, et celles déjà présentes (même nom) sont écartées.
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

type OfferTarget = { list: 'lessons' | 'membership' | 'other_fees'; warning?: string };
/** Brief §4 : type Ten'Up → liste de tarifs, et pourquoi la ligne doit être vérifiée. */
export function offerTarget(offer: TenupClubProfile['offers'][number]): OfferTarget | null {
  let target: OfferTarget;
  if (offer.type === 'Adhésion') target = { list: LESSON.test(offer.title) ? 'lessons' : 'membership' };
  else if (/^Enseignement/.test(offer.type)) target = { list: 'lessons' };
  else if (offer.type === 'Carnet de tickets') target = { list: 'other_fees' };
  else if (offer.type === 'Produit') target = { list: 'other_fees', warning: 'produit (balles, stage…) : à garder ?' };
  else return null; // animations, événements : hors périmètre
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

  // Bureau : le président à sa place, les autres dans la liste.
  const president = proposal.board.find((m) => m.roles.some((r) => /^présidente?$/i.test(r)));
  if (president) {
    field('club', 'president_name', 'Président·e', tidyCase(president.name));
    field('club', 'president_role', 'Fonction du président·e', president.roles.find((r) => /^présidente?$/i.test(r))!);
  }
  const addEntries = (group: ReviewGroup, list: string, key: string, entries: { id: string; label: string; entry: ListEntry; next: string; warning?: string; note?: string; editable?: 'offer' }[]) => {
    const existing = new Set(((values[group][list] as ListEntry[] | undefined) ?? []).map((e) => norm(e[key] ?? '')));
    for (const e of entries) {
      if (existing.has(norm(e.entry[key] ?? ''))) continue; // déjà sur le site
      existing.add(norm(e.entry[key] ?? ''));
      items.push({ id: e.id, group, list, label: e.label, current: '', next: e.next, entry: e.entry, warning: e.warning, note: e.note, editable: e.editable, checked: !e.warning });
    }
  };
  addEntries('club', 'board', 'name', proposal.board.filter((m) => m !== president).map((m, i) => {
    const name = tidyCase(m.name), role = m.roles.join(' · ');
    return { id: `club.board.${i}`, label: 'Membre du bureau', next: `${name} — ${role}`, entry: blankEntry('club', 'board', { name, role }) };
  }));

  addEntries('infra', 'courts', 'detail', proposal.courts.map((c, i) => {
    const detail = [c.surface, c.covered ? (c.covered === c.count ? 'couverts' : `dont ${c.covered} couvert${c.covered > 1 ? 's' : ''}`) : ''].filter(Boolean).join(' · ');
    return { id: `infra.courts.${i}`, label: 'Terrains', next: `${c.count} × ${c.sport} — ${detail}`, entry: blankEntry('infra', 'courts', { count: String(c.count), label: c.sport, detail }) };
  }));

  // Tarifs : la saison, puis une ligne par offre utile, nom et prix modifiables.
  const offers = proposal.offers.map((offer, i) => ({ offer, i, target: offerTarget(offer) })).filter((o) => o.target);
  if (offers.length) field('pricing', 'season', 'Saison', pricingSeason(proposal.offers));
  for (const list of ['membership', 'lessons', 'other_fees'] as const) {
    const key = list === 'other_fees' ? 'label' : 'name';
    addEntries('pricing', list, key, offers.filter((o) => o.target!.list === list).map(({ offer, i, target }) => {
      const price = offer.price === null ? '' : list === 'other_fees' ? `${offer.from ? 'à partir de ' : ''}${euros(offer.price)} €` : String(offer.price);
      const entry = list === 'other_fees'
        ? blankEntry('pricing', list, { label: offer.title, price })
        : blankEntry('pricing', list, { name: offer.title, price, subtitle: offer.from ? 'à partir de' : '' });
      const label = list === 'membership' ? 'Adhésion' : list === 'lessons' ? 'Adhésion + cours' : 'Autres frais';
      return { id: `pricing.${list}.${i}`, label, next: offerSummary(list, entry), entry, warning: target!.warning, note: offer.description, editable: 'offer' as const };
    }));
  }
  return items;
}

export function offerSummary(list: string, entry: ListEntry): string {
  if (list === 'other_fees') return `${entry.label} — ${entry.price || 'sans prix'}`;
  return `${entry.name} — ${entry.price ? `${entry.subtitle ? `${entry.subtitle} ` : ''}${entry.price.replace('.', ',')} €` : 'sans prix'}`;
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
  const used = new Set(items.filter((i) => i.image && i.checked && !i.disabled).map((i) => i.next));
  return [proposal.club.logo, proposal.club.banner].filter((url) => url && !used.has(url));
}
