/** Public Ten'Up club profile (SaaS S8b): `/club/<id>`, `/equipe`, `/offres` and the first
 * `/installations/<n>`. One function per page, each taking a document: they run in Chromium
 * (worker, serialized with `toString()`) and in JSDOM (tests), so each one is self-contained.
 * Relevé du 14/11/2026 sur les clubs 60820110, 57950125 et 60310304. */

/** « Le club » : the `SportsActivityLocation` JSON-LD carries the address, phone, e-mail, logo and
 * banner; the header carries the social links (the FFT ones are in the footer, outside `main`). */
export function extractTenupClubHome(document) {
  const text = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  let place = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      if (data && data['@type'] === 'SportsActivityLocation') { place = data; break; }
    } catch { /* another script */ }
  }
  const name = text(document.querySelector('main h1'));
  if (!place && !name) throw new Error('Club profile not found');
  const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const header = document.querySelector('main #schema-club') ?? document.querySelector('main');
  const social = (pattern) => [...header.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href')).find((href) => pattern.test(href)) ?? '';
  const installations = [...document.querySelectorAll('main a[href]')]
    .map((a) => a.getAttribute('href')).filter((href) => /^\/club\/\d+\/installations\/\d+$/.test(href));
  const address = place?.address ?? {};
  return {
    name: str(place?.name) || name,
    street: str(address.streetAddress),
    postal_code: str(address.postalCode),
    city: str(address.addressLocality),
    phone: str(place?.telephone),
    email: str(place?.email),
    logo: str(place?.logo),
    banner: str(place?.image),
    sports: Array.isArray(place?.sport) ? place.sport.map(str).filter(Boolean) : [],
    facebook_url: social(/^https?:\/\/(www\.|m\.)?facebook\.com\//i),
    instagram_url: social(/^https?:\/\/(www\.)?instagram\.com\//i),
    installation: installations[0] ?? '',
  };
}

/** « Équipe & contact » : only the « Équipe dirigeante » (the board). Teachers and volunteers
 * are not read. A person may hold several roles. */
export function extractTenupClubBoard(document) {
  const text = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (!/L.équipe du club/.test(text(document.querySelector('main h2')) + [...document.querySelectorAll('main h2')].map(text).join(' '))) {
    throw new Error('Club team page not found');
  }
  const title = [...document.querySelectorAll('main p')].find((p) => text(p) === 'Équipe dirigeante');
  const list = title?.nextElementSibling;
  if (!list) return { board: [] };
  const board = [];
  for (const card of list.children) {
    const name = text([...card.children].find((child) => child.tagName === 'P'));
    const roles = [...card.querySelectorAll(':scope > div:last-child p')].map(text).filter(Boolean);
    if (name) board.push({ name, roles });
  }
  return { board };
}

/** « Offres et tarifs » : one card per offer. The type sits in the card's first `div` (absent on
 * some cards), then title, season year « (2027) », description and price. */
export function extractTenupClubOffers(document) {
  const text = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const offers = [];
  for (const card of document.querySelectorAll('main [data-slot="card"]')) {
    const blocks = [...card.children].filter((child) => child.tagName === 'DIV');
    const body = blocks.length > 1 ? blocks[1] : blocks[0];
    if (!body) continue;
    const type = blocks.length > 1 ? text(blocks[0]) : '';
    const spans = [...(body.querySelector('p')?.querySelectorAll(':scope > span') ?? [])].map(text);
    const yearSpan = spans.find((s) => /^\(\d{4}\)$/.test(s));
    const title = spans.filter((s) => s !== yearSpan).at(-1) ?? '';
    if (!title) continue;
    const parts = [...body.children];
    const description = text(parts[1]).slice(0, 600);
    const href = [...card.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => /^\/club\/\d+\/offres\/\d+$/.test(h)) ?? '';
    const priceText = [...card.querySelectorAll('p')].map(text).find((p) => /^(Tarif unique à|À partir de)\s.*€$/.test(p)) ?? ''; // pas la condition « À partir de 18 ans »
    const match = /([\d\s ]+(?:,\d{1,2})?)\s*€/.exec(priceText);
    const price = match ? Number(match[1].replace(/[\s ]/g, '').replace(',', '.')) : null;
    offers.push({
      type,
      title,
      year: yearSpan ? Number(yearSpan.slice(1, -1)) : null,
      description,
      price: Number.isFinite(price) ? price : null,
      from: /^À partir de/.test(priceText),
      href,
    });
  }
  return { offers };
}

/** Installation : under « Courts », one block per sport, then one row per surface with
 * « 4 terrains (4 couverts) ». The page carries one photo (« Photo de l'installation … »). */
export function extractTenupInstallation(document) {
  const text = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const title = [...document.querySelectorAll('main p')].find((p) => text(p) === 'Courts');
  if (!title) throw new Error('Installation courts not found');
  const list = [...title.parentElement.children].filter((child) => child !== title && child.getAttribute('data-slot') !== 'separator').at(0);
  const courts = [];
  for (const sportBlock of list?.children ?? []) {
    const sport = text(sportBlock.querySelector('[data-slot="badge"]'));
    for (const row of sportBlock.children) {
      if (row.querySelector('[data-slot="badge"]')) continue;
      const surface = text(row.querySelector('span'));
      const match = /^(\d+)\s+terrains?(?:\s*\((\d+)\s+couverts?\))?/.exec(text(row.querySelector('p')));
      if (sport && match) courts.push({ sport, surface, count: Number(match[1]), covered: match[2] ? Number(match[2]) : 0 });
    }
  }
  const photo = [...document.querySelectorAll('main img[alt]')].find((img) => /^Photo de l.installation/.test(img.getAttribute('alt')));
  return { courts, image: photo?.getAttribute('src') ?? '' };
}

/** Offer page (`/offres/<id>`), SaaS S8b-bis : under « Tarifs disponibles », one `article` per
 * tariff — name, price « 22,00 € », then its conditions (« Tarif par personne… »). Read only for
 * the offers listed « À partir de », whose card shows the lowest price alone. */
export function extractTenupOfferTariffs(document) {
  const text = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const title = [...document.querySelectorAll('main h2')].find((h) => text(h) === 'Tarifs disponibles');
  if (!title) throw new Error('Offer tariffs not found');
  const tariffs = [];
  for (const article of title.parentElement.querySelectorAll('article')) {
    const paragraphs = [...article.querySelectorAll('p')].map(text);
    const name = paragraphs[0] ?? '';
    const priceText = paragraphs.find((p) => /^[\d\s ]+(?:,\d{1,2})?\s*€$/.test(p)) ?? '';
    const match = /([\d\s ]+(?:,\d{1,2})?)\s*€/.exec(priceText);
    const price = match ? Number(match[1].replace(/[\s ]/g, '').replace(',', '.')) : null;
    const note = text([...article.querySelectorAll('div')].find((d) => !d.querySelector('p, div, button') && text(d))).slice(0, 300);
    if (name) tariffs.push({ name: name.slice(0, 200), price: Number.isFinite(price) ? price : null, note });
  }
  return { tariffs };
}
