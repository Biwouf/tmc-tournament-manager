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
// Périmètre : `brand`, `home`, `contact` — les trois groupes du contrat posé en PR6a. Les
// sept autres (`club`, `infra`, `pricing`, `social`, `partners`, `legal`, `settings`)
// arrivent en PR6c, avec l'extension de `clubConfig.ts` qu'ils impliquent. Ce fichier ne
// touche pas au schéma de lecture.
import { z } from 'zod';
import { supabase } from './supabase';
import { CLUB_CONFIG_VERSION, type ClubConfig } from './clubConfig';

// ── Specs ────────────────────────────────────────────────────────────────────

/** Types de la table du `web_site_brief.md` §5 présents dans ces trois groupes.
 *  `number` et `bool` n'apparaissent que dans `pricing.*` et `settings.*` — PR6c. */
export type FieldType = 'text' | 'longtext' | 'image' | 'color' | 'url' | 'email' | 'tel';

export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  /** Le ⬤ du brief §5. SIGNALÉ à l'écran, mais NON bloquant au niveau du groupe : un club en
   *  cours de saisie est le cas nominal, au même titre que `config = '{}'`. Dans une ENTRÉE
   *  de liste, en revanche, il bloque — cf. `fieldSchema`. */
  required?: boolean;
  help?: string;
  placeholder?: string;
};

export type ListSpec = {
  key: string;
  label: string;
  /** Au singulier et sans article : sert à nommer l'entrée fautive (« 2ᵉ horaire : … »). */
  singular: string;
  help?: string;
  fields: FieldSpec[];
};

/** Un panneau est une suite ORDONNÉE de champs et de listes : le brief §5 les entrelace
 *  (hero, puis chiffres clés, puis teaser école…), et les séparer casserait l'ordre de
 *  lecture. `section` ouvre un sous-titre quand elle change. */
export type ItemSpec =
  | ({ kind: 'field'; section?: string } & FieldSpec)
  | ({ kind: 'list'; section?: string } & ListSpec);

export type ClubConfigGroupKey = 'brand' | 'home' | 'contact';

export type GroupSpec = {
  key: ClubConfigGroupKey;
  label: string;
  hint: string;
  items: ItemSpec[];
};

// L'ordre des clés suit celui de `clubConfig.ts`, pour que les deux fichiers se relisent
// en vis-à-vis.
const BRAND: GroupSpec = {
  key: 'brand',
  label: 'Identité du club',
  hint: 'Nom, logos et couleur du site vitrine',
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
      key: 'color',
      label: 'Couleur d’accent du site vitrine',
      type: 'color',
      required: true,
      // Libellé honnête (brief §5) : cette clé n'est consommée par RIEN aujourd'hui. Le BO et
      // la PWA gardent leur couleur en dur jusqu'à PR7-bis, et le site vitrine n'existe pas
      // avant PR9. Ne pas laisser croire à un thème qui s'appliquerait ici.
      help: 'Utilisée par le futur site vitrine uniquement. Ne change ni les couleurs de ce back-office, ni celles de l’application des adhérents.',
      placeholder: '#C8102E',
    },
    { kind: 'field', key: 'legal_form', label: 'Forme juridique', type: 'text', placeholder: 'Association loi 1901' },
    { kind: 'field', key: 'copyright', label: 'Mention de copyright', type: 'text', help: 'Laissée vide : « © {année} {nom du club} ».' },
  ],
};

const HOME: GroupSpec = {
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

export const CLUB_CONFIG_GROUPS: GroupSpec[] = [BRAND, HOME, CONTACT];

// ── Schéma strict ────────────────────────────────────────────────────────────

export type ListEntry = Record<string, string>;
export type GroupValue = Record<string, string | ListEntry[]>;

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

function groupSchema(group: GroupSpec) {
  const shape: Record<string, z.ZodType> = {};
  for (const item of group.items) {
    shape[item.key] =
      item.kind === 'list'
        ? z.array(z.object(Object.fromEntries(item.fields.map((f) => [f.key, fieldSchema(f, true)]))))
        : fieldSchema(item, false);
  }
  return z.object(shape);
}

function ordinal(n: number): string {
  return n === 1 ? '1ʳᵉ' : `${n}ᵉ`;
}

/** « 2ᵉ horaire — « Jour » est obligatoire. » plutôt qu'un « formulaire invalide » global. */
function formatIssue(group: GroupSpec, issue: { path: PropertyKey[]; message: string }): string {
  const [head, index, leaf] = issue.path;
  const item = group.items.find((i) => i.key === head);

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

/** Projette la config lue sur les seules clés de la spec, en texte : l'état du formulaire est
 *  entièrement fait de chaînes, y compris pour les images (URL) et la couleur (hex). */
export function groupValueFromConfig(group: GroupSpec, config: ClubConfig): GroupValue {
  const source = isPlainObject(config[group.key]) ? (config[group.key] as Record<string, unknown>) : {};
  const value: GroupValue = {};
  for (const item of group.items) {
    if (item.kind === 'list') {
      const entries = Array.isArray(source[item.key]) ? (source[item.key] as unknown[]) : [];
      value[item.key] = entries.map((entry) => {
        const row = isPlainObject(entry) ? entry : {};
        return Object.fromEntries(item.fields.map((f) => [f.key, asText(row[f.key])])) as ListEntry;
      });
    } else {
      value[item.key] = asText(source[item.key]);
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
  const next = {
    ...raw,
    version: CLUB_CONFIG_VERSION,
    [group.key]: mergeGroup(raw[group.key], validated.value),
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
