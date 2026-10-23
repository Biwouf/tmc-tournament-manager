// Textes repris de la maquette « Landing v3 » (design_handoff_saas_onboarding/Main.dc.html).

export const tickerItems = [
  'Live score en temps réel',
  'Affiches de programmation',
  'Planning TMC automatique',
  'Interclubs : grille de saison',
  'Synchro TEN’UP',
  'Actus publiées sur Facebook',
  'Site vitrine référencé',
  'App installable',
];

export const compare = [
  { k: 'Ce qu’ils font', a: 'Adhésions, cotisations, comptabilité, réservation des courts.', b: 'Affiches, live score, site et app aux couleurs du club.' },
  { k: 'Pour qui', a: 'Le trésorier et le secrétaire.', b: 'Les joueurs, leurs familles, vos partenaires.' },
  { k: 'La saisie', a: 'Des formulaires, des exports, des relances.', b: 'Aucune : TEN’UP s’en charge.' },
  { k: 'Ce qu’on voit', a: 'Un tableau bien tenu.', b: 'Un club qui donne envie d’y jouer.' },
  { k: 'Le ressenti', a: 'Un outil.', b: 'Un dimanche de finale.' },
];

export const promises = [
  { n: '15', title: 'Une direction artistique de circuit', text: 'Typographies de tableau d’affichage, affiches de programmation, score bug en direct. Le même soin qu’une retransmission, aux couleurs de votre club.' },
  { n: '30', title: 'Zéro ressaisie', text: 'Rencontres, compositions et scores arrivent depuis TEN’UP. Vos bénévoles ne recopient plus rien : ils publient.' },
  { n: '40', title: 'Un prix, tout le club', text: 'Pas de tarif par adhérent, pas de module en option. Membres, bénévoles et enseignants illimités.' },
];

export const surfaces = [
  { key: 'site', url: 'votreclub.feelike.pro', cap: 'capture · site vitrine', title: 'Le site web', items: ['Accueil, Le Club, Infrastructures, Tarifs, Contact', 'Référencement automatique, sans champ à remplir', 'Aux couleurs et au logo du club'] },
  { key: 'app', url: 'app-votreclub.feelike.pro', cap: 'capture · app mobile', title: 'L’app des adhérents', items: ['Actus, matchs par équipe, live score', 'S’installe sur l’écran d’accueil, iOS et Android', 'Scores mis à jour en temps réel'] },
  { key: 'backoffice', url: 'admin.feelike.pro', cap: 'capture · back-office', title: 'Le back-office', items: ['Tout le contenu du club, sans une ligne de code', 'Rôles Administrateur, Gestionnaire, Membre', 'Planning TMC, affiches, interclubs, actus'] },
] as const;

export const moments = [
  { score: '15', title: 'Leur nom sur l’affiche', text: 'Importez la feuille de programmation TEN’UP : l’affiche du jour sort aux couleurs du club, prête à publier. Huit matchs par page, sans ressaisie.' },
  { score: '30', title: 'Leur score en direct', text: 'Chaque point saisi au bord du court s’affiche en temps réel dans l’app. La famille et le club suivent le match comme à la télé.' },
  { score: '40', title: 'Leur équipe suivie toute la saison', text: 'Grille de saison, résultats des rencontres, affiche des matchs du week-end : l’interclub prend des airs de championnat.' },
  { score: 'Jeu', title: 'Leur victoire à la une', text: 'Une actu en deux clics, photos de la rencontre incluses, publiée en même temps sur la page Facebook du club.' },
];

export const steps = [
  { n: '01', t: 'Le nom du club', d: 'Il s’affiche aussitôt en grand sur votre site et votre app.', time: '10 s' },
  { n: '02', t: 'Votre logo', d: 'On en tire vos couleurs : tout se teinte à l’identité du club.', time: '20 s' },
  { n: '03', t: 'Votre adresse', d: 'votreclub.feelike.pro pour le site, app-votreclub pour l’app.', time: '10 s' },
  { n: '04', t: 'Connectez TEN’UP', d: 'Vos rencontres arrivent, votre première affiche est prête.', time: '1 min' },
];

export const trialItems = [
  'Tout le produit, sans limite',
  'Sans carte bancaire',
  'Votre site et votre app en ligne en 2 minutes',
  'Tout est conservé quand vous passez à la saison',
];

export const seasonItems = [
  'Site vitrine, app des adhérents, back-office',
  'Synchro TEN’UP : rencontres, compositions, scores',
  'Live score, affiches, interclubs, planning TMC, cours',
  'Les nouveautés publiées pendant votre saison, incluses',
  'Membres, bénévoles et enseignants illimités',
  'Carte bancaire ou prélèvement SEPA, facture automatique',
];

export const faq = [
  { q: 'Est-ce que ça remplace notre logiciel de gestion ?', a: 'Non. Adhésions, cotisations, comptabilité et réservation des courts restent dans vos outils actuels, comme les données sportives dans TEN’UP. feelike.pro s’occupe de ce que vos joueurs et vos partenaires voient.' },
  { q: 'Faut-il quelqu’un de technique au club ?', a: 'Non. Tout se fait depuis le back-office, sans code ni hébergement. Si quelqu’un sait publier sur la page Facebook du club, il saura utiliser feelike.pro.' },
  { q: 'Que se passe-t-il à la fin des 30 jours ?', a: 'Rien n’est supprimé. Sans abonnement, le back-office passe en lecture seule ; dès que vous choisissez la saison, vous reprenez exactement là où vous en étiez.' },
  { q: 'Comment payer ?', a: 'Par carte bancaire ou prélèvement SEPA, en ligne. La facture est envoyée automatiquement au trésorier. Un paiement par virement sur facture est aussi possible.' },
  { q: 'Peut-on arrêter quand on veut ?', a: 'Oui, depuis votre espace, en un clic. L’abonnement n’est simplement pas renouvelé à la fin de la saison payée.' },
  { q: 'Qui peut modifier quoi ?', a: 'Chaque personne invitée a un rôle : administrateur, gestionnaire ou membre. Elle ne voit que ce qui la concerne, et vous gardez la main sur les accès.' },
  { q: 'Et pour les autres sports ?', a: 'Le tennis est disponible aujourd’hui. D’autres sports sont en préparation : écrivez-nous pour être prévenu.' },
];

// Description factuelle réutilisée par les métadonnées et le JSON-LD.
export const siteDescription = 'feelike.pro crée le site, l’app des adhérents et les affiches d’un club de tennis, alimentés automatiquement par TEN’UP. Essai gratuit de 30 jours sans carte bancaire, puis 250 € par an pour tout le club.';
