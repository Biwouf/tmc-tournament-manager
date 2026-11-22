import { isReservedSlug } from '../../../shared/clubSlug.mjs';

/** HTML email sans CSS externe : même habillage pour Auth et les notifications.
 * W2 (brief SAAS_11 §13.3) : clair et sombre (`color-scheme`, `prefers-color-scheme`, `[data-ogsc]`),
 * pré-en-tête caché, bandeau en couleur du club (texte HTML, encre calculée), bouton assombri
 * jusqu'à 4,5:1 avec du blanc (+ VML pour Outlook Windows), logo dans un disque blanc avec `alt`
 * stylé, initiales en HTML sans logo. Jamais de WebP (mal pris en charge par Gmail et Outlook). */
export type EmailBrand = {
  name: string; color?: unknown; logo?: unknown;
  /** Logo déjà posé dans un disque blanc (variante W3 `email-128`) : affiché plein cadre. */
  logoDisc?: boolean;
  /** Initiales dans le disque quand il n'y a pas de logo (faux pour la marque Feelike). */
  monogram?: boolean;
  /** Surtitre du bandeau (« Votre app de club »). */
  eyebrow?: string;
};
export type EmailContent = {
  title: string; paragraphs: string[]; action?: { label: string; url: string }; code?: string; footer?: string;
  /** Pré-en-tête : texte d'aperçu de la boîte de réception, caché dans le corps. */
  preheader?: string;
  /** Ligne sous le code (durée, « ne le communiquez à personne »). */
  codeNote?: string;
  /** Lignes ajoutées au pied, après `footer` (signature Feelike, source des données). */
  notes?: string[];
};
export const platformBrand: EmailBrand = { name: 'Feelike', color: '#334155', monogram: false };
const DEFAULT_COLOR = '#334155';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
/** Logo utilisable dans un e-mail : HTTPS et pas de WebP. */
function emailImageUrl(value: unknown): string | null {
  const url = httpsUrl(value);
  return url && !/\.webp$/i.test(new URL(url).pathname) ? url : null;
}
function hexColor(value: unknown): string {
  let color = typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value) ? value.toLowerCase() : DEFAULT_COLOR;
  if (color.length === 4) color = '#' + [...color.slice(1)].map(c => c + c).join('');
  return color;
}
const channels = (color: string) => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
function luminance(color: string): number {
  const [r, g, b] = channels(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return r * .2126 + g * .7152 + b * .0722;
}
/** Contraste WCAG entre deux couleurs `#rrggbb`. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + .05) / (lo + .05);
}
/** Encre du bandeau : noir ou blanc, le plus contrasté (toujours ≥ 4,58:1). */
export function inkOn(color: string): '#000000' | '#ffffff' {
  return contrastRatio(color, '#000000') >= contrastRatio(color, '#ffffff') ? '#000000' : '#ffffff';
}
/** Fond du bouton : la couleur du club assombrie jusqu'à ≥ 4,5:1 avec du blanc. */
export function buttonColor(value: unknown): string {
  const base = channels(hexColor(value));
  for (let factor = 1; factor > 0; factor -= .01) {
    const color = '#' + base.map(v => Math.round(v * factor).toString(16).padStart(2, '0')).join('');
    if (contrastRatio(color, '#ffffff') >= 4.5) return color;
  }
  return '#000000';
}
/** « Moissac TC » → « MT » ; un seul mot → ses deux premières lettres. */
export function emailInitials(name: string): string {
  const words = name.split(/[\s'’-]+/).map(w => w.replace(/[^\p{L}\d]/gu, '')).filter(w => w && !['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et'].includes(w.toLowerCase()));
  const letters = words.length > 1 ? words.slice(0, 3).map(w => [...w][0]) : [...(words[0] ?? '?')].slice(0, 2);
  return letters.join('').toUpperCase();
}

const DARK_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){.fl-bg{background-color:#1b1b1d!important}.fl-card{background-color:#232325!important}.fl-ink{color:#f2f2f3!important}.fl-ink2{color:#d4d4d8!important}.fl-muted{color:#a3a3a8!important}.fl-line{border-color:#3a3a3e!important}.fl-code{background-color:#2c2c30!important;border-color:#3a3a3e!important}}
[data-ogsc] .fl-bg{background-color:#1b1b1d!important}[data-ogsc] .fl-card{background-color:#232325!important}[data-ogsc] .fl-ink{color:#f2f2f3!important}[data-ogsc] .fl-ink2{color:#d4d4d8!important}[data-ogsc] .fl-muted{color:#a3a3a8!important}[data-ogsc] .fl-line{border-color:#3a3a3e!important}[data-ogsc] .fl-code{background-color:#2c2c30!important;border-color:#3a3a3e!important}`;
const FONT = 'Arial,Helvetica,sans-serif';

export function renderEmail(brand: EmailBrand, content: EmailContent): { html: string; text: string } {
  const color = hexColor(brand.color);
  const ink = inkOn(color);
  const button = buttonColor(color);
  const e = escapeHtml;
  const logo = emailImageUrl(brand.logo);
  const action = content.action && httpsUrl(content.action.url) ? content.action : undefined;
  const footer = content.footer ?? 'Ce message vous est adressé automatiquement. Vous pouvez conserver cet email pour référence.';
  const notes = content.notes ?? [];
  // P2 : un code accompagné d'un lien (inscription, connexion) passe en premier, sous le titre ;
  // le lien reste en secours. Code seul (réauthentification) : après le texte, comme avant.
  const codeFirst = Boolean(content.code && action);
  const codeLines = [content.code, content.codeNote];
  const text = [brand.name, content.title, ...(codeFirst ? codeLines : []), ...content.paragraphs, ...(codeFirst ? [] : codeLines), action ? `${action.label} : ${action.url}` : null, footer, ...notes].filter(Boolean).join('\n\n');
  // Disque blanc de 64 px : logo (plein cadre s'il est déjà rond, sinon inscrit), ou initiales.
  const disc = 'width:64px;height:64px;border-radius:32px;background-color:#ffffff';
  const altStyle = `font-family:${FONT};font-size:13px;font-weight:bold;line-height:16px;color:${button}`;
  const badge = logo
    ? (brand.logoDisc
      ? `<img src="${e(logo)}" width="64" height="64" alt="${e(brand.name)}" style="display:block;border:0;width:64px;height:64px;border-radius:32px;background-color:#ffffff;text-align:center;${altStyle}">`
      : `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td align="center" valign="middle" width="64" height="64" style="${disc}"><img src="${e(logo)}" width="46" alt="${e(brand.name)}" style="display:block;border:0;width:46px;max-width:46px;height:auto;margin:0 auto;${altStyle}"></td></tr></table>`)
    : brand.monogram !== false
      ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td align="center" valign="middle" width="64" height="64" style="${disc};font-family:${FONT};font-size:20px;font-weight:bold;color:${button}">${e(emailInitials(brand.name))}</td></tr></table>`
      : '';
  const header = `<tr><td style="background-color:${color};padding:26px 28px" bgcolor="${color}"><table role="presentation" cellspacing="0" cellpadding="0"><tr>${badge ? `<td width="64" valign="middle" style="width:64px">${badge}</td>` : ''}<td valign="middle" style="${badge ? 'padding-left:16px;' : ''}font-family:${FONT};color:${ink}">${brand.eyebrow ? `<div style="font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${ink}">${e(brand.eyebrow)}</div>` : ''}<div style="font-size:22px;line-height:1.25;font-weight:bold;color:${ink}">${e(brand.name)}</div></td></tr></table></td></tr>`;
  const vmlWidth = Math.max(200, [...(action?.label ?? '')].length * 10 + 64);
  const button_ = action ? `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${e(action.url)}" style="height:50px;v-text-anchor:middle;width:${vmlWidth}px" arcsize="20%" stroke="f" fillcolor="${button}"><w:anchorlock/><center style="color:#ffffff;font-family:${FONT};font-size:16px;font-weight:bold">${e(action.label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 0"><tr><td bgcolor="${button}" style="border-radius:10px;background-color:${button}"><a href="${e(action.url)}" style="display:inline-block;padding:15px 28px;border-radius:10px;font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">${e(action.label)}</a></td></tr></table><!--<![endif]-->
<p class="fl-muted" style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#6b7280">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><a href="${e(action.url)}" class="fl-ink2" style="color:#374151;word-break:break-all">${e(action.url)}</a></p>` : '';
  const code = content.code ? `<div class="fl-code fl-ink" style="margin:8px 0 0;background-color:#f6f5f3;border:1px solid #e5e7eb;border-radius:12px;padding:18px;text-align:center;font-family:'Courier New',Courier,monospace;font-size:34px;line-height:1.2;letter-spacing:10px;font-weight:bold;color:#111827">${e(content.code)}</div>${content.codeNote ? `<p class="fl-muted" style="margin:10px 0 0;font-size:13px;line-height:1.5;text-align:center;color:#6b7280">${e(content.codeNote)}</p>` : ''}` : '';
  // Pré-en-tête : remplissage invisible pour que l'aperçu ne reprenne pas la suite du corps.
  const preheader = content.preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${e(content.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>` : '';
  const html = `<!doctype html><html lang="fr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${e(content.title)}</title><style>${DARK_CSS}</style></head>
<body class="fl-bg" style="margin:0;padding:0;background-color:#f3f4f6;color:#1f2937;font-family:${FONT}">${preheader}
<table class="fl-bg" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f3f4f6"><tr><td align="center" style="padding:32px 12px">
<table class="fl-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden">
${header}
<tr><td class="fl-ink" style="padding:30px 28px 28px;font-family:${FONT};color:#111827"><h1 class="fl-ink" style="margin:0 0 18px;font-size:25px;line-height:1.3;color:#111827">${e(content.title)}</h1>
${codeFirst ? `${code}<div style="height:20px;line-height:20px;font-size:1px">&nbsp;</div>` : ''}${content.paragraphs.map(p => `<p class="fl-ink2" style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#1f2937;white-space:pre-line">${e(p).replace(/\n/g, '<br>')}</p>`).join('')}
${codeFirst ? '' : code}${button_}
</td></tr><tr><td class="fl-muted fl-line" style="padding:22px 28px;border-top:1px solid #e5e7eb;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b7280">${e(footer)}${notes.map(n => `<br><br>${e(n)}`).join('')}</td></tr></table>
<p class="fl-muted" style="font-size:12px;color:#6b7280;margin:20px 0 0;font-family:${FONT}">${e(brand.name)}</p></td></tr></table></body></html>`;
  return { html, text };
}

/** Logo d'un club pour l'e-mail : la variante W3 `email-128` (PNG, disque blanc) quand le logo
 * retouché est choisi, sinon `brand.logo` (le gabarit écarte le WebP → initiales). */
export function emailBrandFromConfig(name: string, config: Record<string, unknown> | null | undefined): EmailBrand {
  const variants = config?.logo_variants as Record<string, unknown> | undefined;
  const email = variants && typeof variants['email-128'] === 'string' && config?.logo === variants['clean-1024'] ? variants['email-128'] : null;
  return email ? { name, color: config?.color, logo: email, logoDisc: true } : { name, color: config?.color, logo: config?.logo };
}

/** Les métadonnées utilisateur ne sont jamais utilisées pour choisir une identité. */
export function clubSlugForEmail(redirect: string, aliases: Record<string, string> = {}, dynamicOrigins: string[] = []): string | null {
  try {
    const url = new URL(redirect);
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(host);
    // HTTP uniquement pour le développement local, avec une origine explicitement
    // configurée (port compris). Aucun alias hostname seul pour localhost.
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    // Le BO central est multi-club : ne pas choisir arbitrairement un de ses clubs.
    if (host === 'admin.feelike.pro') return null;
    const alias = (key: string) => Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : undefined;
    const domainSlug = /^app-([a-z0-9-]+)\.feelike\.pro$/.exec(host)?.[1];
    // Le domaine club prime toujours sur un paramètre de requête. Une origine
    // locale autorisée transmet seulement une identité visuelle, jamais des droits.
    const hints = url.searchParams.getAll('club_slug');
    const dynamicSlug = hints.length === 1 ? hints[0] : null;
    const slug = domainSlug ?? (local && dynamicOrigins.includes(url.origin)
      ? dynamicSlug
      : local ? alias(url.origin) : alias(url.origin) ?? alias(host));
    return typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !isReservedSlug(slug) ? slug : null;
  } catch { return null; }
}
