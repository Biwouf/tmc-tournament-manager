// Hub « Mon compte » (brief compte/profil §7) : textes partagés par la PWA et, plus tard, le BO.

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 17 novembre » (heure de Paris), sans l'année. */
export function dayMonth(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'numeric' }).formatToParts(date);
  const day = parts.find(p => p.type === 'day')?.value;
  const month = Number(parts.find(p => p.type === 'month')?.value);
  return `${day} ${MONTHS[month - 1]}`;
}

/** Initiales : première lettre du prénom et du nom, majuscules, sans accents. Un mot seul → une lettre. */
export function initials(prenom, nom) {
  const first = word => String(word ?? '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return `${first(prenom)}${first(nom)}`;
}

/** Couleur d'avatar 1 à 6, tirée de l'identifiant (jamais du nom : homonymes, changement de nom). */
export function avatarTone(userId) {
  let hash = 0;
  for (const char of String(userId ?? '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 6) + 1;
}

/** Classements FFT groupés par série, pour la grille de la feuille Classement. */
export const RANK_SERIES = [
  { label: '4e série', ranks: ['NC', '40', '30/5', '30/4', '30/3', '30/2', '30/1', '30'] },
  { label: '3e série', ranks: ['15/5', '15/4', '15/3', '15/2', '15/1', '15'] },
  { label: '2e série', ranks: ['5/6', '4/6', '3/6', '2/6', '1/6', '0', '-2/6', '-4/6', '-15'] },
];

export const SEX_LABEL = { female: 'Femme', male: 'Homme' };

const GENRE = { hommes: 'Messieurs', femmes: 'Dames', mixte: 'Mixte', garcons: 'Garçons', filles: 'Filles' };
const CATEGORIE = { seniors: '', '35_ans': '+35', '60_ans': '+60', '17_18': '17-18 ans', '15_16': '15-16 ans', '13_14': '13-14 ans', '11_12': '11-12 ans' };

/** « Messieurs +35 », « Dames 2 » : nom court d'une équipe dont on est capitaine. */
export function captainTeamLabel(team) {
  const base = [GENRE[team.genre] ?? team.genre, CATEGORIE[team.categorie] ?? team.categorie].filter(Boolean).join(' ');
  return team.numero > 1 ? `${base} ${team.numero}` : base;
}

export const ACCOUNT_COPY = {
  title: 'Mon compte',
  memberPill: club => `Membre · ${club}`,
  pendingPill: club => `Demande en attente · ${club}`,
  captainPill: team => `Capitaine · ${team}`,
  pendingTitle: 'Le club n’a pas encore validé votre demande',
  pendingCard: date => `${date ? `Envoyée le ${date}. ` : ''}Vous pouvez déjà compléter votre profil. Les cours et les compos s’ouvriront après validation.`,
  deniedCard: 'Le club n’a pas accepté votre demande. Contactez-le pour en savoir plus.',
  revokedCard: club => `Votre accès membre à ${club} a été retiré. Contactez le club pour en savoir plus.`,
  refreshStatus: 'Actualiser',
  playerSection: 'Profil joueur',
  nameRow: 'Nom',
  sexRow: 'Sexe',
  rankRow: 'Classement',
  toComplete: 'À compléter',
  unranked: 'Non classé·e',
  sexHint: 'Sert aux quotas des cours et au filtre des compos. Changer ne modifie pas vos demandes en cours.',
  sexRowHint: 'Sert aux quotas des cours et au filtre des compos',
  nameHint: 'Tel qu’il apparaît sur votre licence : c’est ce nom que voient vos capitaines.',
  rankHint: 'Votre classement FFT actuel. Il s’affiche à côté de votre nom dans les compos.',
  rankUnknown: 'Je ne sais pas / non classé·e',
  rankNeedsProfile: 'Renseignez d’abord votre nom et votre sexe.',
  rankSaved: rank => `Classement : ${rank}`,
  allClubsNote: 'Ces informations valent pour tous vos clubs.',
  nameSheet: 'Nom et sexe',
  save: 'Enregistrer',
  saving: 'Enregistrement…',
  saved: 'Profil mis à jour',
  undo: 'Annuler',
  reload: 'Recharger le profil actuel',
  notificationsSection: 'Notifications',
  notificationsLater: 'Disponibles après validation',
  notificationsLaterHint: 'Cours, live et actus du club',
  pushUnavailable: 'Notifications indisponibles ici. Sur iPhone ou iPad, ajoutez l’application à l’écran d’accueil.',
  loginSection: 'Connexion',
  emailRow: 'E-mail',
  passwordRow: 'Mot de passe',
  edit: 'Modifier',
  passwordSheet: 'Mot de passe',
  currentPassword: 'Mot de passe actuel',
  newPassword: 'Nouveau mot de passe',
  passwordHint: '8 caractères minimum.',
  passwordSaved: 'Mot de passe modifié',
  passwordWrong: 'Mot de passe actuel incorrect.',
  passwordSame: 'Choisissez un mot de passe différent de l’actuel.',
  passwordShort: 'Le nouveau mot de passe doit faire au moins 8 caractères.',
  passwordFailed: 'Modification impossible. Réessayez.',
  logout: 'Se déconnecter',
  loggingOut: 'Déconnexion…',
  logoutFailed: 'Déconnexion impossible. Réessayez.',
  loadError: 'Impossible de charger votre profil joueur. Vérifiez votre connexion.',
  retry: 'Réessayer',
  conflict: 'Votre profil a changé entre-temps. Rechargez-le avant de recommencer.',
  invalid: 'Vérifiez les champs saisis.',
  saveFailed: 'Enregistrement impossible. Réessayez.',
};
