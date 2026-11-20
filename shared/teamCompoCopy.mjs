// Compo d'équipe (brief compo-equipes §7) : textes et règles partagés par la PWA et le BO,
// pour que les deux surfaces disent la même chose. Les RPC lèvent des codes stables
// (`team_compo_save` & co, migration 2026111901) que `compoErrorMessage` traduit ici.

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** Même clé que `team_compo_name_key` en base : casse, espaces et accents ignorés. */
export function compoNameKey(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** « Paul Girard » → { prenom: 'Paul', nom: 'Girard' } ; un seul mot → prénom seul. */
export function splitGuestName(value) {
  const words = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  return { prenom: words[0] ?? '', nom: words.slice(1).join(' ') };
}

export const playersLabel = n => plural(n, 'joueur', 'joueurs');

/** « 3 simples, 1 double » d'après le format de la compétition. */
export const formatLabel = (simples, doubles) =>
  `${plural(simples, 'simple', 'simples')}, ${plural(doubles, 'double', 'doubles')}`;

/** Indication de nombre, jamais bloquante : `{ text, short }` (short = sous le minimum). */
export function countHint(count, minPlayers, simples) {
  if (!minPlayers) return { text: `${playersLabel(count)} retenu${count > 1 ? 's' : ''}`, short: false };
  const reason = `${plural(simples, 'simple', 'simples')}`;
  if (count < minPlayers) return { text: `Il faut au moins ${minPlayers} joueurs pour les ${reason}.`, short: true };
  return { text: `${playersLabel(count)} retenu${count > 1 ? 's' : ''} · il en faut au moins ${minPlayers} pour ${reason}`, short: false };
}

/** Compétition mixte : « 5 joueurs · 3 femmes, 2 hommes » (sexes non renseignés non comptés). */
export function mixedCountLabel(sexes) {
  const women = sexes.filter(s => s === 'female').length;
  const men = sexes.filter(s => s === 'male').length;
  const parts = [women && plural(women, 'femme', 'femmes'), men && plural(men, 'homme', 'hommes')].filter(Boolean);
  return `${playersLabel(sexes.length)}${parts.length ? ` · ${parts.join(', ')}` : ''}`;
}

export const COMPO_COPY = {
  title: 'Compo',
  note: 'Visible uniquement par les personnes connectées.',
  edit: 'Modifier',
  emptyTitle: 'Compo pas encore saisie',
  emptyMember: captain => captain
    ? `${captain}, capitaine, l’ajoutera ici avant la rencontre.`
    : 'Le capitaine l’ajoutera ici avant la rencontre.',
  emptyEditor: 'Choisissez les joueurs dans tout le club. Les personnes connectées verront la liste dès que vous l’enregistrez.',
  choose: 'Choisir les joueurs',
  lockedTitle: 'Qui joue ? Connectez-vous',
  lockedText: 'La compo est visible par toute personne connectée.',
  loginReturn: 'Vous reviendrez ici juste après.',
  login: 'Se connecter',
  signup: 'Créer un compte',
  sheetTitle: 'Choisir les joueurs',
  sheetSubtitle: (simples, doubles) => `Tout le club · ${formatLabel(simples, doubles)}`,
  search: 'Rechercher ou saisir un nom',
  filterLabel: 'Filtrer par sexe',
  filters: { all: 'Tous', male: 'Hommes', female: 'Femmes' },
  retained: n => `Retenus · ${n}`,
  clubGroup: filter => `${filter === 'male' ? 'Hommes du club' : filter === 'female' ? 'Femmes du club' : 'Membres du club'} · par nom`,
  captain: 'Capitaine',
  guest: 'Sans compte',
  you: 'Vous',
  sexUnknown: 'Sexe non renseigné',
  rankUnknown: 'Classement non renseigné',
  noMember: name => `Aucun membre du club ne s’appelle « ${name} ».`,
  addGuest: name => `Ajouter ${name}, sans compte`,
  addGuestQuoted: name => `Ajouter « ${name} » sans compte`,
  guestNote: 'Son nom apparaîtra dans la compo, sans lien vers un compte : il ne recevra pas de notification.',
  guestSex: 'Sexe (facultatif)',
  sexOptions: [['male', 'Homme'], ['female', 'Femme'], ['', 'Non précisé']],
  cancel: 'Annuler',
  add: 'Ajouter',
  save: 'Enregistrer la compo',
  saving: 'Enregistrement…',
  saved: 'Compo enregistrée',
  discardTitle: 'Abandonner vos changements ?',
  keepEditing: 'Continuer à modifier',
  discard: 'Abandonner',
  duplicate: name => `${name} est déjà dans la compo.`,
  reload: 'Recharger',
  loadError: 'Impossible de charger la compo.',
  candidatesError: 'Impossible de charger les membres du club.',
  notMember: 'N’est plus membre du club',
  retry: 'Réessayer',
  sheetFeuille: 'Saisir la feuille de match',
};

/** Message affiché pour une erreur des RPC de compo (supabase-js : `message`, `details`). */
export function compoErrorMessage(error, { offline = false } = {}) {
  const code = String(error?.message ?? '');
  const detail = String(error?.details ?? '').trim();
  if (code.includes('COMPO_STALE')) {
    return `${detail || 'Quelqu’un'} vient de modifier la compo. Rechargez pour voir sa version, puis refaites vos changements.`;
  }
  if (code.includes('DUPLICATE_PLAYER')) return COMPO_COPY.duplicate(detail || 'Ce joueur');
  if (code.includes('COMPO_FORBIDDEN')) return 'Seuls le capitaine de l’équipe et les administrateurs peuvent modifier la compo.';
  if (code.includes('COMPO_TOO_LARGE')) return 'La compo compte au plus 30 joueurs.';
  if (code.includes('PLAYER_NOT_MEMBER')) return 'Un joueur n’est plus membre du club : décochez-le, puis enregistrez.';
  if (code.includes('COMPO_AUTH_REQUIRED')) return 'Connectez-vous pour voir la compo.';
  if (offline || !code || /fetch|network/i.test(code)) {
    return 'Hors ligne : la compo n’est pas enregistrée. Vos choix sont gardés, réessayez dès le retour du réseau.';
  }
  return 'La compo n’a pas pu être enregistrée. Réessayez.';
}

export const isStaleCompo = error => String(error?.message ?? '').includes('COMPO_STALE');
