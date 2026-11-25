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

/** Classement affiché : `null` et l'ancien « NC » disent la même chose. */
export function rankLabel(rank) {
  return !rank || rank === 'NC' ? ACCOUNT_COPY.unranked : rank;
}

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
  notificationsMembersOnly: 'Réservées aux membres du club',
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
  passwordForgot: 'Mot de passe oublié ?',
  passwordResetSent: email => `Un lien vous a été envoyé à ${email}.`,
  passwordResetFailed: 'L’envoi du lien a échoué. Réessayez dans quelques instants.',
  passwordOtherDevices: 'Déconnecter mes autres appareils',
  passwordSavedOthers: 'Mot de passe modifié. Vos autres appareils sont déconnectés.',
  passwordOthersFailed: 'Mot de passe modifié, mais vos autres appareils n’ont pas pu être déconnectés.',
  passwordReauth: 'Pour des raisons de sécurité, reconnectez-vous puis réessayez.',
  passwordReauthCta: 'Me reconnecter',
  tooManyRequests: 'Trop de demandes. Patientez quelques minutes avant de réessayer.',
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
