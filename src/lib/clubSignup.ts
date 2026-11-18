// SaaS S3 — logique du tunnel d'inscription `admin.feelike.pro/inscription`, sans React.
// Spec : docs/specs/SAAS_ONBOARDING.md §7. Seul point d'écriture : l'Edge Function
// `club-signup` (S2) ; les règles du slug viennent de `shared/clubSlug.mjs`, jamais d'ici.
import { signupSlugProblem } from '../../shared/clubSlug.mjs';
import { BRAND_FALLBACK } from '../../shared/brandTokens.mjs';
import { normalizeTenupClubProfileUrl } from '../../shared/tenupSite.mjs';

export { BRAND_FALLBACK };

// ── Configuration ────────────────────────────────────────────────────────────

/** Clé de site Cloudflare « passe toujours » : jamais servie hors du serveur de dev. */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

export type SignupConfig = { siteKey: string; termsUrl: string; privacyUrl: string; open: boolean };

/**
 * Clé Turnstile et pages juridiques. Le tunnel n'est OUVERT que si les trois sont fournies
 * (décision du 29/10/2026 : pas d'ouverture publique tant que les CGU et la politique de
 * confidentialité n'existent pas). Le serveur de dev a des valeurs de test.
 */
export function signupConfig(env: Record<string, unknown>): SignupConfig {
  const dev = env.DEV === true;
  const value = (key: string, devDefault: string) => String(env[key] || '').trim() || (dev ? devDefault : '');
  const siteKey = value('VITE_TURNSTILE_SITE_KEY', TURNSTILE_TEST_SITE_KEY);
  const termsUrl = value('VITE_SIGNUP_TERMS_URL', 'https://www.feelike.pro/cgu');
  const privacyUrl = value('VITE_SIGNUP_PRIVACY_URL', 'https://www.feelike.pro/confidentialite');
  return { siteKey, termsUrl, privacyUrl, open: Boolean(siteKey && termsUrl && privacyUrl) };
}

// ── Nom, slug, initiales ─────────────────────────────────────────────────────

/** Mots vides retirés du slug proposé (maquette `Onboarding.dc.html`). */
const STOP_WORDS = ['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et'];

const ascii = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** « Tennis Club de Saint-Aubin » → `tennis-club-saint-aubin` (32 caractères au plus). */
export function slugify(name: string): string {
  return ascii(name).split(/[^a-z0-9]+/).filter(word => word && !STOP_WORDS.includes(word))
    .join('-').slice(0, 32).replace(/-+$/, '');
}

/** Frappe dans le champ adresse : minuscules, sans accents, espaces en tirets. La validité
 *  (bords, longueur, réservés) reste celle de `signupSlugProblem`. */
export function cleanSlugInput(value: string): string {
  return ascii(value).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 32);
}

/** Proposition quand l'adresse est prise : `slug-ville`, si elle est valide et différente. */
export function suggestSlug(slug: string, city: string): string | null {
  const town = slugify(city);
  if (!town || slug.endsWith(`-${town}`)) return null;
  const candidate = `${slug}-${town}`.slice(0, 32).replace(/-+$/, '');
  return candidate !== slug && !signupSlugProblem(candidate) ? candidate : null;
}

export type SlugCheck =
  | { state: 'idle' | 'checking' | 'available' | 'error' }
  | { state: 'unavailable'; reason: 'format' | 'reserved' | 'taken' };

export function slugMessage(check: SlugCheck): string {
  switch (check.state) {
    case 'idle': return '';
    case 'checking': return 'Vérification…';
    case 'available': return '✓ Adresse disponible';
    case 'error': return 'Vérification impossible pour le moment. Vous pourrez continuer, l’adresse sera revérifiée à la création.';
    case 'unavailable':
      if (check.reason === 'taken') return '✕ Cette adresse est déjà prise.';
      if (check.reason === 'reserved') return '✕ Cette adresse est réservée à la plateforme.';
      return '✕ Lettres minuscules, chiffres et tirets, de 3 à 32 caractères, sans tiret au début ni à la fin.';
  }
}

export const isEmail = (value: string) => value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

/** Ce qui manque à l'envoi d'une étape : le champ (message affiché dessous, focus) et le texte. */
export type FieldProblem = { field: 'name' | 'city' | 'email' | 'consent' | 'turnstile'; message: string };

/** Étape 1 (P0) : bouton jamais grisé ; le premier manque, dans l'ordre de l'écran. */
export function clubProblem({ name, city }: { name: string; city: string }): FieldProblem | null {
  if (!name.trim()) return { field: 'name', message: 'Indiquez le nom du club.' };
  if (name.trim().length < 2) return { field: 'name', message: 'Le nom du club compte au moins 2 caractères.' };
  if (!city.trim()) return { field: 'city', message: 'Indiquez la ville du club.' };
  return null;
}

/**
 * Étape 4 (P0) : le bouton n'est jamais grisé. À l'envoi, la première chose qui manque, dans
 * l'ordre de l'écran ; null si tout y est. Rien ne part au serveur tant qu'il en reste une.
 */
export function accountProblem({ email, consent, token }: { email: string; consent: boolean; token: string | null }): FieldProblem | null {
  if (!email.trim()) return { field: 'email', message: 'Indiquez votre e-mail.' };
  if (!isEmail(email)) return { field: 'email', message: 'Cette adresse e-mail semble incomplète. Vérifiez-la.' };
  if (!consent) return { field: 'consent', message: 'Cochez l’acceptation des CGU.' };
  if (!token) return { field: 'turnstile', message: 'La vérification anti-robot n’est pas terminée. Patientez quelques secondes, puis réessayez.' };
  return null;
}

// ── Couleur ──────────────────────────────────────────────────────────────────

/** Échantillons proposés sans logo (maquette) : la première teinte devient la couleur. */
export const COLOR_SAMPLES = [
  { label: 'Rouge', colors: ['#c8102e', '#2a201f', '#f4f2ea'] },
  { label: 'Vert', colors: ['#1f6b4a', '#e8c547', '#f4f2ea'] },
  { label: 'Bleu marine', colors: ['#1d3f8f', '#e2493b', '#eef1f7'] },
] as const;

const toHex = (channels: number[]) => '#' + channels.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/**
 * Jusqu'à 4 teintes dominantes d'une image RGBA (logo réduit à 48 × 48), de la plus présente
 * à la moins présente, saturation favorisée. Pixels transparents, quasi blancs et quasi noirs
 * ignorés ; deux teintes trop proches (distance RGB ≤ 70) n'en font qu'une.
 */
export function extractPalette(data: ArrayLike<number>): string[] {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number; s: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if ((max > 235 && min > 220) || max < 22) continue;
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, s: 0 };
    bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b; bucket.s += max ? (max - min) / max : 0;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .map(e => ({ c: [e.r / e.n, e.g / e.n, e.b / e.n], w: e.n * (0.35 + e.s / e.n) }))
    .sort((a, b) => b.w - a.w);
  const out: number[][] = [];
  for (const { c } of ranked) {
    if (out.every(o => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) > 70)) out.push(c);
    if (out.length === 4) break;
  }
  return out.map(toHex);
}

// ── Ten'Up d'abord (brief SAAS_11, P1-front) ─────────────────────────────────

/** Réponse de `tenup-lookup` pour un club libre (SAAS_ONBOARDING.md §14.2). */
export type LookupResult = {
  tenup_club_id: string;
  /** Tel quel Ten'Up (« MOISSAC TENNIS CLUB ») : le tunnel affiche `formatClubName`. */
  name: string;
  street?: string; postal_code?: string; city?: string;
  sports: string[];
  courts?: number;
  logo_url?: string; banner_url?: string;
  cached: boolean;
  read_at: string;
  lookup_token: string;
};

/** Écran 01, à l'envoi : lien vide ou hors Ten'Up → message sous le champ (aucune requête). */
export function findProblem(value: string): string | null {
  if (!value.trim()) return 'Collez le lien de votre club.';
  try { normalizeTenupClubProfileUrl(value); return null; } catch (error) { return (error as Error).message; }
}

export type LookupOutcome =
  | { kind: 'found'; result: LookupResult }
  | { kind: 'already'; tenupClubId: string; name: string | null }
  | { kind: 'bad_link' | 'not_found' | 'unavailable' | 'throttled' | 'turnstile' | 'offline' | 'error'; message: string };

export const LOOKUP_MESSAGES = {
  not_found: 'Nous ne trouvons pas ce club sur Ten’Up. Vérifiez le lien, ou saisissez votre club à la main.',
  unavailable: 'Ten’Up ne répond pas pour le moment. Vous pouvez réessayer, ou continuer à la main : vous pourrez importer vos équipes plus tard.',
  throttled: 'Trop de recherches depuis votre connexion. Réessayez dans quelques minutes, ou continuez à la main.',
  turnstile: 'La vérification anti-robot a échoué. Rechargez la page : votre saisie est conservée.',
  offline: 'Pas de connexion internet. Vérifiez votre réseau puis réessayez.',
  error: 'La recherche est momentanément indisponible. Réessayez, ou continuez à la main.',
} as const;

const https = (value: unknown) => (typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value) && value.length <= 1000 ? value : undefined);
const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);

/** Lecture tolérante d'un `LookupResult` (réponse réseau ou brouillon) : null s'il est inutilisable. */
export function parseLookupResult(raw: unknown): LookupResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.tenup_club_id === 'string' && /^[0-9]{1,12}$/.test(r.tenup_club_id) ? r.tenup_club_id : null;
  const name = text(r.name, 160);
  const token = text(r.lookup_token, 2000);
  const readAt = typeof r.read_at === 'string' && !Number.isNaN(Date.parse(r.read_at)) ? r.read_at : null;
  if (!id || !name || !token || !readAt) return null;
  const courts = Number.isInteger(r.courts) && (r.courts as number) > 0 && (r.courts as number) < 1000 ? r.courts as number : undefined;
  const result: LookupResult = {
    tenup_club_id: id, name,
    sports: Array.isArray(r.sports) ? r.sports.map(s => text(s, 60)).filter((s): s is string => Boolean(s)).slice(0, 10) : [],
    cached: r.cached === true, read_at: readAt, lookup_token: token,
  };
  const optional = { street: text(r.street, 200), postal_code: text(r.postal_code, 20), city: text(r.city, 80), courts, logo_url: https(r.logo_url), banner_url: https(r.banner_url) };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) Object.assign(result, { [key]: value });
  return result;
}

/** Un code de `tenup-lookup` → la suite de l'écran 01 (brief §3.1, états). */
export function lookupOutcome(status: number | 'offline' | 'network', body?: Record<string, unknown>): LookupOutcome {
  if (status === 'offline') return { kind: 'offline', message: LOOKUP_MESSAGES.offline };
  if (status === 200 && body?.already_on_feelike === true && typeof body.tenup_club_id === 'string') {
    return { kind: 'already', tenupClubId: body.tenup_club_id, name: text(body.name, 160) ?? null };
  }
  if (status === 200) {
    const result = parseLookupResult(body);
    return result ? { kind: 'found', result } : { kind: 'error', message: LOOKUP_MESSAGES.error };
  }
  switch (status) {
    case 400: return body?.reason === 'bad_link' && typeof body.error === 'string'
      ? { kind: 'bad_link', message: body.error } : { kind: 'error', message: LOOKUP_MESSAGES.error };
    case 403: return { kind: 'turnstile', message: LOOKUP_MESSAGES.turnstile };
    case 404: return { kind: 'not_found', message: LOOKUP_MESSAGES.not_found };
    case 429: return { kind: 'throttled', message: LOOKUP_MESSAGES.throttled };
    // Délai dépassé, file Queue-it, worker occupé : réponse 504 de l'Edge, ou rien du tout.
    case 'network': case 502: case 504: return { kind: 'unavailable', message: LOOKUP_MESSAGES.unavailable };
    default: return { kind: 'error', message: LOOKUP_MESSAGES.error };
  }
}

/** Au-delà, le navigateur abandonne : l'Edge coupe le worker à 10 s, le reste est du réseau. */
const LOOKUP_TIMEOUT_MS = 25_000;

export async function lookupTenupClub(
  fetcher: typeof fetch, endpoint: string, url: string, turnstileToken: string, online = true,
): Promise<LookupOutcome> {
  if (!online) return lookupOutcome('offline');
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim(), turnstile_token: turnstileToken }),
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch { return lookupOutcome('network'); }
  const body = await response.json().catch(() => undefined);
  return lookupOutcome(response.status, body);
}

/** Adresse de la carte : « Avenue du Sarlac, 82200 Moissac » (ville déjà mise en forme). */
export function clubAddress(street: string | undefined, postalCode: string | undefined, city: string): string {
  return [street, [postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

/** Source de la carte : « lues à l'instant », ou la date de la lecture servie par le cache. */
export function lookupSource(result: Pick<LookupResult, 'cached' | 'read_at'>): string {
  if (!result.cached) return 'Infos publiques Ten’Up, lues à l’instant';
  const date = new Date(result.read_at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `Infos publiques Ten’Up, lues le ${two(date.getDate())}/${two(date.getMonth() + 1)}`;
}

/** « Moissac Tennis Club » → « MT » : rond du logo quand Ten'Up n'en a pas (ou image illisible). */
export function clubInitials(name: string): string {
  const words = name.split(/[\s'’-]+/).filter(w => w && !STOP_WORDS.includes(ascii(w)));
  return (words.length > 1 ? words.slice(0, 3).map(w => w[0]) : [...(words[0] ?? '?').slice(0, 2)]).join('').toUpperCase();
}

export const MAX_SHORT_NAME = 12;
export function shortNameProblem(value: string): string | null {
  if (!value.trim()) return 'Indiquez un nom court.';
  if ([...value.trim()].length > MAX_SHORT_NAME) return `${MAX_SHORT_NAME} caractères au plus.`;
  return null;
}

/**
 * Adresse web de l'écran 02 (décision 5) : la première candidate libre parmi les 3 premières de
 * `shortSlugCandidates`. Aucune libre → `taken` (la ligne passe en erreur et ouvre le champ) ;
 * vérification impossible → la première, `error` (la création revérifie).
 */
export async function firstFreeSlug(
  candidates: string[], available: (slug: string) => Promise<boolean | null>,
): Promise<{ slug: string; check: SlugCheck }> {
  const tries = candidates.slice(0, 3);
  if (!tries.length) return { slug: '', check: { state: 'unavailable', reason: 'format' } };
  for (const slug of tries) {
    const free = await available(slug);
    if (free === null) return { slug: tries[0], check: { state: 'error' } };
    if (free) return { slug, check: { state: 'available' } };
  }
  return { slug: tries[0], check: { state: 'unavailable', reason: 'taken' } };
}

// ── Lien Ten'Up de la branche manuelle, repris à l'étape Équipes ─────────────

/**
 * Le brouillon vit dans `sessionStorage`, propre à l'onglet : le lien magique ouvre un AUTRE
 * onglet. Le lien Ten'Up saisi en 01 (repli manuel) est donc aussi posé dans `localStorage`,
 * rattaché à l'adresse du club, pour préremplir l'étape Équipes sur le même appareil.
 */
export const TENUP_LINK_KEY = 'feelike_signup_tenup_link';

export function rememberTenupLink(storage: Pick<Storage, 'setItem'>, slug: string, url: string): void {
  try { storage.setItem(TENUP_LINK_KEY, JSON.stringify({ slug, url: normalizeTenupClubProfileUrl(url) })); } catch { /* lien invalide ou stockage plein */ }
}

/** Le lien des rencontres du club (`ClubImport`) si un lien a été saisi pour CE club. */
export function rememberedTenupLink(storage: Pick<Storage, 'getItem'>, slug: string): string | null {
  try {
    const raw = JSON.parse(storage.getItem(TENUP_LINK_KEY) || 'null');
    if (!raw || raw.slug !== slug) return null;
    return `${normalizeTenupClubProfileUrl(raw.url)}/competitions/rencontres`;
  } catch { return null; }
}

// ── Saisie conservée au rechargement ─────────────────────────────────────────

/** `find` 01 · `already` 01b · `confirm` 02 · `account` 03 · `sent` ; 1-3 : branche manuelle M1-M3. */
export type SignupStep = 'find' | 'already' | 'confirm' | 'account' | 'sent' | 1 | 2 | 3;
export type SignupMode = 'tenup' | 'manual';
export type SignupDraft = {
  step: SignupStep;
  mode: SignupMode;
  /** Lien collé en 01 : gardé en branche manuelle pour l'étape Équipes (jamais envoyé à `club-signup`). */
  tenupUrl: string;
  /** Club trouvé (écran 02) ; son `lookup_token` part avec l'inscription. */
  tenup: LookupResult | null;
  /** Écran 01b : nom Ten'Up du club déjà inscrit, s'il est connu. */
  alreadyName: string | null;
  name: string;
  city: string;
  slug: string;
  slugEdited: boolean;
  shortName: string;
  shortNameEdited: boolean;
  color: string;
  palette: string[];
  sample: number | null;
  email: string;
  /** Adresse et slug du dernier envoi réussi (écran de confirmation, renvoi du lien). */
  sent: { email: string; slug: string } | null;
  /** Images en data URL, seulement si elles tiennent dans le stockage de session. */
  logo: string | null;
  photo: string | null;
};

export const DRAFT_KEY = 'feelike_signup_draft';
/** Au-delà, une image n'est pas conservée (le quota de `sessionStorage` est de ~5 Mo). */
export const MAX_STORED_IMAGE = 1_500_000;

export const emptyDraft = (): SignupDraft => ({
  step: 'find', mode: 'tenup', tenupUrl: '', tenup: null, alreadyName: null,
  name: '', city: '', slug: '', slugEdited: false, shortName: '', shortNameEdited: false, color: BRAND_FALLBACK, palette: [],
  sample: null, email: '', sent: null, logo: null, photo: null,
});

const STEPS: SignupStep[] = ['find', 'already', 'confirm', 'account', 'sent', 1, 2, 3];
const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value);
const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
const image = (value: unknown) => (typeof value === 'string' && value.startsWith('data:image/') ? value : null);

/** Lecture tolérante : une entrée abîmée ou d'une autre version retombe sur le vide. */
export function loadDraft(storage: Pick<Storage, 'getItem'>): SignupDraft {
  const draft = emptyDraft();
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(storage.getItem(DRAFT_KEY) || 'null'); } catch { return draft; }
  if (!raw || typeof raw !== 'object') return draft;
  const sent = raw.sent as Record<string, unknown> | null;
  const valid = sent && typeof sent.email === 'string' && typeof sent.slug === 'string';
  const tenup = parseLookupResult(raw.tenup);
  // Brouillon d'avant P1 (sans `mode`) : saisie manuelle, et l'étape 4 est devenue `account`.
  const mode: SignupMode = raw.mode === 'tenup' ? 'tenup' : raw.mode === 'manual' || raw.step !== undefined ? 'manual' : 'tenup';
  let step = raw.step === 4 ? 'account' : STEPS.includes(raw.step as SignupStep) ? raw.step as SignupStep : 'find';
  if (step === 'sent' && !valid) step = 'account';
  // Sans club lu, ni carte ni jeton : on retrouve le club.
  if (mode === 'tenup' && !tenup && (step === 'confirm' || step === 'account')) step = 'find';
  return {
    step, mode,
    tenupUrl: str(raw.tenupUrl, 500), tenup, alreadyName: str(raw.alreadyName, 160) || null,
    name: str(raw.name, 80), city: str(raw.city, 80), slug: cleanSlugInput(str(raw.slug, 32)),
    slugEdited: raw.slugEdited === true,
    shortName: str(raw.shortName, MAX_SHORT_NAME), shortNameEdited: raw.shortNameEdited === true,
    color: isHex(raw.color) ? raw.color : draft.color,
    palette: Array.isArray(raw.palette) ? raw.palette.filter(isHex).slice(0, 4) : [],
    sample: typeof raw.sample === 'number' && COLOR_SAMPLES[raw.sample] ? raw.sample : null,
    email: str(raw.email, 254),
    sent: valid ? { email: String(sent.email), slug: String(sent.slug) } : null,
    logo: image(raw.logo), photo: image(raw.photo),
  };
}

/** Écrit la saisie ; sans place pour les images, les écrit sans elles plutôt que rien. */
export function saveDraft(storage: Pick<Storage, 'setItem'>, draft: SignupDraft): void {
  const fit = (value: string | null) => (value && value.length <= MAX_STORED_IMAGE ? value : null);
  for (const candidate of [{ ...draft, logo: fit(draft.logo), photo: fit(draft.photo) }, { ...draft, logo: null, photo: null }]) {
    try { storage.setItem(DRAFT_KEY, JSON.stringify(candidate)); return; } catch { /* quota : essai suivant */ }
  }
}

/** En-tête « Étape X sur N » : 3 écrans en Ten'Up (01, 02, 03), 5 en branche manuelle (01, M1-M3, 03). */
export function stepPosition(draft: Pick<SignupDraft, 'step' | 'mode'>): { index: number; total: number } | null {
  const { step, mode } = draft;
  const total = mode === 'manual' ? 5 : 3;
  if (step === 'find') return { index: 1, total };
  if (step === 'confirm') return { index: 2, total: 3 };
  if (typeof step === 'number') return { index: step + 1, total: 5 };
  if (step === 'account') return { index: total, total };
  if (step === 'sent') return { index: total + 1, total };
  return null;
}

// ── Envoi et erreurs ─────────────────────────────────────────────────────────

export type SignupPayload = {
  name: string; city: string; slug: string; color: string; email: string; turnstileToken: string;
  logo?: Blob | null; photo?: Blob | null;
  /** Branche Ten'Up seulement : jeton de `tenup-lookup` (logo et bandeau copiés côté serveur) et nom court. */
  lookupToken?: string; shortName?: string;
};

export type SignupOutcome =
  | { ok: true }
  | { ok: false; status: number; step: 2 | 3 | 4; message: string; resetTurnstile: boolean; slugReason?: 'format' | 'reserved' | 'taken';
      /** P1 : `already` → écran 01b ; `expired` → jeton de lecture expiré, on retrouve le club. */
      lookup?: 'already' | 'expired' };

/** Le formulaire `multipart/form-data` attendu par `club-signup` (SAAS_ONBOARDING.md §5.1). */
export function signupForm(payload: SignupPayload): FormData {
  const form = new FormData();
  form.set('name', payload.name.trim());
  form.set('city', payload.city.trim());
  form.set('sport', 'tennis');
  form.set('slug', payload.slug);
  form.set('color', payload.color);
  form.set('email', payload.email.trim().toLowerCase());
  form.set('turnstile_token', payload.turnstileToken);
  if (payload.logo) form.set('logo', payload.logo, fileName('logo', payload.logo));
  if (payload.photo) form.set('photo', payload.photo, fileName('photo', payload.photo));
  if (payload.lookupToken) form.set('lookup_token', payload.lookupToken);
  if (payload.shortName?.trim()) form.set('short_name', payload.shortName.trim());
  return form;
}
const fileName = (base: string, blob: Blob) => `${base}.${blob.type.split('/')[1] || 'bin'}`;

/**
 * Un code de `club-signup` → un message humain et l'étape où le corriger. La saisie n'est
 * jamais effacée. Un jeton Turnstile ne sert qu'une fois : toute réponse du serveur le
 * consomme, il est donc relancé après chaque échec — sauf réseau (jeton jamais parvenu).
 */
export function signupOutcome(status: number | 'network', body?: { error?: unknown; reason?: unknown }): SignupOutcome {
  if (status === 200) return { ok: true };
  const fail = (step: 2 | 3 | 4, message: string, extra: Partial<Extract<SignupOutcome, { ok: false }>> = {}) =>
    ({ ok: false as const, status: status === 'network' ? 0 : status, step, message, resetTurnstile: status !== 'network', ...extra });
  const reason = body?.reason === 'format' || body?.reason === 'reserved' || body?.reason === 'taken' ? body.reason : undefined;
  switch (status) {
    case 'network':
      return fail(4, 'Connexion impossible. Vérifiez votre réseau, puis réessayez : rien n’a été perdu.');
    case 409:
      if (body?.reason === 'already_on_feelike') return fail(4, 'Ce club a déjà son espace feelike.', { lookup: 'already' });
      return fail(3, 'Cette adresse vient d’être prise par un autre club. Choisissez-en une autre, le reste est conservé.', { slugReason: 'taken' });
    case 413:
      return fail(2, 'Vos images restent trop lourdes (5 Mo maximum chacune). Essayez un autre fichier, ou passez cette étape.');
    case 429:
      return fail(4, 'Trop de tentatives depuis cette connexion ou pour cette adresse. Réessayez dans une heure.');
    case 403:
      return fail(4, 'La vérification anti-robot n’a pas abouti. Elle se relance : réessayez dans un instant.');
    case 400:
      if (body?.reason === 'lookup_expired') return fail(4, 'La lecture de votre club sur Ten’Up a expiré. Relancez la recherche : le reste est conservé.', { lookup: 'expired' });
      if (reason) return fail(3, 'Cette adresse n’est pas disponible. Choisissez-en une autre.', { slugReason: reason });
      if (typeof body?.error === 'string' && /image/i.test(body.error)) return fail(2, 'Image non reconnue : utilisez un PNG, un JPEG ou un WebP.');
      return fail(4, 'Certaines informations sont incomplètes ou invalides. Vérifiez le nom, la ville et l’e-mail.');
    case 502:
      return fail(4, 'Votre club est enregistré, mais l’e-mail n’a pas pu partir. Réessayez dans une minute.');
    default:
      return fail(4, 'L’inscription est momentanément indisponible. Réessayez dans quelques minutes : rien n’a été perdu.');
  }
}

export async function submitClubSignup(
  fetcher: typeof fetch, endpoint: string, payload: SignupPayload,
): Promise<SignupOutcome> {
  let response: Response;
  try { response = await fetcher(endpoint, { method: 'POST', body: signupForm(payload) }); }
  catch { return signupOutcome('network'); }
  const body = await response.json().catch(() => undefined);
  return signupOutcome(response.status, body);
}
