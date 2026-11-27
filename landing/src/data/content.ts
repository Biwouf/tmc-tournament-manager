// Textes de la landing (brief LANDING_FEELIKE). Ne promettre que ce que le produit fait aujourd'hui.

// Section « Un match » : quatre moments. Les textes des notifications sont ceux que le produit envoie
// (docs/LIVE_PUSH.md), avec la rencontre fictive de l'affiche.
export const matchStory = [
  { time: '09:02', who: 'la capitaine', screen: 'compo', title: 'La compo est annoncée', text: 'La capitaine photographie la feuille : joueuses et classements sont lus et rapprochés des membres du club.' },
  { time: '09:15', who: 'tout le club', screen: 'lock', title: 'Le club est prévenu', text: 'Une alerte au premier service, une autre à chaque set, pour les membres qui suivent le match.' },
  { time: '10:58', who: 'au bord du court', screen: 'live', title: 'Le score, point par point', text: 'N’importe quel membre saisit le score ; la famille suit le match comme à la télé.' },
  { time: '19:07', who: 'pour les réseaux', screen: 'poster', title: 'L’affiche est prête', text: 'Résultat et détail des matchs, aux couleurs du club, prêts à publier.' },
] as const;

export const compare = [
  { us: false, label: 'Vous gardez', title: 'Vos logiciels de gestion et Ten’Up', rows: [
    { k: 'Ils font', v: 'Adhésions, cotisations, compta, réservation des courts' },
    { k: 'Pour', v: 'Le trésorier et le secrétaire' },
    { k: 'Saisie', v: 'Formulaires, exports, relances' },
  ] },
  { us: true, label: 'feelike.pro ajoute', title: 'La vitrine et la tribune du club', rows: [
    { k: 'Il fait', v: 'Site, app, live score, affiches et stories aux couleurs du club' },
    { k: 'Pour', v: 'Les joueurs, leurs familles, vos partenaires' },
    { k: 'Saisie', v: 'Rencontres et résultats repris de Ten’Up, sans ressaisie' },
  ] },
];

export const surfaces = [
  { key: 'site', url: 'tennisclubcastelsarrasin.fr', alt: 'Capture du site du CAC Tennis Club : la page d’accueil', title: 'Le site du club', items: ['Accueil, club, courts, tarifs, contact', 'À vos couleurs, sur votre adresse', 'Référencement prêt, sans réglage'] },
  { key: 'app', url: '', alt: '', title: 'L’app des adhérents', items: ['Actus, rencontres, live et cours', 'S’installe en deux gestes, iOS et Android', 'Alertes à chaque set'] },
  { key: 'backoffice', url: 'admin.feelike.pro', alt: 'Capture du back-office du CAC Tennis Club : la grille des rencontres de la saison', title: 'Le back-office', items: ['Actus (aussi sur Facebook), cours, TMC, affiches', 'Administrateurs, capitaines et membres', 'Sans une ligne de code'] },
] as const;

export const steps = [
  { n: '1', t: 'Collez le lien Ten’Up du club', d: 'N’importe quelle page du club sur tenup.fft.fr fait l’affaire.', time: '10 s' },
  { n: '2', t: '« C’est bien votre club ? »', d: 'Nom, logo, couleurs et adresse sont déjà remplis. Vous validez.', time: '30 s' },
  { n: '3', t: 'Un e-mail, et c’est en ligne', d: 'Vous confirmez votre adresse : le site et l’app s’ouvrent, et vos rencontres à venir arrivent de Ten’Up.', time: '1 min' },
];

export const trialItems = [
  'Le site, l’app et le back-office',
  'Sans carte bancaire',
  'Rien n’est perdu en passant à la saison',
];

export const seasonItems = [
  'Site, app des adhérents et back-office',
  'Synchro Ten’Up : rencontres, équipes, résultats',
  'Live, affiches, stories, interclubs, TMC, cours',
  'Membres, bénévoles et enseignants illimités',
];

export const faq = [
  { q: 'Est-ce que ça remplace notre logiciel de gestion ?', a: 'Non. Adhésions, cotisations, compta et réservation des courts restent dans vos outils. feelike.pro s’occupe de ce que vos joueurs et vos partenaires voient.' },
  { q: 'D’où viennent les données ? Est-ce lié à la FFT ?', a: 'feelike.pro lit les pages publiques Ten’Up de votre club : rencontres, équipes, résultats. C’est un service indépendant, non affilié à la FFT.' },
  { q: 'Nos adhérents doivent-ils télécharger une app ?', a: 'Non. Elle s’installe depuis le navigateur sur l’écran d’accueil, iOS et Android, sans passer par un store.' },
  { q: 'Combien de temps ça prend au bureau chaque semaine ?', a: 'Quelques minutes. Les rencontres viennent de Ten’Up et les résultats se synchronisent en quelques clics ; restent une actu ou une affiche quand vous en avez envie.' },
  { q: 'Faut-il quelqu’un de technique au club ?', a: 'Non. Si quelqu’un sait publier sur la page Facebook du club, il saura utiliser feelike.pro.' },
  { q: 'Que se passe-t-il à la fin des 30 jours ?', a: 'Rien n’est supprimé et rien n’est prélevé : aucune carte n’est demandée pour l’essai. Pour continuer, le club choisit la saison à 250 € par an.' },
  { q: 'Peut-on garder notre site ou notre adresse ?', a: 'Oui. Votre nom de domaine peut pointer vers le site du club, on le rattache avec vous : c’est le cas de tennisclubcastelsarrasin.fr. Et rien n’oblige à fermer un site existant.' },
  { q: 'Où sont hébergées les données de nos joueurs ?', a: 'La base de données est hébergée dans l’Union européenne (Irlande). Les compositions à venir ne sont visibles que des membres connectés.' },
];

// Description factuelle réutilisée par les métadonnées et le JSON-LD.
export const siteDescription = 'feelike.pro crée le site, l’app des adhérents et les affiches d’un club de tennis, à ses couleurs, à partir de son lien Ten’Up. Essai gratuit de 30 jours sans carte bancaire, puis 250 € par an pour tout le club.';
