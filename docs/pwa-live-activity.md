# Live PWA : score et animation du club

## Périmètre livré

`/matches/:id` est public ; `/matches/:id/score` reste un alias compatible.
Le score demeure visible pendant la lecture et la saisie. Les boutons ajoutent
un jeu, ou un point pendant les tie-breaks. Les corrections, l’abandon et la
réouverture utilisent l’éditeur existant. Annulation des 20 dernières saisies
locales confirmées tant qu’aucun autre membre n’a modifié le score.

Dans la liste, toute la carte ouvre le live. Un bandeau distinct en bas ouvre
la rencontre d’équipes liée et affiche son score provisoire ou validé. Les matchs
terminés comptent avant leur confirmation, sans doublon après validation ;
les doubles respectent leur pondération. Sans résultat connu, aucun score n’est
inventé. Une erreur de lecture est signalée plutôt que de présenter un score périmé.

Tous les membres du club et le super administrateur peuvent animer : score,
texte, sondage, clôture et suppression des publications. `scored_by` attribue
la dernière saisie et ne confère aucune exclusivité. Ce changement vaut aussi
pour la confirmation d’un résultat d’équipe depuis la PWA.

Les visiteurs lisent le fil. Les spectateurs connectés peuvent voter et envoyer
les réactions 👏 🔥 💪 ❤️ 😮 🎉 ; ils n’ont pas de champ de texte.
Les membres disposent du champ d’animation, sans bouton de réactions.
Photos et texte des spectateurs restent différés.

Texte : 280 caractères. Sondage : question de 140 caractères, 2 à 4 réponses
distinctes de 60 caractères. Plusieurs sondages restent ouverts simultanément.
Un compte peut changer son vote jusqu’à la clôture, sans augmenter le nombre
de participants. Les résultats détaillés se dévoilent après le vote ou la fin
du sondage/match. Les identités des votants ne sont jamais publiques.

Quatre réactions identiques consécutives du même compte, en moins de deux
secondes, fusionnent. Un autre emoji ou un combo terminé relance le compteur.
Pas de délai minimum, de confirmation d’envoi ou d’option d’animation.
La préférence système de mouvement réduit masque les animations.

## Données et fiabilité

- `live_posts` : messages et sondages dans un fil ordonné par séquence ; auteur
  et score au moment de la publication calculés côté serveur ; suppression logique.
- `live_votes` : clé primaire `(post_id, user_id)`, aucune lecture/écriture directe
  autorisée aux clients ; seules les commandes et agrégats sont exposés.
- `live_reactions` : événements éphémères, accessibles pendant 15 secondes,
  purgés au-delà de 30 secondes à l’arrivée de la prochaine réaction. Des lignes
  expirées peuvent subsister sans activité ; elles sont invisibles aux clients.
- `live_activity_page` : 50 éléments par page, agrégats et capacités de l’utilisateur,
  validation du couple match/club et du statut actif du club.
- `live_activity_command` : validation serveur, verrou transactionnel du match,
  contrôle des droits et du statut, votes par upsert, commandes rejouables.
- Publications rejouées avec la même clé après un timeout : aucun doublon.
  Les scores utilisent toujours la révision confirmée, sans mise à jour optimiste.
  Un conflit recharge le score et demande de le vérifier avant de poursuivre.
- Temps réel : `live_matches`, `live_posts`, `live_reactions`. Révalidation du fil
  au retour réseau/focus, à la reconnexion et toutes les 15 secondes ; du score
  toutes les 30 secondes. Les réactions manquées ne sont pas rejouées.
- Les suppressions logiques peuvent ne pas déclencher d’événement chez un lecteur
  lorsque la RLS rend la nouvelle ligne invisible ; le rafraîchissement du fil les
  retire au plus tard au prochain intervalle de 15 secondes en premier plan.
- `live_encounter_scores` : résumés publics limités au club actif, aux rencontres
  demandées et à 100 identifiants par appel. Lecture groupée pour toutes les cartes,
  rafraîchie sur les changements du score live et toutes les 15 secondes en secours.
- Les résultats d’équipe restent soumis à leurs révisions, règles de format,
  confirmations et invalidation lors d’une correction. Les liens sont conservés.

## Ordre de livraison

Appliquer les migrations dans cet ordre : `2026093001_live_activity.sql`,
`2026093002_team_live_shared_scoring.sql`, `2026100104_live_encounter_scores.sql`,
puis livrer la PWA. La première ajoute
les tables à `supabase_realtime` si cette publication existe. Vérifier que le
service Realtime est activé dans l’environnement cible.

Aucune migration n’a été appliquée à un service distant pendant ce développement.
Ne pas ouvrir le nouveau parcours contre une base qui ne dispose pas des RPC.
L’ancien client BO peut encore présenter sa reprise explicite ; cette interface
BO n’est pas refondue ici, et la base autorise désormais les membres du club.

## Validation

- `npm run test:live-activity` : composants réels avec backend simulé et migrations
  exécutées dans PostgreSQL local (PGlite). Accès public et entre clubs, membres,
  sondages simultanés, vote unique/modifiable et privé, idempotence, pagination,
  réactions indépendantes par compte, combos, score rapide, annulations et conflits,
  ainsi que l’intégration des lives d’équipes, les liens indépendants des cartes
  et les scores provisoires pondérés accessibles aux spectateurs.
- Régressions : `test:live-score`, `test:team-matches`, `test:pwa-network`,
  `test:pwa-updates`, `test:security` (86 tests au total).
- Compilation PWA et contrôle du service worker ; lint ciblé des nouveaux composants,
  hooks et règles de score. Avertissement de taille du bundle déjà présent.

Le navigateur de contrôle n’a pas démarré pendant cette passe. Les tests DOM
ne valident pas la disposition physique ou le clavier logiciel. Avant livraison,
recette sur téléphone (320/390 px), clavier ouvert, double avec noms longs,
soleil extérieur, deux appareils animateurs et deux spectateurs simultanés,
perte/reprise réseau, quatre réactions puis une cinquième, vote/clôture/modération
et point gagnant/annulation. Tester le temps réel avec les migrations en place.

Le prototype validé reste séparé dans `pwa/live-preview.html` ; il n’est pas inclus
dans le build de production. Voir `pwa-live-animation-preview.md` pour son historique.
