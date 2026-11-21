// Onboarding W3 (brief SAAS_11 §13.4) — contrat du logo « retouché » : réponse du worker
// (`kind: 'logo'`), lue par l'Edge `tenup-lookup` ; variantes copiées par `club-signup` ;
// `brand.logo_variants` lu par la PWA (`appIcons.ts`) et la Configuration.
// Le worker (`services/tenup-worker/pimp-logo.mjs`) est déployé seul et garde sa propre copie de
// `LOGO_VARIANTS` ; `tests/logo-pimp-edge.test.mjs` vérifie qu'elles sont identiques.

export const LOGO_VARIANTS = ['clean-1024', 'avatar-256', 'maskable-512', 'maskable-192', 'any-512', 'apple-180', 'email-128'];
export const LOGO_VERDICTS = ['cleaned', 'unchanged', 'monogram'];
const BACKGROUNDS = ['black', 'white', 'color'];
const FORMATS = ['png', 'jpeg', 'webp'];
/** Une variante PNG ne dépasse pas 2 Mo (base64 : 4/3). */
const MAX_VARIANT_B64 = Math.ceil((2 * 1024 * 1024 * 4) / 3);

const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value);
const isSize = (value) => Number.isInteger(value) && value > 0 && value <= 100_000;
const PNG_B64 = 'iVBORw0KGgo'; // signature PNG en base64

/**
 * Réponse du worker → `{ verdict, changes?, palette, source?, variants? }`, ou `null` si elle sort
 * du contrat (l'Edge garde alors l'original, sans erreur). `variants` (base64) seulement pour
 * `cleaned`, avec les sept variantes PNG.
 */
export function validateLogoResult(raw) {
  if (!raw || typeof raw !== 'object' || !LOGO_VERDICTS.includes(raw.verdict)) return null;
  const out = { verdict: raw.verdict, palette: [] };
  if (raw.palette !== undefined) {
    if (!Array.isArray(raw.palette) || raw.palette.length > 4 || !raw.palette.every(isHex)) return null;
    out.palette = [...raw.palette];
  }
  if (raw.source !== undefined) {
    const s = raw.source;
    if (!s || !isSize(s.width) || !isSize(s.height) || !FORMATS.includes(s.format)) return null;
    out.source = { width: s.width, height: s.height, format: s.format };
  }
  if (raw.verdict !== 'cleaned') return out;
  const c = raw.changes;
  if (!c || !(c.background === null || BACKGROUNDS.includes(c.background)) || typeof c.trimmed !== 'boolean' || typeof c.upscaled !== 'boolean') return null;
  out.changes = { background: c.background, trimmed: c.trimmed, upscaled: c.upscaled };
  const v = raw.variants;
  if (!v || typeof v !== 'object' || Object.keys(v).length !== LOGO_VARIANTS.length) return null;
  if (!LOGO_VARIANTS.every((name) => typeof v[name] === 'string' && v[name].startsWith(PNG_B64) && v[name].length <= MAX_VARIANT_B64 && /^[A-Za-z0-9+/]+=*$/.test(v[name]))) return null;
  out.variants = Object.fromEntries(LOGO_VARIANTS.map((name) => [name, v[name]]));
  return out;
}

/**
 * La ligne de la carte 02 : ce qui a été fait, dit simplement.
 * `{ background: 'black', trimmed: true, upscaled: true }` → « Fond noir retiré, recadré et net. »
 */
export function logoChangesText(changes) {
  if (!changes) return '';
  const parts = [];
  if (changes.background) parts.push(changes.background === 'black' ? 'fond noir retiré' : changes.background === 'white' ? 'fond blanc retiré' : 'fond retiré');
  if (changes.trimmed) parts.push('recadré');
  if (changes.upscaled) parts.push('net');
  if (!parts.length) return '';
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : parts[0];
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

/**
 * `brand.logo_variants` lu tel quel du JSONB (Configuration, PWA) : seulement des URL HTTPS de
 * noms connus ; sinon `null` (on garde le comportement d'avant).
 */
export function readLogoVariants(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const name of LOGO_VARIANTS) {
    const value = raw[name];
    if (typeof value !== 'string' || !/^https:\/\/\S+$/.test(value) || value.length > 1000) return null;
    out[name] = value;
  }
  return out;
}
