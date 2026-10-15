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

Réactions sur les publications (15/10/2026) : sous chaque commentaire et chaque
photo (pas les sondages), des puces emoji avec leur compteur et un bouton neutre
(smiley au trait avec « + », façon WhatsApp) qui ouvre la palette : six raccourcis
👏 🔥 💪 ❤️ 😮 🎉 et un « + » qui ouvre le clavier du téléphone, pour choisir
n’importe quel emoji (ton de peau, drapeau, séquences comprises). Seul le premier
emoji saisi compte ; le texte est ignoré. Le champ est monté en permanence et reçoit
le focus dans le geste, condition pour qu’iOS ouvre le clavier ; l’utilisateur bascule
sur l’onglet emoji du clavier (aucune API web ne l’ouvre directement). Tout compte connecté, membre ou non, peut réagir :
une réaction par compte et par publication. Toucher sa propre puce la retire, choisir
un autre emoji la remplace. Les réactions restent ouvertes après la fin du match.
Un visiteur voit les compteurs ; toucher une puce ou le bouton l’invite à se connecter.
Toucher la puce d’un emoji qu’on n’a pas choisi (ou un appui long / clic droit sur
n’importe quelle puce) ouvre la liste des noms par emoji, visible des seuls comptes
connectés ; pour réagir avec ce même emoji, on passe par la palette.
Le bouton flottant et les réactions éphémères (bulles, combos ×4, plafond de
6 réactions en 2 s) ont été retirés.
Les spectateurs n’ont pas de champ de texte. Les membres disposent du champ
d’animation. Le texte et les photos des spectateurs restent différés.

Photos (11/10/2026) : « Ajouter une photo », dans le menu « + » du champ
d’animation, ouvre le menu système du téléphone (photothèque ou prise de vue).
Ce menu ne contient que le sondage et la photo ; les réponses rapides prérédigées
ont été retirées. L’image est réduite à
1600 px de côté et convertie en JPEG avant l’envoi. On peut ajouter une légende
facultative de 280 caractères maximum. L’aperçu se retire avant publication.
Si la publication échoue après l’envoi, un nouvel essai réutilise le fichier
déjà reçu. Retirer l’aperçu ou supprimer la publication supprime aussi le fichier.
Un appui sur la photo l’ouvre en grand.

Texte : 280 caractères. Sondage : question de 140 caractères, 2 à 4 réponses
distinctes de 60 caractères. Plusieurs sondages restent ouverts simultanément.
Un compte peut changer son vote jusqu’à la clôture, sans augmenter le nombre
de participants. Les résultats détaillés se dévoilent après le vote ou la fin
du sondage/match. Les identités des votants ne sont jamais publiques.

## Données et fiabilité

- `live_posts` : messages et sondages dans un fil ordonné par séquence ; auteur
  et score au moment de la publication calculés côté serveur ; suppression logique.
- `live_posts.image_path` (`2026101102_live_photos.sql`) : type `photo` avec une
  image obligatoire et une légende de 0 à 280 caractères. Le chemin
  `<club_id>/<match_id>/<post_id>.jpg` du bucket public `live-images` est
  recalculé côté serveur, et la commande refuse une photo dont l’objet est absent.
  Policies Storage : envoi réservé aux membres du club sur un live en cours ;
  lecture et suppression réservées aux membres, suppression possible seulement
  quand plus aucune publication visible ne référence l’image.
- `live_votes` : clé primaire `(post_id, user_id)`, aucune lecture/écriture directe
  autorisée aux clients ; seules les commandes et agrégats sont exposés.
- `live_post_reactions` (`2026101501_live_post_reactions.sql`, qui supprime
  l’ancienne table `live_reactions`) : clé primaire `(post_id, user_id)`, aucun
  accès direct. `live_is_emoji` (contrainte et commande) accepte un seul emoji :
  1 à 16 points de code, tous dans les blocs symboles/emoji, dont un pictogramme.
  Commande `react` `{id, emoji}` (emoji `null` = retrait), rejouable,
  sans verrou sur la ligne du match et permise quel que soit le statut du match ;
  refusée sur un sondage ou une publication supprimée. Elle met à jour
  `live_posts.updated_at` pour prévenir les autres lecteurs via le temps réel.
  `live_activity_page` renvoie `my_reaction` et `reactions`
  (`{emoji, count, names}`, `names` à `null` pour un visiteur).
- `live_activity_page` : 50 éléments par page, agrégats et capacités de l’utilisateur,
  validation du couple match/club et du statut actif du club.
- `live_activity_command` : validation serveur, verrou transactionnel du match,
  contrôle des droits et du statut, votes par upsert, commandes rejouables.
- Publications rejouées avec la même clé après un timeout : aucun doublon.
  Les scores utilisent toujours la révision confirmée, sans mise à jour optimiste.
  Un conflit recharge le score et demande de le vérifier avant de poursuivre.
- Temps réel : `live_matches`, `live_posts`. Révalidation du fil
  au retour réseau/focus, à la reconnexion et toutes les 15 secondes ; du score
  toutes les 30 secondes.
- Les suppressions logiques peuvent ne pas déclencher d’événement chez un lecteur
  lorsque la RLS rend la nouvelle ligne invisible ; le rafraîchissement du fil les
  retire au plus tard au prochain intervalle de 15 secondes en premier plan.
- `live_encounter_scores` : résumés publics limités au club actif, aux rencontres
  demandées et à 100 identifiants par appel. Lecture groupée pour toutes les cartes,
  rafraîchie sur les changements du score live et toutes les 15 secondes en secours.
- Les résultats d’équipe restent soumis à leurs révisions, règles de format,
  confirmations et invalidation lors d’une correction. Les liens sont conservés.

## Livraison en production

Livrer la base avant la PWA. Le projet Supabase de production doit disposer de :

1. `2026093001_live_activity.sql` : publications, sondages, votes et réactions,
   RPC et droits des membres ; ajout de `live_posts` et `live_reactions` à
   `supabase_realtime` si cette publication existe.
2. `2026093002_team_live_shared_scoring.sql` : droits partagés sur les lives
   d’équipes, confirmations et invalidation lors des corrections.
3. `2026100104_live_encounter_scores.sql` : score provisoire des rencontres
   affiché dans les cartes. Cette migration est la seule nouvelle migration
   du diff de la PR ; les deux premières sont déjà versionnées sur `main`.

Vérifier l’historique du projet de production et appliquer seulement les migrations
manquantes, dans leur ordre chronologique. Le CLI du worktree est actuellement
lié au projet de la PWA locale ; ce lien ne désigne pas automatiquement la production.
Les commandes suivantes doivent cibler explicitement le projet de production :

```bash
supabase link --project-ref <reference-production>
supabase migration list
supabase db push --dry-run
# Après vérification des migrations proposées :
supabase db push
```

Vérifier que `live_matches` et `live_posts` sont dans la
publication `supabase_realtime` et que le service Realtime est activé.
Une fois la base prête, fusionner la PR puis vérifier le déploiement Vercel de
`pwa-cac-tennis`. Conserver les variables Supabase de production existantes.
Aucune nouvelle variable, Edge Function, configuration de bucket ou tâche cron
n’est nécessaire pour ce lot.

Après déploiement, faire la recette mobile décrite ci-dessous sur un live de
production : un membre publie et saisit le score, un second compte reçoit les
changements, vote et envoie des réactions ; vérifier aussi le score de rencontre.
Les PWA déjà installées doivent accepter le bandeau « Actualiser » pour charger
l’interface livrée. Voir `PWA_UPDATES.md` pour les versions antérieures au bandeau.
Après une utilisation ponctuelle du CLI sur la production, rétablir le lien vers
le projet de développement pour poursuivre le travail local.

L’agent n’a appliqué aucune migration ni modifié de service distant. L’état des
migrations en production reste à vérifier. L’ancien client BO peut encore
présenter sa reprise explicite ; cette interface BO n’est pas refondue ici,
et la base autorise désormais les membres du club.

### Lot photos (11/10/2026)

Appliquer `2026101102_live_photos.sql` en production avant de fusionner la PR.
La migration crée le bucket `live-images` (public, JPEG, 5 Mo) et ses policies :
aucune configuration manuelle au dashboard. Elle redéfinit entièrement
`live_activity_command` et `live_activity_page` : toute autre branche qui les
modifie doit repartir de cette version.
Dette : les images d’un live supprimé (cascade sur `live_posts`) restent dans le
bucket. Recette : photo depuis la pellicule et prise de vue en direct sur iOS
et Android, photo HEIC d’iPhone, réseau lent, suppression.

### Lot réactions sur les publications (15/10/2026)

Appliquer `2026101501_live_post_reactions.sql` en production **avant** de fusionner
la PR : elle supprime `live_reactions` (donc l’ancien client ne peut plus envoyer
de réaction éphémère, et son abonnement temps réel à `live_reactions` peut faire
échouer son canal : le fil se rafraîchit alors toutes les 15 secondes jusqu’à la
mise à jour via le bandeau « Actualiser ») et redéfinit
entièrement `live_activity_command` et `live_activity_page` : toute autre branche
qui les modifie doit repartir de cette version. Aucune configuration Realtime :
la table supprimée quitte d’elle-même la publication `supabase_realtime`.
Recette : réagir, changer, retirer depuis deux comptes ; appui long sur iOS
et Android ; visiteur non connecté ; réaction après la fin du match.

## Validation

- `npm run test:live-activity` : composants réels avec backend simulé et migrations
  exécutées dans PostgreSQL local (PGlite). Accès public et entre clubs, membres,
  sondages simultanés, vote unique/modifiable et privé, idempotence, pagination,
  réactions sur les publications (une par compte, retrait, noms masqués aux
  visiteurs, après la fin du match), score rapide, annulations et conflits,
  ainsi que l’intégration des lives d’équipes, les liens indépendants des cartes
  et les scores provisoires pondérés accessibles aux spectateurs.
- Régressions : `test:live-score`, `test:team-matches`, `test:pwa-network`,
  `test:pwa-updates`, `test:security` (87 tests au total).
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
