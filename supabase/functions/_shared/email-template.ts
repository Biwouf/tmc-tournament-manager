/** HTML email sans CSS externe : même habillage pour Auth et les notifications. */
export type EmailBrand = { name: string; color?: unknown; logo?: unknown };
export type EmailContent = { title: string; paragraphs: string[]; action?: { label: string; url: string }; code?: string; footer?: string };
export const platformBrand: EmailBrand = { name: 'Feelike', color: '#334155' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function renderEmail(brand: EmailBrand, content: EmailContent): { html: string; text: string } {
  let color = typeof brand.color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(brand.color) ? brand.color : '#334155';
  if (color.length === 4) color = '#' + [...color.slice(1)].map(c => c + c).join('');
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  const ink = (luminance + .05) / .05 > 1.05 / (luminance + .05) ? '#000000' : '#ffffff';
  const e = escapeHtml;
  const logo = httpsUrl(brand.logo);
  const action = content.action && httpsUrl(content.action.url) ? content.action : undefined;
  const footer = content.footer ?? 'Ce message vous est adressé automatiquement. Vous pouvez conserver cet email pour référence.';
  const text = [brand.name, content.title, ...content.paragraphs, content.code, action ? `${action.label} : ${action.url}` : null, footer].filter(Boolean).join('\n\n');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(content.title)}</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;color:#1f2937;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f3f4f6"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#ffffff;border-top:6px solid ${color};border-radius:12px">
<tr><td style="padding:28px 28px 16px">${logo ? `<img src="${e(logo)}" alt="${e(brand.name)}" width="64" style="display:block;max-width:64px;height:auto;margin-bottom:16px;border:0">` : ''}<p style="margin:0;font-size:16px;font-weight:bold;color:#374151">${e(brand.name)}</p></td></tr>
<tr><td style="padding:12px 28px 28px"><h1 style="margin:0 0 20px;font-size:25px;line-height:1.3;color:#111827">${e(content.title)}</h1>
${content.paragraphs.map(p => `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;white-space:pre-line">${e(p).replace(/\n/g, '<br>')}</p>`).join('')}
${content.code ? `<p style="font-size:28px;letter-spacing:5px;font-weight:bold">${e(content.code)}</p>` : ''}
${action ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td bgcolor="${color}" style="border-radius:8px;text-align:center"><a href="${e(action.url)}" style="display:inline-block;padding:16px 24px;border:1px solid ${color};border-radius:8px;color:${ink};font-size:16px;font-weight:bold;text-decoration:none">${e(action.label)}</a></td></tr></table><p style="font-size:12px;line-height:1.6;color:#6b7280">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><a href="${e(action.url)}" style="color:#374151;word-break:break-all">${e(action.url)}</a></p>` : ''}
</td></tr><tr><td style="padding:20px 28px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#6b7280">${e(footer)}</td></tr></table>
<p style="font-size:12px;color:#6b7280;margin:20px 0 0">${e(brand.name)}</p></td></tr></table></body></html>`;
  return { html, text };
}

/** Les métadonnées utilisateur ne sont jamais utilisées pour choisir une identité. */
export function clubSlugForEmail(redirect: string, aliases: Record<string, string> = {}): string | null {
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
    const slug = local ? alias(url.origin) :
      /^app-([a-z0-9-]+)\.feelike\.pro$/.exec(host)?.[1] ?? alias(url.origin) ?? alias(host);
    return typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
  } catch { return null; }
}
