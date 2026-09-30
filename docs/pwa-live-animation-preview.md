# Animation du live — validation visuelle

Branche : `codex/pwa-live-animation`.

## Voir le prototype

Depuis le worktree, lancer `npm --prefix pwa ci` puis
`npm --prefix pwa run dev -- --host 127.0.0.1 --port 5186`.
Ouvrir http://127.0.0.1:5186/live-preview.html.

Cette entrée Vite séparée utilise la typographie, les couleurs et les icônes de
la PWA. Elle n'est pas importée par l'application ni livrée dans son build.
Aucun appel Supabase, aucun changement de permissions et aucune donnée réelle.
Les états sont en mémoire. Le sélecteur de vue simule des droits, pas une authentification.

## Direction proposée

- Score épinglé et contrôles −/+ jeu pour le marqueur, avec points de tie-break et correction détaillée via l’éditeur existant. Les règles de score sont réutilisées, les écritures restent locales.
- Lecture publique, réactions et votes pour les comptes connectés.
- Un seul niveau de droits pour les membres : score, corrections, messages et sondages. Aucune distinction membre / owner.
- Messages limités à 280 caractères, trois raccourcis, auteur et score au moment du post.
- Plusieurs sondages ouverts simultanément, 2 à 4 réponses distinctes, vote modifiable par sondage, résultats après vote. Chaque clôture est indépendante.
- Champ de publication fixé en bas pour le marqueur et les membres animateurs ; bouton + pour sondages et messages rapides.
- Cœur fixé en bas côté spectateur, palette verticale inspirée des captures YouTube ; pas de réactions dans les vues d’animation.
- Six réactions éphémères : 👏 🔥 💪 ❤️ 😮 🎉. Réactions sans délai minimum ni message de limitation dans le prototype.
- Animations sans case de réglage ni toast de confirmation ; respect du réglage système de réduction du mouvement.
- Proposition pour la fin du match : clôture des interactions, fil en lecture seule.
- Photos différées.

## Vérifications effectuées

Compilation TypeScript et build PWA, dont contrôle du service worker.
Inspection navigateur bureau et mobile (390 et 320 px).
Publication par raccourci, modification du vote sans incrémenter le total,
création d’un second sondage sans clôturer le premier, invitation visiteur à se connecter,
réaction connectée, match terminé et fil vide.

## Plan initial après validation visuelle (implémenté)

Le détail actuel `/matches/:id/score` est réservé aux membres et sert à la saisie.
Créer une page publique distincte de suivi et relier les cartes de match à cette page.
Adapter les autorisations du score : tous les membres du club du match disposent des mêmes droits, sans exclusivité liée à `scored_by`. Conserver la protection contre les écritures concurrentes.
La capacité d'animer doit dépendre de l'appartenance au club du match.

Créer les tables, politiques RLS et commandes transactionnelles pour publications,
sondages, options et votes. Garantir côté serveur l'unicité du vote par compte,
les votes indépendants entre sondages, les règles de suppression des publications, sans créer un rôle owner distinct,
la clôture et la validation des longueurs. Conserver tous les sondages dans l’historique, comme dans le prototype.

Brancher les réactions éphémères sur un canal authentifié, limiter leur fréquence
côté serveur et agréger les rafales. Prévoir reconnexion, erreurs, états de chargement
et déconnexion pendant une action. Tester plusieurs clients et les droits entre clubs.
La modération par le propriétaire, la persistance, le temps réel, le réseau dégradé,
les doubles et les autres formats de score ne sont pas simulés dans cette maquette.

## Retour visuel du 26 septembre

Contrôles de score rétablis directement dans la vue owner, publication fixée en bas, réactions exclusivement côté spectateur et toujours accessibles pendant le défilement. Plusieurs sondages coexistent sans perdre leurs votes. La distinction marqueur / membre animateur de cette version est remplacée par les droits uniques ci-dessous.

## Vue immersive — V3

Le fil devient l’écran principal. La navigation générale du bas est retirée.
Le tableau compact comporte deux lignes de joueurs et un bouton + jeu (ou + point
pendant le tie-break) par joueur pour le marqueur. Les corrections restent dans
l’éditeur détaillé ; les clubs et classements sont accessibles via Détails du match.
Les commentaires sont présentés en fil continu, sans cartes. Chaque sondage conserve
une carte compacte question / votes / Répondre, ouvrant un panneau pour voter,
consulter les résultats ou clôturer. Le champ de publication reste fixé en bas.
Le cœur spectateur flotte directement au-dessus du fil, sans barre dédiée.

Vérifié sur 390 et 320 px : score rapide, ouverture et vote du sondage, retour au fil,
publication avec score courant, détails du match et palette de réactions.
Compilation PWA réussie, aucune erreur JavaScript observée. Tout reste simulé localement.

## Droits uniques des membres

Une seule vue Membre remplace les vues Owner et Membre. Tous les membres ont accès au score, à sa correction, aux messages et aux sondages. Les spectateurs connectés peuvent uniquement voter et réagir dans cette version. La publication de texte par les spectateurs est une évolution future, non activée. Les autorisations serveur restent à implémenter après validation du prototype.

## Finitions ergonomiques — V4

- Annulation successive des dernières saisies de score, y compris après le point gagnant.
- Messages et sondages dans un fil chronologique unique ; les nouveaux éléments arrivent en bas. La lecture suit le bas du fil si l’utilisateur y était déjà, et après sa propre publication.
- Score fixe hors du conteneur de défilement ; informations et corrections regroupées sur une ligne.
- Contraste et taille des textes secondaires renforcés ; animation discrète du score et des nouvelles publications, désactivée selon la préférence de mouvement réduit.
- Palette fermée après trois secondes d’inactivité ; chaque interaction repousse la fermeture, sans bloquer les combos.
- Hauteur adaptée au viewport visuel, zone de saisie extensible et commandes de démo masquées pendant sa saisie sur mobile.

Validation : TypeScript et compilation. Le contrôle visuel de cette passe est à reprendre : l’outil navigateur n’a pas pu démarrer. Le clavier logiciel et le confort en extérieur restent à tester sur un vrai téléphone.

Scénario de validation téléphone : ajouter deux jeux, annuler le dernier, publier un message long, créer puis répondre à un sondage, lire l’historique, envoyer quatre réactions identiques, attendre la fermeture de la palette. Vérifier que le clavier ne masque ni l’envoi ni le champ, et que le score reste lisible.

## Implémentation réelle

La PWA utilise désormais les données et commandes décrites dans [pwa-live-activity.md](pwa-live-activity.md). Ce document de prototype conserve les décisions et limites de la maquette. Les droits partagés, la persistance, les votes et les réactions sans cooldown sont implémentés ; les photos restent différées.
