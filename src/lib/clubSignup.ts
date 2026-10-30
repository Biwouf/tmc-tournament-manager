// SaaS S3 — logique du tunnel d'inscription `admin.feelike.pro/inscription`, sans React.
// Spec : docs/specs/SAAS_ONBOARDING.md §7. Seul point d'écriture : l'Edge Function
// `club-signup` (S2) ; les règles du slug viennent de `shared/clubSlug.mjs`, jamais d'ici.
import { signupSlugProblem } from '../../shared/clubSlug.mjs';
import { BRAND_FALLBACK } from '../../shared/brandTokens.mjs';

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

// ── Saisie conservée au rechargement ─────────────────────────────────────────

export type SignupStep = 1 | 2 | 3 | 4 | 'sent';
export type SignupDraft = {
  step: SignupStep;
  name: string;
  city: string;
  slug: string;
  slugEdited: boolean;
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
  step: 1, name: '', city: '', slug: '', slugEdited: false, color: BRAND_FALLBACK, palette: [],
  sample: null, email: '', sent: null, logo: null, photo: null,
});

const STEPS: SignupStep[] = [1, 2, 3, 4, 'sent'];
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
  const step = STEPS.includes(raw.step as SignupStep) ? raw.step as SignupStep : 1;
  return {
    step: step === 'sent' && !valid ? 4 : step,
    name: str(raw.name, 80), city: str(raw.city, 80), slug: cleanSlugInput(str(raw.slug, 32)),
    slugEdited: raw.slugEdited === true,
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

// ── Envoi et erreurs ─────────────────────────────────────────────────────────

export type SignupPayload = {
  name: string; city: string; slug: string; color: string; email: string; turnstileToken: string;
  logo?: Blob | null; photo?: Blob | null;
};

export type SignupOutcome =
  | { ok: true }
  | { ok: false; status: number; step: 2 | 3 | 4; message: string; resetTurnstile: boolean; slugReason?: 'format' | 'reserved' | 'taken' };

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
      return fail(3, 'Cette adresse vient d’être prise par un autre club. Choisissez-en une autre, le reste est conservé.', { slugReason: 'taken' });
    case 413:
      return fail(2, 'Vos images restent trop lourdes (5 Mo maximum chacune). Essayez un autre fichier, ou passez cette étape.');
    case 429:
      return fail(4, 'Trop de tentatives depuis cette connexion ou pour cette adresse. Réessayez dans une heure.');
    case 403:
      return fail(4, 'La vérification anti-robot n’a pas abouti. Elle se relance : réessayez dans un instant.');
    case 400:
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
