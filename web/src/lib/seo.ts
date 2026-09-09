import { configImageUrl } from './configImage';
import { pageHeading, type Page, type Site } from './site';

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const jsonForHtml = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const concise = (parts: (string | undefined)[]) => parts.filter(x => x?.trim()).join(' ').replace(/\s+/g, ' ').trim();
const shorten = (text: string) => text.length <= 170 ? text : `${text.slice(0, 167).replace(/\s+\S*$/, '')}…`;
const publicUrl = (value?: string) => value && /^https?:\/\//i.test(value) ? value : undefined;

export function metadata(site: Site, page: Page) {
  const { config: c, clubName, origin } = site;
  const group = c[page.key];
  const city = c.contact.address_city || c.brand.city;
  const location = city ? ` à ${city}` : '';
  const titles = {
    home: `${clubName}${location}`,
    club: `Le club${location} | ${clubName}`,
    infra: `Infrastructures${location} | ${clubName}`,
    pricing: `Tarifs${c.pricing.season ? ` ${c.pricing.season}` : ''}${location} | ${clubName}`,
    contact: `Contact et accès${location} | ${clubName}`,
  };
  const summaries = {
    home: concise([c.home.hero_subtitle, c.home.school_teaser_text, c.home.hero_title]),
    club: concise([c.club.president.quote, c.club.coach.bio, ...c.club.values, ...c.club.programs.map(x => x.name)]),
    infra: concise([...c.infra.courts.map(x => concise([x.count, x.label, x.detail])), c.infra.clubhouse.text, c.infra.locker_rooms.text]),
    pricing: concise([c.pricing.season, c.pricing.note, ...c.pricing.lessons.map(x => x.name),
      ...c.pricing.membership.map(x => x.name), ...c.pricing.other_fees.map(x => x.label)]),
    contact: concise([c.contact.address_street, c.contact.address_postal_code, c.contact.address_city,
      c.contact.phone, c.contact.email, ...c.contact.opening_hours.map(x => concise([x.day, x.time]))]),
  };
  const photo = page.key === 'home' ? c.home.hero_image : page.key === 'infra' ? c.infra.courts.find(x => x.image)?.image :
    page.key === 'club' ? c.club.president.photo || c.club.coach.photo : undefined;
  return {
    title: group.seo_title?.trim() || titles[page.key],
    description: group.seo_description?.trim() || shorten(`${pageHeading(site, page)}. ${summaries[page.key]}`),
    canonical: `${origin}${page.path}`,
    image: configImageUrl(photo || c.brand.logo),
  };
}

/** Seulement les coordonnées visibles dans le chrome / la page. Aucun horaire libre interprété. */
export function structuredData(site: Site, page: Page) {
  const { config: c, clubName: name, origin } = site;
  const contact = c.contact;
  const meta = metadata(site, page);
  const address = {
    '@type': 'PostalAddress',
    ...(contact.address_street ? { streetAddress: contact.address_street } : {}),
    ...(contact.address_postal_code ? { postalCode: contact.address_postal_code } : {}),
    ...(contact.address_city ? { addressLocality: contact.address_city } : {}),
  };
  const sameAs = [publicUrl(c.social.facebook_url), publicUrl(c.social.instagram_url)].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SportsClub', '@id': `${origin}/#club`, name, url: `${origin}/`,
        ...(configImageUrl(c.brand.logo) ? { logo: configImageUrl(c.brand.logo) } : {}),
        ...(Object.keys(address).length > 1 ? { address } : {}),
        ...(contact.phone ? { telephone: contact.phone } : {}),
        ...(contact.email ? { email: contact.email } : {}),
        ...(sameAs.length ? { sameAs } : {}),
      },
      {
        '@type': 'WebPage', '@id': `${meta.canonical}#page`, url: meta.canonical,
        name: meta.title, description: meta.description, inLanguage: 'fr',
        about: { '@id': `${origin}/#club` },
        ...(meta.image ? { image: meta.image } : {}),
      },
    ],
  };
}
export function headMarkup(site: Site, page: Page, indexable: boolean): string {
  const m = metadata(site, page);
  const favicon = configImageUrl(site.config.brand.logo);
  const esc = escapeHtml;
  return `<title>${esc(m.title)}</title>
${favicon ? `<link rel="icon" href="${esc(favicon)}">` : ''}
<meta name="description" content="${esc(m.description)}">
<meta name="robots" content="${indexable ? 'index, follow' : 'noindex, follow'}">
<link rel="canonical" href="${esc(m.canonical)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${esc(site.clubName)}">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description)}">
<meta property="og:url" content="${esc(m.canonical)}">
${m.image ? `<meta property="og:image" content="${esc(m.image)}">` : ''}
<script type="application/ld+json">${jsonForHtml(structuredData(site, page))}</script>`;
}
