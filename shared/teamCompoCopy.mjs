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

const PARIS = 'Europe/Paris';
const parisDay = date => new Intl.DateTimeFormat('fr-CA', { timeZone: PARIS }).format(date);
/** « 9h », « 18h42 », heure de Paris. */
export function parisHour(date) {
  const [h, m] = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(date).split(':').map(Number);
  return `${h}h${m ? String(m).padStart(2, '0') : ''}`;
}

/** Fraîcheur : « il y a 5 min », « il y a 2 h » (même jour), « hier à 18h42 », « le 12 nov. à 9h ». */
export function freshnessLabel(updatedAt, now = new Date()) {
  const at = new Date(updatedAt);
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  if (parisDay(at) === parisDay(now)) return `il y a ${Math.floor(minutes / 60)} h`;
  if (parisDay(at) === parisDay(new Date(now.getTime() - 86400000))) return `hier à ${parisHour(at)}`;
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, day: 'numeric', month: 'short' }).format(at);
  return `le ${day} à ${parisHour(at)}`;
}

/** « Mise à jour il y a 2 h par Romain Escaffre, capitaine ». */
export function updatedLine(updatedAt, by, now) {
  const who = by ? ` par ${`${by.prenom} ${by.nom}`.trim()}${by.role === 'capitaine' ? ', capitaine' : ''}` : '';
  return `Mise à jour ${freshnessLabel(updatedAt, now)}${who}`;
}

/** Résumé d'une carte de la liste : « Claire, Marie, Sophie +1 ». */
export const previewNames = (names, count) =>
  `${names.join(', ')}${count > names.length ? ` +${count - names.length}` : ''}`;

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
  loginContext: label => label
    ? `Connectez-vous pour voir la compo de ${label}. Vous reviendrez ensuite sur la rencontre.`
    : 'Connectez-vous pour voir la compo. Vous reviendrez ensuite sur la rencontre.',
  welcomeBack: 'Vous êtes connecté. Voici la compo.',
  youPlayTitle: 'Vous jouez cette rencontre',
  youPlay: 'Vous jouez',
  compoToCome: 'Compo à venir',
  lockedCard: 'Compo réservée aux connectés',
  lockedBanner: 'Connectez-vous pour voir qui joue chaque rencontre.',
  cardLabel: (count, isMe) => count ? `${isMe ? 'Vous jouez, ' : ''}compo de ${playersLabel(count)}` : 'compo à venir',
  cardLockedLabel: 'compo réservée aux personnes connectées',
  seeAll: n => `Voir les ${n} joueurs`,
  sheetList: n => `Compo · ${playersLabel(n)}`,
  groups: { female: 'Dames', male: 'Messieurs', none: 'Sexe non précisé' },
  loginReturn: 'Vous reviendrez ici juste après.',
  login: 'Se connecter',
  signup: 'Créer un compte',
  sheetTitle: 'Choisir les joueurs',
  sheetSubtitle: (simples, doubles) => `Tout le club · ${formatLabel(simples, doubles)}`,
  /** Mention discrète du genre de la rencontre (rien en mixte). */
  genreLabel: genre => ({ hommes: 'Rencontre messieurs', femmes: 'Rencontre dames', garcons: 'Rencontre garçons', filles: 'Rencontre filles' })[genre] ?? null,
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
  notMemberError: names => `${names.join(', ')} ne ${names.length > 1 ? 'font' : 'fait'} plus partie du club. Retirez-${names.length > 1 ? 'les' : 'le'} de la compo.`,
  cannotEdit: 'La compo ne peut pas être modifiée pour l’instant : l’identité de certains joueurs n’a pas été reçue. Rechargez la page ; si le problème continue, prévenez un administrateur.',
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
  if (code.includes('PLAYER_NOT_MEMBER')) return 'Un joueur ne fait plus partie du club. Retirez-le de la compo.';
  if (code.includes('COMPO_AUTH_REQUIRED')) return 'Connectez-vous pour voir la compo.';
  if (offline || !code || /fetch|network/i.test(code)) {
    return 'Hors ligne : la compo n’est pas enregistrée. Vos choix sont gardés, réessayez dès le retour du réseau.';
  }
  return 'La compo n’a pas pu être enregistrée. Réessayez.';
}

export const isStaleCompo = error => String(error?.message ?? '').includes('COMPO_STALE');
