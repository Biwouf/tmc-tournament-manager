// Multi-tenant — PR6b : écriture de `club_settings.config` (MULTI_TENANT.md §6.1).
//
// Miroir strict de `clubConfig.ts`, qui est permissif PAR CONCEPTION (`.catch()` partout) :
// ici on REFUSE au lieu de retomber sur un défaut. La raison est écrite dans le schéma de
// lecture — `z.array(...).catch([])` fait perdre TOUTE une liste à la relecture dès qu'une de
// ses entrées est malformée. Accepter silencieusement une entrée invalide à l'écriture, c'est
// perdre la liste au rechargement suivant, sans message, et laisser l'admin croire à un bug
// d'enregistrement. D'où le §6 du brief : valider entrée par entrée et NOMMER la fautive.
//
// Une seule table de specs porte les clés, leurs types, leurs libellés et le ⬤ du
// `web_site_brief.md` §5 : le schéma zod, les formulaires et le nommage de l'entrée fautive
// en dérivent tous. Les dissocier, c'est se garantir qu'un libellé et sa validation
// divergeront.
//
// Périmètre : les DIX groupes du `web_site_brief.md` §5 — `brand`, `home`, `contact` (PR6a),
// `social`, `partners`, `legal`, `settings` (PR6c) et les trois pages de contenu `club`,
// `infra`, `pricing` (PR6d). Le contrat de la VITRINE est CLOS.
//
// PR6d apporte les trois dernières extensions du modèle, chacune posée avec le groupe qui
// l'exerce, et toutes les trois tenues à la même règle que celles de PR6c : l'état de
// formulaire garde UNE seule forme, PLATE, et seuls les deux points qui lisent et écrivent le
// JSONB connaissent la forme réelle (`groupValueFromConfig`, `configFromGroupValue`).
//   - OBJETS IMBRIQUÉS (`club.president`, `club.coach`, `infra.clubhouse`,
//     `infra.locker_rooms`) : la clé de formulaire reste plate et SANS POINT
//     (`president_photo`), la spec porte en plus le chemin réel (`path: ['president','photo']`).
//     Une clé pointée casserait `setAtPath` en silence — cf. `SiteConfigPanel.tsx`.
//   - LISTES DE SCALAIRES (`club.values`, `club.methods`, `club.levels`,
//     `club.coach.credentials`, `infra.clubhouse.images`) : `scalar: true` + UN seul champ.
//     L'état reste des `ListEntry` à une clé, donc l'ajout, le retrait, le réordonnancement et
//     les chemins de fichiers en attente (`clubhouse_images.0.value`) marchent sans une ligne
//     de plus ; l'emballage `{ value }` ne sort jamais du formulaire.
//   - Le type `number` (`pricing.lessons[].price`, `pricing.membership[].price`) : sa propre
//     branche de schéma, comme `bool` en PR6c.
//
// PR7 ajoute un ONZIÈME groupe, `posters`, qui n'est pas de la vitrine : deux LISTES de fonds
// d'affiche consommées par deux écrans du BO. Il apporte la seule extension qu'il exerce —
// `dimensions` sur `FieldSpec` —, dans l'esprit du `path` de PR6d : un champ DÉCLARATIF de
// plus, honoré par le seul sélecteur d'image. `groupSchema`, `formatIssue` et `setAtPath` ne le
// connaissent pas, et les listes elles-mêmes ne demandent RIEN de neuf : c'est la forme de
// `partners` et de `home.stats`.
import { z } from 'zod';
import { supabase } from './supabase';
import { CLUB_CONFIG_VERSION, type ClubConfig } from './clubConfig';

// ── Specs ────────────────────────────────────────────────────────────────────

/** Types de la table du `web_site_brief.md` §5. Tous sont désormais exercés par un groupe.
 *
 *  ⚠️ `bool` ne décrit QUE les drapeaux d'affichage de `settings.*`, dont l'absence vaut `true`
 *  (§5.10) : c'est ce que `groupValueFromConfig` applique, en miroir du helper `flag` du schéma
 *  de lecture. Un booléen à défaut `false` devra porter son défaut dans sa spec plutôt que
 *  réutiliser ce type tel quel.
 *
 *  ⚠️ `number` n'est PAS le type de tous les prix : `pricing.other_fees[].price` est du `text`,
 *  son unité étant variable (« 15€ / h »). Voir le commentaire de `pricingSchema`. */
export type FieldType =
  | 'text'
  | 'longtext'
  | 'image'
  | 'color'
  | 'url'
  | 'email'
  | 'tel'
  | 'bool'
  | 'number';

export type FieldSpec = {
  /** Clé de l'ÉTAT DE FORMULAIRE. Plate, et SANS POINT : `setAtPath` découpe les chemins de
   *  fichiers en attente sur le point, et une clé pointée y serait lue comme un index de liste
   *  — l'objet entier serait écrasé par une URL, sans erreur. Voir `path` pour le JSONB. */
  key: string;
  label: string;
  type: FieldType;
  /** Chemin réel dans le JSONB quand il diffère de `[key]` — les objets imbriqués de PR6d
   *  (`['president', 'photo']`). N'a de sens qu'au niveau du GROUPE : dans une entrée de liste,
   *  la clé du champ EST son chemin. */
  path?: string[];
  /** Le ⬤ du brief §5. SIGNALÉ à l'écran, mais NON bloquant au niveau du groupe : un club en
   *  cours de saisie est le cas nominal, au même titre que `config = '{}'`. Dans une ENTRÉE
   *  de liste, en revanche, il bloque — cf. `fieldSchema`. */
  required?: boolean;
  /** Dimensions du RENDU d'un champ `image` — PR7, les deux fonds d'affiche.
   *
   *  Le fond d'une affiche n'est pas un décor : les textes sont écrits en position absolue à
   *  des coordonnées figées, et une image aux mauvaises proportions rend l'affiche
   *  INUTILISABLE, texte par-dessus graphisme. Le sélecteur d'image REFUSE donc le fichier
   *  avant tout upload (`SiteConfigFields.tsx`) — un avertissement se franchit d'un clic, et
   *  l'affiche fausse ne se voit qu'après diffusion.
   *
   *  ⚠️ Ce n'est PAS une définition à respecter au pixel près : ce qui est contrôlé, ce sont
   *  les PROPORTIONS (à 2 % près) et une taille MINIMALE. Les deux affiches sont de l'A4
   *  portrait, dont aucune définition en pixels ne tombe juste — exiger l'égalité exacte
   *  refusait un 1414 × 2000 pour l'affiche 794 × 1123, alors que c'est le même format.
   *  Déclaratif comme `path` : rien d'autre ne le lit. */
  dimensions?: { width: number; height: number };
  help?: string;
  placeholder?: string;
};

export type ListSpec = {
  /** Clé de l'ÉTAT DE FORMULAIRE — voir `FieldSpec.key`. Elle préfixe aussi les chemins de
   *  fichiers en attente (`clubhouse_images.0.value`). */
  key: string;
  label: string;
  /** Au singulier et sans article : sert à nommer l'entrée fautive (« 2ᵉ horaire : … »). */
  singular: string;
  help?: string;
  /** Chemin réel dans le JSONB quand il diffère de `[key]` — `['coach', 'credentials']`. */
  path?: string[];
  /** Liste de VALEURS SIMPLES (`list<text>`, `list<image>`) et non d'objets : `fields` en porte
   *  alors exactement UN. L'état de formulaire reste des `ListEntry` à une clé — c'est ce qui
   *  laisse le rendu, l'ajout, le retrait, le réordonnancement et le remap des fichiers en
   *  attente fonctionner sans rien savoir de cette forme —, et l'emballage `{ value: … }` est
   *  déballé à l'écriture : le JSONB porte bien `["Respect", "Convivialité"]`, la forme que
   *  décrit la spec et que PR9 lira. */
  scalar?: true;
  fields: FieldSpec[];
};

/** Un panneau est une suite ORDONNÉE de champs et de listes : le brief §5 les entrelace
 *  (hero, puis chiffres clés, puis teaser école…), et les séparer casserait l'ordre de
 *  lecture. `section` ouvre un sous-titre quand elle change. */
export type ItemSpec =
  | ({ kind: 'field'; section?: string } & FieldSpec)
  | ({ kind: 'list'; section?: string } & ListSpec);

export type ClubConfigGroupKey =
  | 'brand'
  | 'home'
  | 'club'
  | 'infra'
  | 'pricing'
  | 'contact'
  | 'social'
  | 'partners'
  | 'legal'
  | 'settings'
  | 'posters';

/**
 * Deux formes de groupe, parce que le contrat en a deux :
 *   - `kind: 'fields'` — `config[key]` est un OBJET de champs et de listes (le cas général) ;
 *   - `kind: 'list'`   — `config[key]` est une LISTE à la racine, ce que le brief §5.8 décrit
 *     pour `partners`. Emboîter la liste sous `partners.items` aurait évité cette union, au
 *     prix d'un JSONB divergent de la spec que PR9 lira.
 *
 * L'état de formulaire, lui, garde UNE seule forme : `itemsOf()` présente le groupe-liste
 * comme un groupe à un seul item, si bien que le schéma zod, le nommage de l'entrée fautive,
 * les chemins de fichiers en attente (`partners.0.logo`) et le rendu du panneau fonctionnent
 * sans savoir laquelle des deux formes ils manipulent. Seuls les deux points où le JSONB est
 * lu et écrit connaissent la différence.
 */
type GroupBase = {
  key: ClubConfigGroupKey;
  label: string;
  hint: string;
};

export type GroupSpec =
  | (GroupBase & { kind: 'fields'; items: ItemSpec[] })
  | (GroupBase & { kind: 'list'; list: ListSpec });

/** Les items d'un groupe quelle que soit sa forme — un groupe-liste en a exactement un. */
export function itemsOf(group: GroupSpec): ItemSpec[] {
  return group.kind === 'list' ? [{ kind: 'list', ...group.list }] : group.items;
}

/** Où l'item vit dans le JSONB, sa clé de formulaire par défaut. */
function pathOf(item: ItemSpec): string[] {
  return item.path ?? [item.key];
}

// L'ordre des clés suit celui de `clubConfig.ts`, pour que les deux fichiers se relisent
// en vis-à-vis.
const BRAND: GroupSpec = {
  kind: 'fields',
  key: 'brand',
  label: 'Identité du club',
  hint: 'Nom, logos et couleurs du club',
  items: [
    { kind: 'field', key: 'name', label: 'Nom du club', type: 'text', required: true, placeholder: 'CAC Tennis Club' },
    { kind: 'field', key: 'short_name', label: 'Nom court', type: 'text', placeholder: 'CAC' },
    { kind: 'field', key: 'sport', label: 'Sport', type: 'text', required: true, placeholder: 'Tennis' },
    { kind: 'field', key: 'city', label: 'Ville', type: 'text', required: true, placeholder: 'Castelsarrasin' },
    { kind: 'field', key: 'region', label: 'Département ou région', type: 'text', placeholder: 'Tarn-et-Garonne' },
    { kind: 'field', key: 'logo', label: 'Logo principal', type: 'image', required: true, help: 'Version pour fond clair.' },
    { kind: 'field', key: 'logo_inverse', label: 'Logo pour fond foncé', type: 'image' },
    {
      kind: 'field',
      section: 'Couleurs',
      key: 'color',
      label: 'Couleur principale',
      type: 'color',
      required: true,
      help: 'Boutons, liens, en-têtes. Teinte l’ensemble de ce back-office et de l’application des adhérents — y compris les fonds, bordures et textes secondaires, qui en sont dérivés.',
      placeholder: '#E51828',
    },
    {
      kind: 'field',
      key: 'color_secondary',
      label: 'Couleur secondaire',
      type: 'color',
      help: 'Laissée vide : dérivée de la couleur principale (même teinte, plus claire).',
      placeholder: '#F1818A',
    },
    {
      kind: 'field',
      key: 'color_accent',
      label: 'Couleur d’accent',
      type: 'color',
      // Le mot « accent » vient du `web_site_brief` §4, où il désignait LA couleur de marque.
      // Ici il reprend son sens CSS : le token `--accent`, un fond pâle. La couleur de marque,
      // c'est `color` ci-dessus.
      help: 'Fonds doux, survols, badges. Laissée vide : dérivée de la couleur principale.',
      placeholder: '#F9C9CD',
    },
    { kind: 'field', section: 'Pied de page', key: 'legal_form', label: 'Forme juridique', type: 'text', placeholder: 'Association loi 1901' },
    { kind: 'field', key: 'copyright', label: 'Mention de copyright', type: 'text', help: 'Laissée vide : « © {année} {nom du club} ».' },
  ],
};

const HOME: GroupSpec = {
  kind: 'fields',
  key: 'home',
  label: 'Page d’accueil du site vitrine',
  hint: 'Bandeau, chiffres clés et teasers',
  items: [
    { kind: 'field', section: 'Bandeau d’accueil', key: 'hero_image', label: 'Image de fond', type: 'image', required: true },
    { kind: 'field', key: 'hero_eyebrow', label: 'Sur-titre', type: 'text', placeholder: 'Tennis · Tarn-et-Garonne' },
    { kind: 'field', key: 'hero_title', label: 'Titre', type: 'text', required: true },
    { kind: 'field', key: 'hero_subtitle', label: 'Paragraphe d’introduction', type: 'longtext', required: true },
    { kind: 'field', key: 'hero_cta_primary', label: 'Bouton principal', type: 'text', required: true, placeholder: 'Nous contacter' },
    { kind: 'field', key: 'hero_cta_secondary', label: 'Bouton secondaire', type: 'text', placeholder: 'Découvrir le club' },
    {
      kind: 'list',
      section: 'Chiffres clés',
      key: 'stats',
      label: 'Chiffres clés',
      singular: 'chiffre clé',
      help: 'Quatre entrées recommandées. Une liste vide masque simplement le bloc.',
      fields: [
        { key: 'value', label: 'Chiffre', type: 'text', required: true, placeholder: '6' },
        { key: 'label', label: 'Libellé', type: 'text', required: true, placeholder: 'courts de tennis' },
      ],
    },
    { kind: 'field', section: 'Teaser école de tennis', key: 'school_teaser_eyebrow', label: 'Sur-titre', type: 'text' },
    { kind: 'field', key: 'school_teaser_title', label: 'Titre', type: 'text', required: true },
    { kind: 'field', key: 'school_teaser_text', label: 'Texte', type: 'longtext', required: true },
    { kind: 'field', key: 'school_teaser_cta', label: 'Bouton', type: 'text' },
    { kind: 'field', key: 'school_teaser_image', label: 'Image', type: 'image', required: true },
    {
      kind: 'list',
      section: 'Teaser infrastructures',
      key: 'infra_teaser',
      label: 'Cartes infrastructures',
      singular: 'carte',
      help: 'Trois cartes recommandées.',
      fields: [
        { key: 'label', label: 'Libellé', type: 'text', required: true, placeholder: 'Courts extérieurs' },
        { key: 'detail', label: 'Détail', type: 'text' },
        { key: 'image', label: 'Image', type: 'image' },
      ],
    },
    { kind: 'field', section: 'Bandeau d’appel final', key: 'cta_title', label: 'Titre', type: 'text', required: true },
    { kind: 'field', key: 'cta_text', label: 'Texte', type: 'longtext' },
    { kind: 'field', key: 'cta_button', label: 'Bouton', type: 'text', required: true },
  ],
};

const CONTACT: GroupSpec = {
  kind: 'fields',
  key: 'contact',
  label: 'Contact et coordonnées',
  hint: 'Adresse, téléphone et horaires d’accueil',
  items: [
    { kind: 'field', key: 'page_title', label: 'Titre de la page Contact', type: 'text', required: true },
    { kind: 'field', key: 'address_street', label: 'Rue', type: 'text', required: true },
    { kind: 'field', key: 'address_postal_code', label: 'Code postal', type: 'text', required: true },
    { kind: 'field', key: 'address_city', label: 'Ville', type: 'text', required: true },
    { kind: 'field', key: 'phone', label: 'Téléphone', type: 'tel', required: true, placeholder: '05 63 32 00 00' },
    {
      kind: 'field',
      key: 'email',
      label: 'E-mail public',
      type: 'email',
      required: true,
      help: 'Adresse affichée sur le site vitrine et destinataire de son formulaire de contact (PR9).',
    },
    { kind: 'field', key: 'maps_url', label: 'Lien Google Maps', type: 'url', placeholder: 'https://maps.google.com/…' },
    {
      kind: 'list',
      key: 'opening_hours',
      label: 'Horaires d’accueil',
      singular: 'horaire',
      fields: [
        { key: 'day', label: 'Jour', type: 'text', required: true, placeholder: 'Mardi' },
        { key: 'time', label: 'Horaire', type: 'text', required: true, placeholder: '17h30 – 22h00' },
      ],
    },
  ],
};

// Les trois groupes de PR6d sont les PAGES DE CONTENU : ils s'intercalent entre l'accueil et
// le contact, dans l'ordre du `web_site_brief.md` §5.
const CLUB: GroupSpec = {
  kind: 'fields',
  key: 'club',
  label: 'Le Club',
  hint: 'Président·e, encadrant, valeurs, programmes et bureau',
  items: [
    { kind: 'field', key: 'page_title', label: 'Titre de la page', type: 'text', required: true, placeholder: 'Le Club' },

    // Objet imbriqué : clés de formulaire PLATES, chemin réel dans `path`. Les sous-titres
    // `section` de PR6b suffisent à présenter l'objet à l'écran — pas de structure nouvelle.
    { kind: 'field', section: 'Le président·e', key: 'president_name', path: ['president', 'name'], label: 'Nom', type: 'text', required: true, placeholder: 'Prénom Nom' },
    { kind: 'field', key: 'president_role', path: ['president', 'role'], label: 'Fonction', type: 'text', required: true, placeholder: 'Présidente du club' },
    { kind: 'field', key: 'president_photo', path: ['president', 'photo'], label: 'Portrait', type: 'image', required: true },
    { kind: 'field', key: 'president_quote', path: ['president', 'quote'], label: 'Le mot du président·e', type: 'longtext', required: true },

    {
      kind: 'list',
      section: 'Valeurs du club',
      key: 'values',
      label: 'Valeurs',
      singular: 'valeur',
      scalar: true,
      help: 'Trois à quatre valeurs recommandées. Une liste vide masque simplement le bloc.',
      fields: [{ key: 'value', label: 'Valeur', type: 'text', required: true, placeholder: 'Convivialité' }],
    },

    { kind: 'field', section: 'L’encadrant', key: 'coach_name', path: ['coach', 'name'], label: 'Nom', type: 'text', required: true, placeholder: 'Prénom Nom' },
    { kind: 'field', key: 'coach_role', path: ['coach', 'role'], label: 'Fonction', type: 'text', required: true, placeholder: 'Directeur sportif' },
    {
      // L'item le plus composé de la PR : une liste de scalaires QUI VIT À UN CHEMIN.
      kind: 'list',
      key: 'coach_credentials',
      path: ['coach', 'credentials'],
      label: 'Diplômes et classement',
      singular: 'diplôme',
      scalar: true,
      fields: [{ key: 'value', label: 'Diplôme ou classement', type: 'text', required: true, placeholder: 'Diplômé d’État' }],
    },
    { kind: 'field', key: 'coach_bio', path: ['coach', 'bio'], label: 'Biographie et pédagogie', type: 'longtext', required: true },
    { kind: 'field', key: 'coach_photo', path: ['coach', 'photo'], label: 'Portrait', type: 'image', required: true },

    {
      kind: 'list',
      section: 'Enseignement',
      key: 'methods',
      label: 'Méthodes d’enseignement',
      singular: 'méthode',
      scalar: true,
      fields: [{ key: 'value', label: 'Méthode', type: 'text', required: true, placeholder: 'Pédagogie par le jeu' }],
    },
    {
      kind: 'list',
      key: 'levels',
      label: 'Niveaux proposés',
      singular: 'niveau',
      scalar: true,
      fields: [{ key: 'value', label: 'Niveau', type: 'text', required: true, placeholder: 'Débutant' }],
    },

    {
      kind: 'list',
      section: 'Programmes',
      key: 'programs',
      label: 'Programmes',
      singular: 'programme',
      fields: [
        { key: 'name', label: 'Nom', type: 'text', required: true, placeholder: 'École de tennis' },
        { key: 'age', label: 'Âge', type: 'text', placeholder: '4 – 17 ans' },
        { key: 'frequency', label: 'Fréquence', type: 'text', placeholder: '1h / semaine' },
        { key: 'description', label: 'Description', type: 'longtext' },
        { key: 'image', label: 'Image', type: 'image' },
      ],
    },

    {
      kind: 'list',
      section: 'Le bureau',
      key: 'board',
      label: 'Membres du bureau',
      singular: 'membre',
      fields: [
        { key: 'name', label: 'Nom', type: 'text', required: true, placeholder: 'Prénom Nom' },
        { key: 'role', label: 'Fonction', type: 'text', required: true, placeholder: 'Trésorier' },
        { key: 'photo', label: 'Portrait', type: 'image' },
      ],
    },
  ],
};

const INFRA: GroupSpec = {
  kind: 'fields',
  key: 'infra',
  label: 'Infrastructures',
  hint: 'Courts, club house et vestiaires',
  items: [
    { kind: 'field', key: 'page_title', label: 'Titre de la page', type: 'text', required: true, placeholder: 'Nos infrastructures' },

    {
      kind: 'list',
      section: 'Courts',
      key: 'courts',
      label: 'Courts',
      singular: 'court',
      help: 'Une entrée par type de surface plutôt qu’une par court.',
      fields: [
        { key: 'count', label: 'Nombre', type: 'text', required: true, placeholder: '4' },
        { key: 'label', label: 'Libellé', type: 'text', required: true, placeholder: 'Courts extérieurs' },
        { key: 'detail', label: 'Détail', type: 'text', placeholder: 'Béton poreux, éclairés' },
        { key: 'image', label: 'Image', type: 'image' },
      ],
    },

    { kind: 'field', section: 'Club house', key: 'clubhouse_title', path: ['clubhouse', 'title'], label: 'Titre', type: 'text' },
    { kind: 'field', key: 'clubhouse_text', path: ['clubhouse', 'text'], label: 'Description', type: 'longtext' },
    {
      // Liste de scalaires d'IMAGES, elle aussi à un chemin : les fichiers en attente s'y
      // indexent `clubhouse_images.0.value`, comme pour n'importe quelle autre liste.
      kind: 'list',
      key: 'clubhouse_images',
      path: ['clubhouse', 'images'],
      label: 'Photos',
      singular: 'photo',
      scalar: true,
      help: 'Deux photos recommandées.',
      fields: [{ key: 'value', label: 'Photo', type: 'image', required: true }],
    },

    { kind: 'field', section: 'Vestiaires', key: 'locker_rooms_title', path: ['locker_rooms', 'title'], label: 'Titre', type: 'text' },
    { kind: 'field', key: 'locker_rooms_text', path: ['locker_rooms', 'text'], label: 'Description', type: 'longtext' },
    { kind: 'field', key: 'locker_rooms_image', path: ['locker_rooms', 'image'], label: 'Photo', type: 'image' },
  ],
};

/** Le libellé d'aide des deux champs `price` NUMÉRIQUES — leur unité est fixe, la vitrine met
 *  le montant en forme elle-même. À ne pas confondre avec `other_fees[].price`, du texte. */
const AMOUNT_HELP =
  'En euros, chiffres seuls — « 210 ». Laissé vide, aucun tarif n’est affiché pour cette formule.';

const PRICING: GroupSpec = {
  kind: 'fields',
  key: 'pricing',
  label: 'Tarifs',
  hint: 'Adhésion, cours et autres frais',
  items: [
    { kind: 'field', key: 'page_title', label: 'Titre de la page', type: 'text', required: true, placeholder: 'Nos tarifs' },
    { kind: 'field', key: 'season', label: 'Saison', type: 'text', placeholder: '2025 / 2026' },
    { kind: 'field', key: 'note', label: 'Mention', type: 'text', placeholder: 'Licence FFT incluse' },

    {
      kind: 'list',
      section: 'Adhésion + cours',
      key: 'lessons',
      label: 'Formules avec cours',
      singular: 'formule',
      fields: [
        { key: 'name', label: 'Nom', type: 'text', required: true, placeholder: 'École de tennis' },
        { key: 'subtitle', label: 'Sous-titre', type: 'text' },
        { key: 'frequency', label: 'Fréquence', type: 'text', placeholder: '1h / semaine' },
        { key: 'price', label: 'Tarif', type: 'number', help: AMOUNT_HELP, placeholder: '210' },
        { key: 'eligibility', label: 'Public concerné', type: 'text', placeholder: 'De 4 à 17 ans' },
      ],
    },

    {
      kind: 'list',
      section: 'Adhésion seule',
      key: 'membership',
      label: 'Formules d’adhésion',
      singular: 'adhésion',
      fields: [
        { key: 'name', label: 'Nom', type: 'text', required: true, placeholder: 'Adulte' },
        { key: 'subtitle', label: 'Sous-titre', type: 'text' },
        { key: 'price', label: 'Tarif', type: 'number', help: AMOUNT_HELP, placeholder: '95' },
      ],
    },

    {
      kind: 'list',
      section: 'Autres frais',
      key: 'other_fees',
      label: 'Autres frais et prestations',
      singular: 'frais',
      fields: [
        { key: 'label', label: 'Libellé', type: 'text', required: true, placeholder: 'Location de court' },
        {
          // ⚠️ `text` et NON `number`, contrairement aux deux `price` ci-dessus : l'unité est
          // variable ici (web_site_brief §5.5). Ce n'est pas une incohérence à « corriger ».
          key: 'price',
          label: 'Tarif',
          type: 'text',
          help: 'Texte libre — « 15€ / h », « 8€ ». C’est le seul tarif dont l’unité est variable.',
          placeholder: '15€ / h',
        },
      ],
    },

    { kind: 'field', section: 'Bandeau d’inscription', key: 'cta_title', label: 'Titre', type: 'text' },
    { kind: 'field', key: 'cta_text', label: 'Texte', type: 'longtext' },
    { kind: 'field', key: 'cta_button', label: 'Bouton', type: 'text' },
  ],
};

// Les quatre groupes de PR6c sont le CHROME du site — pied de page, réseaux, bande
// partenaires, drapeaux d'affichage — et non des pages : ils viennent donc après les groupes
// de contenu ci-dessus.
const SOCIAL: GroupSpec = {
  kind: 'fields',
  key: 'social',
  label: 'Réseaux sociaux',
  hint: 'Liens affichés dans le pied de page du site vitrine',
  items: [
    // Deux champs nommés, et non la `list<{ platform, url }>` qu'évoque le brief §5.7 : une
    // liste générique se paierait en complexité côté vitrine pour un besoin qui n'existe pas.
    {
      kind: 'field',
      key: 'facebook_url',
      label: 'Page Facebook',
      type: 'url',
      placeholder: 'https://www.facebook.com/…',
      // Libellé honnête : la publication automatique des actus sur Facebook a ses propres
      // réglages (PR8), ce lien ne fait que s'afficher sur le site vitrine.
      help: 'Simple lien affiché sur le site vitrine. Sans effet sur la publication des actus sur Facebook.',
    },
    {
      kind: 'field',
      key: 'instagram_url',
      label: 'Compte Instagram',
      type: 'url',
      placeholder: 'https://www.instagram.com/…',
    },
  ],
};

const PARTNERS: GroupSpec = {
  kind: 'list',
  key: 'partners',
  label: 'Partenaires',
  hint: 'La bande « Ils soutiennent le club » du site vitrine',
  // La clé de la liste est celle du groupe : les chemins d'images en attente se lisent alors
  // `partners.0.logo`, comme `infra_teaser.1.image` pour une liste nichée dans un groupe.
  list: {
    key: 'partners',
    label: 'Partenaires',
    singular: 'partenaire',
    help: 'Le logo est obligatoire ; le nom et le lien sont facultatifs. Une liste vide masque simplement la bande.',
    fields: [
      { key: 'logo', label: 'Logo', type: 'image', required: true },
      { key: 'name', label: 'Nom', type: 'text', placeholder: 'Crédit Agricole' },
      { key: 'url', label: 'Site web', type: 'url', placeholder: 'https://…' },
    ],
  },
};

const LEGAL: GroupSpec = {
  kind: 'fields',
  key: 'legal',
  label: 'Mentions légales',
  hint: 'Pied de page et page « Mentions légales » du site vitrine',
  items: [
    {
      kind: 'field',
      key: 'publication_director',
      label: 'Directeur de la publication',
      type: 'text',
      placeholder: 'Prénom Nom',
      help: 'Habituellement le président du club. Apparaît sur le site vitrine uniquement.',
    },
    { kind: 'field', key: 'host_name', label: 'Hébergeur du site', type: 'text', placeholder: 'Vercel Inc.' },
    {
      kind: 'field',
      key: 'host_address',
      label: 'Adresse de l’hébergeur',
      type: 'text',
      help: 'Nom et adresse de l’hébergeur sont obligatoires dans les mentions légales d’un site public.',
    },
  ],
};

const SETTINGS: GroupSpec = {
  kind: 'fields',
  key: 'settings',
  label: 'Affichage des sections',
  hint: 'Blocs affichés ou masqués sur le site vitrine',
  items: [
    {
      kind: 'field',
      key: 'show_news',
      label: 'Afficher le bloc Actualités',
      type: 'bool',
      help: 'Décocher masque le bloc sur le site vitrine. Les actus restent publiées dans l’application des adhérents.',
    },
    {
      kind: 'field',
      key: 'show_events',
      label: 'Afficher le bloc Prochains rendez-vous',
      type: 'bool',
      help: 'Décocher masque l’agenda sur le site vitrine. Les événements restent visibles dans l’application des adhérents.',
    },
    {
      kind: 'field',
      key: 'show_partners',
      label: 'Afficher la bande Partenaires',
      type: 'bool',
      help: 'Le contenu se saisit dans le panneau « Partenaires » ci-dessus.',
    },
    {
      kind: 'field',
      key: 'show_stats',
      label: 'Afficher les chiffres clés',
      type: 'bool',
      help: 'Le contenu se saisit dans le panneau « Page d’accueil du site vitrine ».',
    },
  ],
};

/**
 * PR7 — le seul panneau qui ne concerne PAS le site vitrine : ces images sortent dans le
 * BACK-OFFICE, en fond des affiches qu'il génère. D'où sa place en DERNIER, après le chrome de
 * la vitrine : il ne s'intercale pas au milieu des panneaux qui, eux, alimentent le site.
 *
 * DEUX LISTES et non deux champs : un club a plusieurs fonds par affiche (été, tournoi, fin de
 * saison) et choisit au moment de générer. La forme est celle de `partners` ou `home.stats` —
 * une liste d'objets —, donc l'ajout, le retrait, le réordonnancement, l'upload différé, le
 * remap des fichiers en attente et la SUPPRESSION de l'objet Storage devenu orphelin viennent
 * sans une ligne de plus.
 *
 * Les deux champs d'une entrée sont ⬤, et le ⬤ BLOQUE ici (asymétrie de `fieldSchema` : au
 * niveau du groupe il est indicatif, dans une entrée de liste il refuse) — c'est exactement ce
 * qu'on veut : un fond sans image ne sert à rien, un fond sans nom est impossible à choisir
 * dans le sélecteur. La LISTE VIDE, elle, reste parfaitement valide : c'est l'état de tout club
 * au lendemain du déploiement. Ce sont les deux ÉCRANS qui refusent alors de générer.
 *
 * `singular` distingue les deux listes ('fond TMC' / 'fond rencontres') : elles cohabitent dans
 * le même panneau, et `formatIssue` s'en sert pour nommer l'entrée fautive.
 *
 * Le `help` porte les proportions ET les zones à laisser libres : c'est le code qui vient
 * écrire dedans, à des coordonnées figées (`ProgrammationImagePage`, `TeamMatchImagePreview`).
 */
const POSTERS: GroupSpec = {
  kind: 'fields',
  key: 'posters',
  label: 'Affiches',
  hint: 'Fonds des affiches générées depuis le back-office',
  items: [
    {
      kind: 'list',
      section: 'Affiche de programmation TMC',
      key: 'tmc_backgrounds',
      label: 'Fonds disponibles',
      singular: 'fond TMC',
      help: 'Format A4 portrait (ratio 0,71) — 794 × 1123 px au minimum, plus grand accepté. Repères donnés sur cette base : le titre et la date se surimpriment dans le haut (la date à 170 px) ; la grille des matchs occupe tout l’espace à partir de 305 px, avec 18 px de marge à gauche et à droite. Laissez ces zones libres. Sans aucun fond, l’affiche ne peut pas être générée.',
      fields: [
        { key: 'name', label: 'Nom', type: 'text', required: true, help: 'Ce que vous lirez au moment de choisir.', placeholder: 'Tournoi de la Pentecôte' },
        { key: 'image', label: 'Image', type: 'image', required: true, dimensions: { width: 794, height: 1123 } },
      ],
    },
    {
      kind: 'list',
      section: 'Affiche des rencontres par équipes',
      key: 'team_match_backgrounds',
      label: 'Fonds disponibles',
      singular: 'fond rencontres',
      help: 'Format A4 portrait (ratio 0,71) — 1414 × 2000 px au minimum, plus grand accepté. Repères donnés sur cette base : les rencontres s’écrivent de 245 px à 1780 px, avec 60 px de marge à gauche et à droite. Laissez cette zone libre. Sans aucun fond, l’affiche ne peut pas être générée.',
      fields: [
        { key: 'name', label: 'Nom', type: 'text', required: true, help: 'Ce que vous lirez au moment de choisir.', placeholder: 'Saison 2026-2027' },
        { key: 'image', label: 'Image', type: 'image', required: true, dimensions: { width: 1414, height: 2000 } },
      ],
    },
  ],
};

/** Ordre des panneaux à l'écran — celui du `web_site_brief.md` §5 : identité, puis les pages
 *  (accueil, club, infrastructures, tarifs, contact), puis le chrome. */
export const CLUB_CONFIG_GROUPS: GroupSpec[] = [
  BRAND,
  HOME,
  CLUB,
  INFRA,
  PRICING,
  CONTACT,
  SOCIAL,
  PARTNERS,
  LEGAL,
  SETTINGS,
  // En dernier, à part : le seul groupe qui ne sort pas sur la vitrine (PR7).
  POSTERS,
];

// ── Schéma strict ────────────────────────────────────────────────────────────

export type ListEntry = Record<string, string>;
/** Le booléen est le seul type d'état de formulaire qui ne soit pas une chaîne — il ne
 *  descend PAS dans les entrées de liste, aucun `bool` n'y figurant au contrat.
 *
 *  ⚠️ Ces deux types décrivent l'état SAISI. La SORTIE de `validateClubConfigGroup` réemprunte
 *  `GroupValue` par commodité alors qu'elle porte aussi des nombres et des `undefined` (les
 *  montants de PR6d) — le panneau la range telle quelle dans son état, ce qu'un `<input>`
 *  contrôlé accepte. C'est la seule entorse, et elle s'arrête à `configFromGroupValue`. */
export type GroupValue = Record<string, string | boolean | ListEntry[]>;

// `image` n'a volontairement PAS de contrôle de format : la valeur est produite par
// `getPublicUrl()`, et le contrat de lecture la décrit comme « clé Storage OU URL publique ».
// Lui imposer une forme d'URL refuserait une clé Storage parfaitement valide.
const FORMATS: Partial<Record<FieldType, { test: (v: string) => boolean; message: string }>> = {
  email: { test: (v) => z.email().safeParse(v).success, message: 'n’est pas une adresse e-mail valide' },
  url: { test: (v) => z.url().safeParse(v).success, message: 'n’est pas une adresse web valide (elle doit commencer par https://)' },
  tel: { test: (v) => /^[+0-9][0-9 .\-()]{5,}$/.test(v), message: 'n’est pas un numéro de téléphone valide' },
  color: { test: (v) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v), message: 'n’est pas une couleur hexadécimale (ex. #C8102E)' },
};

/**
 * `insideList` porte toute l'asymétrie de la validation :
 *   - au niveau du GROUPE, un champ vide est accepté même marqué ⬤ (brief §5 : ne pas
 *     empêcher d'enregistrer une saisie en cours) ;
 *   - dans une ENTRÉE de liste, un champ ⬤ vide est refusé — une entrée n'existe que parce
 *     que quelqu'un l'a ajoutée, et c'est exactement l'entrée à demi remplie qui coûte la
 *     liste entière à la relecture (`clubConfig.ts`, `.catch([])`).
 */
function fieldSchema(spec: FieldSpec, insideList: boolean) {
  const format = FORMATS[spec.type];
  return z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v !== '' || !(insideList && spec.required), 'est obligatoire')
    .refine((v) => v === '' || !format || format.test(v), format?.message ?? 'est invalide');
}

/** Un drapeau n'a ni trim, ni format, ni « vide » : le faire transiter par `fieldSchema`
 *  écrirait la CHAÎNE `'false'` dans le JSONB — non vide, donc vraie pour la vitrine. */
const boolSchema = z.boolean({ error: 'doit être coché ou décoché' });

/**
 * Un MONTANT — sa propre branche, comme `boolSchema`, et pour la même raison : le faire
 * transiter par le tuyau des chaînes écrirait `"120"` dans le JSONB, une régression silencieuse
 * pour la vitrine, qui attend un nombre (`clubConfig.ts`, helper `amount`).
 *
 * VIDE ≠ ZÉRO : une saisie vide rend `undefined`, et la clé est OMISE à l'écriture
 * (`listForConfig`) plutôt qu'écrite à `0` — un tarif non renseigné n'est pas la gratuité.
 *
 * Le schéma doit être IDEMPOTENT : `saveClubConfigGroup` revalide la valeur que le panneau lui
 * repasse, et celle-ci est déjà passée une fois par ici. Il accepte donc en entrée aussi bien
 * la saisie (`'210'`) que sa propre sortie — le nombre `210`, et l'`undefined` d'un montant
 * laissé vide, qu'un `z.string()` seul refuserait au second tour. C'est ce qui rend `boolSchema`
 * sûr depuis PR6c, appliqué à un type dont l'entrée et la sortie diffèrent.
 */
function amountSchema(spec: FieldSpec, insideList: boolean) {
  return z
    .union([z.string(), z.number(), z.undefined()], { error: 'n’est pas un montant valide' })
    // Absent et vide sont le MÊME cas — il n'y a pas de « montant effacé » distinct d'un
    // montant jamais saisi.
    .transform((v) => (v === undefined ? '' : typeof v === 'number' ? v : v.trim()))
    .refine((v) => v !== '' || !(insideList && spec.required), 'est obligatoire')
    .refine(
      (v) => typeof v === 'number' || v === '' || Number.isFinite(Number(v)),
      'n’est pas un montant valide',
    )
    .transform((v) => (typeof v === 'number' ? v : v === '' ? undefined : Number(v)));
}

/** Le schéma d'un champ, quel que soit son type. `insideList` porte l'asymétrie du ⬤. */
function itemFieldSchema(spec: FieldSpec, insideList: boolean): z.ZodType {
  if (spec.type === 'bool') return boolSchema;
  if (spec.type === 'number') return amountSchema(spec, insideList);
  return fieldSchema(spec, insideList);
}

function groupSchema(group: GroupSpec) {
  const shape: Record<string, z.ZodType> = {};
  for (const item of itemsOf(group)) {
    shape[item.key] =
      item.kind === 'list'
        ? z.array(
            z.object(Object.fromEntries(item.fields.map((f) => [f.key, itemFieldSchema(f, true)]))),
          )
        : itemFieldSchema(item, false);
  }
  return z.object(shape);
}

function ordinal(n: number): string {
  return n === 1 ? '1ʳᵉ' : `${n}ᵉ`;
}

/** « 2ᵉ horaire — « Jour » est obligatoire. » plutôt qu'un « formulaire invalide » global. */
function formatIssue(group: GroupSpec, issue: { path: PropertyKey[]; message: string }): string {
  const [head, index, leaf] = issue.path;
  const item = itemsOf(group).find((i) => i.key === head);

  if (item?.kind === 'list' && typeof index === 'number') {
    const field = item.fields.find((f) => f.key === leaf);
    return `${ordinal(index + 1)} ${item.singular} — « ${field?.label ?? String(leaf)} » ${issue.message}.`;
  }
  return `« ${item?.label ?? String(head)} » ${issue.message}.`;
}

export type ValidationResult =
  | { valid: true; value: GroupValue }
  | { valid: false; errors: string[] };

/** Exposée à part pour valider AVANT d'uploader : inutile d'envoyer une image au Storage
 *  pour un panneau que l'écriture refusera. */
export function validateClubConfigGroup(group: GroupSpec, value: GroupValue): ValidationResult {
  const parsed = groupSchema(group).safeParse(value);
  if (parsed.success) return { valid: true, value: parsed.data as GroupValue };
  return { valid: false, errors: parsed.error.issues.map((issue) => formatIssue(group, issue)) };
}

// ── Lecture → état de formulaire ─────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Un montant vient du JSONB en NOMBRE et l'état de formulaire est fait de chaînes (c'est un
 *  `<input>`). Sans cette conversion, un tarif enregistré se relirait vide. */
function asAmount(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

function asFormValue(spec: FieldSpec, raw: unknown): string {
  return spec.type === 'number' ? asAmount(raw) : asText(raw);
}

/** Lit la valeur au chemin réel du JSONB — `['president', 'photo']`. */
function readAt(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (!isPlainObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Projette la config lue sur les seules clés de la spec, en texte : l'état du formulaire est
 *  entièrement fait de chaînes — images (URL) et couleur (hex) comprises —, à la seule
 *  exception des drapeaux, qui restent des booléens (§`boolSchema`). */
export function groupValueFromConfig(group: GroupSpec, config: ClubConfig): GroupValue {
  const raw = config[group.key];
  // Premier des deux seuls points qui connaissent la forme du groupe : la liste à la racine
  // est remise sous la clé de sa liste, et tout ce qui suit ignore la différence.
  const source: Record<string, unknown> =
    group.kind === 'list'
      ? { [group.list.key]: raw }
      : isPlainObject(raw)
        ? (raw as Record<string, unknown>)
        : {};
  const value: GroupValue = {};
  for (const item of itemsOf(group)) {
    // Le `path` d'un objet imbriqué ne va pas plus loin qu'ici : la clé de l'état reste plate.
    const raw = readAt(source, pathOf(item));
    if (item.kind === 'list') {
      const entries = Array.isArray(raw) ? raw : [];
      value[item.key] = item.scalar
        ? // Une liste de scalaires est EMBALLÉE dans des entrées à une clé, le temps du
          // formulaire : c'est ce qui lui donne l'ajout, le retrait et le réordonnancement de
          // n'importe quelle autre liste, sans une ligne de rendu de plus.
          entries.map((entry) => ({ [item.fields[0].key]: asFormValue(item.fields[0], entry) }))
        : entries.map((entry) => {
            const row = isPlainObject(entry) ? entry : {};
            return Object.fromEntries(
              item.fields.map((f) => [f.key, asFormValue(f, row[f.key])]),
            ) as ListEntry;
          });
    } else if (item.type === 'bool') {
      // L'ABSENCE VAUT `true` (web_site_brief §5.10, helper `flag` du schéma de lecture) : un
      // club qui n'a jamais ouvert cet écran doit voir ses quatre cases cochées.
      value[item.key] = typeof raw === 'boolean' ? raw : true;
    } else {
      value[item.key] = asFormValue(item, raw);
    }
  }
  return value;
}

// ── Écriture ─────────────────────────────────────────────────────────────────

/**
 * Fusion PROFONDE du groupe édité avec ce qui était en base.
 *
 * `parseClubConfig` ne fusionne qu'à la RACINE (`{ ...source, ...parsed }`) : les clés
 * inconnues d'un groupe connu n'y survivent pas. Sans cette fusion, un BO qui ignore encore
 * `brand.motto` (posée par PR6c ou PR9) l'effacerait en enregistrant « Identité », sans que
 * personne ne le voie.
 *
 * Une LISTE est en revanche remplacée en bloc : retirer ou réordonner une entrée doit rester
 * possible, et fusionner par index serait faux dès le premier réordonnancement. Contrepartie
 * assumée : une clé inconnue nichée DANS une entrée de liste ne survit pas — la préserver
 * demanderait un identifiant d'entrée que le contrat n'a pas.
 */
/**
 * Une liste TELLE QUE LE JSONB LA PORTE, à partir des `ListEntry` du formulaire.
 *
 * Deux déballages, et deux seulement :
 *   - une liste `scalar` rend ses valeurs simples — `["Respect", "Convivialité"]` et non
 *     `[{ value: 'Respect' }, …]`. Stocker l'emballage ferait diverger le JSONB de sa spec,
 *     ce que la décision `partners` de PR6c a déjà refusé une fois ;
 *   - une clé à `undefined` est OMISE — c'est ce que rend `amountSchema` pour un montant vide,
 *     et « pas de tarif » ne doit devenir ni `0`, ni `null`.
 */
function listForConfig(list: ListSpec, raw: unknown): unknown[] {
  const entries = (Array.isArray(raw) ? raw : []) as Record<string, unknown>[];
  if (list.scalar) return entries.map((entry) => entry[list.fields[0].key] ?? '');
  return entries.map((entry) =>
    Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)),
  );
}

function setAt(target: Record<string, unknown>, path: string[], value: unknown) {
  let current = target;
  for (const segment of path.slice(0, -1)) {
    if (!isPlainObject(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

/**
 * Reconstruit la forme RÉELLE du groupe dans le JSONB à partir de l'état PLAT du formulaire :
 * chaque item est posé à son `path`, et les listes passent par `listForConfig`.
 *
 * Second des deux seuls points qui connaissent la forme du groupe, avec `groupValueFromConfig`
 * — c'est ce qui laisse `groupSchema`, `formatIssue`, `setAtPath` et tout le panneau l'ignorer.
 * `mergeGroup` reçoit alors un objet DÉJÀ niché, et sa fusion profonde préexistante suffit :
 * poser `club.president.twitter` à la main survit à un enregistrement du panneau.
 */
function configFromGroupValue(group: GroupSpec, value: GroupValue): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of itemsOf(group)) {
    setAt(
      out,
      pathOf(item),
      item.kind === 'list' ? listForConfig(item, value[item.key]) : value[item.key],
    );
  }
  return out;
}

function mergeGroup(previous: unknown, next: Record<string, unknown>): Record<string, unknown> {
  const base = isPlainObject(previous) ? previous : {};
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(next)) {
    const existing = base[key];
    merged[key] =
      isPlainObject(existing) && isPlainObject(value) ? mergeGroup(existing, value) : value;
  }
  return merged;
}

export type SaveResult = { success: true } | { success: false; errors: string[] };

/**
 * Enregistre UN groupe. Un groupe à la fois, jamais l'arbre entier : deux onglets ouverts sur
 * deux panneaux différents ne s'écrasent alors plus l'un l'autre, et une erreur de validation
 * sur un groupe ne bloque pas les autres.
 */
export async function saveClubConfigGroup(
  clubId: string | null,
  group: GroupSpec,
  value: GroupValue,
): Promise<SaveResult> {
  if (!clubId) return { success: false, errors: ['Club introuvable — enregistrement impossible.'] };

  const validated = validateClubConfigGroup(group, value);
  if (!validated.valid) return { success: false, errors: validated.errors };

  // 1. Relire la ligne BRUTE — surtout pas l'objet rendu par `useClubConfig()`, déjà passé
  //    par le schéma permissif : une liste qu'il a ramenée à `[]` serait réécrite vide, et la
  //    donnée d'origine perdue pour de bon.
  const { data, error: readError } = await supabase
    .from('club_settings')
    .select('config')
    .eq('club_id', clubId)
    .maybeSingle();
  if (readError) {
    return { success: false, errors: [`Lecture de la configuration impossible : ${readError.message}`] };
  }

  const raw = isPlainObject(data?.config) ? data.config : {};
  // Second point qui connaît la forme du groupe. Un groupe-liste est remplacé EN BLOC : c'est
  // déjà la règle des listes (cf. `mergeGroup`), et `mergeGroup` ne saurait de toute façon pas
  // fusionner un tableau — `Object.entries` en ferait un objet indexé par position.
  const next = {
    ...raw,
    version: CLUB_CONFIG_VERSION,
    [group.key]:
      group.kind === 'list'
        ? listForConfig(group.list, validated.value[group.list.key])
        : mergeGroup(raw[group.key], configFromGroupValue(group, validated.value)),
  };

  // 2. UPDATE, jamais `upsert` : l'INSERT est réservé au super-admin
  //    (`club_settings_insert_super_admin`, PR5) et la ligne existe toujours — le trigger
  //    `clubs_create_settings` la crée avec le club. Un upsert échouerait ici.
  //
  //    Le `.select()` n'est pas décoratif : une écriture refusée par la RLS ne remonte AUCUNE
  //    erreur, elle ne touche simplement aucune ligne. Sans compter les lignes rendues, un
  //    `manager` — ou le club voisin — verrait « enregistré ».
  const { data: updated, error: writeError } = await supabase
    .from('club_settings')
    .update({ config: next })
    .eq('club_id', clubId)
    .select('club_id');
  if (writeError) {
    return { success: false, errors: [`Enregistrement impossible : ${writeError.message}`] };
  }
  if (!updated || updated.length === 0) {
    return {
      success: false,
      errors: ['Enregistrement refusé : seul un administrateur de ce club peut modifier sa configuration.'],
    };
  }
  return { success: true };
}
