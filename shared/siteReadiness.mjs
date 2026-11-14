// Quand une vitrine peut-elle être indexée ? Extrait de `web/src/lib/site.ts` (SaaS S8) pour que la
// checklist du BO (« Compléter votre site ») et la vitrine (`noindex`) appliquent la même règle.
// Les configurations passées sont déjà lues par `clubConfigSchema` (vitrine ou BO, copies synchronisées).

const text = (value) => Boolean(value?.trim());

/** Titres, photos seules et boutons ne suffisent pas à publier une page intérieure. */
export function hasContent(config, key) {
  const { home, club, infra, pricing, contact } = config;
  switch (key) {
    case 'home': return [home.hero_title, home.hero_subtitle, home.school_teaser_text,
      home.school_teaser_title, home.cta_text].some(text) || home.infra_teaser.some(x => text(x.label)) ||
      (config.settings.show_stats && home.stats.some(x => text(x.value) && text(x.label))) ||
      (config.settings.show_partners && config.partners.some(x => text(x.logo)));
    case 'club': return [club.president.name, club.president.quote, club.coach.name, club.coach.bio,
      ...club.values, ...club.methods, ...club.levels].some(text) ||
      club.programs.some(x => text(x.name)) || club.board.some(x => text(x.name));
    case 'infra': return infra.courts.some(x => text(x.label)) ||
      [infra.clubhouse.text, infra.locker_rooms.text].some(text);
    case 'pricing': return pricing.lessons.some(x => text(x.name)) ||
      pricing.membership.some(x => text(x.name)) || pricing.other_fees.some(x => text(x.label));
    case 'contact': return [contact.address_street, contact.address_city, contact.phone, contact.email,
      contact.maps_url].some(text) || contact.opening_hours.some(x => text(x.day) && text(x.time));
  }
  return false;
}

/** Ce qui manque au site pour être indexable, hors `settings.search_indexing` ; vide = complet. */
export function siteGaps(config) {
  const { home, pricing, contact } = config;
  const prices = [...pricing.lessons, ...pricing.membership];
  const gaps = [];
  if (!home.published || !hasContent(config, 'home')) gaps.push('accueil');
  if (!pricing.published || !hasContent(config, 'pricing')) gaps.push('tarifs');
  else {
    if (!text(pricing.season)) gaps.push('saison des tarifs');
    if (!prices.every(x => text(x.name) && x.price !== undefined && Number.isFinite(x.price) && x.price >= 0) ||
      !pricing.other_fees.every(x => text(x.label) && text(x.price))) gaps.push('prix des tarifs');
  }
  if (!contact.published) gaps.push('contact');
  else {
    if (!text(contact.address_street) || !text(contact.address_postal_code) || !text(contact.address_city)) gaps.push('adresse');
    if (!text(contact.phone) && !text(contact.email)) gaps.push('téléphone ou e-mail');
  }
  return gaps;
}

/** Pas d'ouverture automatique à l'indexation pendant la saisie des informations pratiques. */
export function isReadyForIndexing(config) {
  return config.settings.search_indexing && siteGaps(config).length === 0;
}
