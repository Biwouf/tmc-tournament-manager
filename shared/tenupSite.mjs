// SaaS S8b — profil Ten'Up d'un club (adresse, contact, réseaux, images, bureau, offres, terrains).
// Partagé par le BO (lien collé) et l'Edge `tenup-site` (réponse du worker) : aucune dépendance.

const BAD_LINK = 'Copiez le lien de votre club sur Ten’Up : https://tenup.fft.fr/club/… (n’importe quel onglet du club).';

/** `/club/<id>` et tout sous-chemin (onglet, installation) → la racine du club. Autre hôte refusé. */
export function normalizeTenupClubProfileUrl(value) {
  if (typeof value !== 'string' || value.length > 500) throw new Error(BAD_LINK);
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error(BAD_LINK); }
  const match = /^\/club\/(\d{1,12})(?:\/.*)?$/.exec(url.pathname);
  if (url.origin !== 'https://tenup.fft.fr' || url.username || url.password || !match) throw new Error(BAD_LINK);
  return `https://tenup.fft.fr/club/${match[1]}`;
}

export function tenupClubIdOf(url) {
  return /^https:\/\/tenup\.fft\.fr\/club\/(\d{1,12})$/.exec(url)?.[1] ?? null;
}

/** Seules les images du CMS des clubs FFT sont copiées (jamais un hôte arbitraire). */
export function isTenupImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cmsclub.fft.fr' && !url.port && !url.username && !url.password;
  } catch { return false; }
}

const PAGE_STATES = { club: ['ok'], equipe: ['ok', 'failed'], offres: ['ok', 'empty', 'failed'], installation: ['ok', 'failed', 'none'] };

/** Rejette tout ce qui n'a pas la forme attendue (worker compromis ou page changée). */
export function validateTenupClubProfile(payload, url) {
  const fail = () => { throw new Error('Profil du club Ten’Up illisible.'); };
  const str = (x, max) => typeof x === 'string' && x.length <= max;
  const label = (x, max = 160) => str(x, max) && x.trim() !== '';
  if (!payload || typeof payload !== 'object' || payload.url !== url) fail();
  const { pages, club, board, offers, courts } = payload;
  if (!pages || Object.keys(PAGE_STATES).some((k) => !PAGE_STATES[k].includes(pages[k]))) fail();
  if (!club || !label(club.name) || !['street', 'postal_code', 'city', 'phone', 'email'].every((k) => str(club[k], 200))) fail();
  if (!['facebook_url', 'instagram_url'].every((k) => club[k] === '' || (str(club[k], 300) && /^https?:\/\//.test(club[k])))) fail();
  if (!['logo', 'banner'].every((k) => club[k] === '' || (str(club[k], 500) && isTenupImageUrl(club[k])))) fail();
  // S8b-bis : photo de l'installation et grilles de tarifs, absentes d'un worker antérieur.
  if (club.installation_image !== undefined && club.installation_image !== '' &&
      !(str(club.installation_image, 500) && isTenupImageUrl(club.installation_image))) fail();
  if (!Array.isArray(club.sports) || club.sports.length > 10 || !club.sports.every((s) => label(s, 60))) fail();
  if (!Array.isArray(board) || board.length > 40 || !board.every((m) => m && label(m.name, 120) &&
      Array.isArray(m.roles) && m.roles.length <= 6 && m.roles.every((r) => label(r, 120)))) fail();
  if (!Array.isArray(offers) || offers.length > 100 || !offers.every((o) => o && str(o.type, 60) && label(o.title, 200) &&
      (o.year === null || (Number.isInteger(o.year) && o.year > 2000 && o.year < 2100)) && str(o.description, 600) &&
      (o.price === null || (typeof o.price === 'number' && Number.isFinite(o.price) && o.price >= 0 && o.price < 100_000)) &&
      typeof o.from === 'boolean' && (o.tariffs === undefined || (Array.isArray(o.tariffs) && o.tariffs.length <= 20 &&
        o.tariffs.every((t) => t && label(t.name, 200) && str(t.note, 300) &&
          (t.price === null || (typeof t.price === 'number' && Number.isFinite(t.price) && t.price >= 0 && t.price < 100_000))))))) fail();
  if (!Array.isArray(courts) || courts.length > 20 || !courts.every((c) => c && label(c.sport, 60) && str(c.surface, 80) &&
      Number.isInteger(c.count) && c.count > 0 && c.count < 200 && Number.isInteger(c.covered) && c.covered >= 0 && c.covered <= c.count)) fail();
  return { url, pages, club, board, offers, courts };
}
