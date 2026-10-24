# Notifications Web Push du Live

Extension de l'infra Web Push des cours (`docs/COURSE_PUSH.md`) : même abonnement d'appareil, même fonction `course-push-dispatch`, même cron, mêmes secrets Vault et clés VAPID. Migrations : `supabase/migrations/2026102401_live_web_push.sql`, puis `2026102402_live_push_start_text.sql` (texte de l'alerte de début) `2026102403_live_push_result_text.sql` (textes de fin de set et de match) et `2026102404_live_push_score_format.sql` (scores « 6/4 »).

## Règles

| Alerte | Déclencheur | Destinataires |
|---|---|---|
| **Match en direct** — « Alex Dupont - Sam Martin - Le match commence ! » (prénom et nom, « A / B » en double, sans le court). iOS et Android ajoutent d'eux-mêmes le nom de l'app (celui de l'icône sur l'écran d'accueil) : il ne fait pas partie du titre envoyé. | Case « Prévenir les abonnés du club » (cochée par défaut) au démarrage : PWA (choix du serveur), BO (dialog *Démarrer le live*), rencontres d'équipe PWA et BO. Le client appelle `live_push_announce_start` juste après le démarrage. | Appareils du club dont la préférence **Live** est active, sauf la personne qui démarre. |
| **Fin du 1er / 2e set** — « Alex Dupont remporte le 1er set 6/4 contre Sam Martin » (vainqueur du set d'abord, score de son point de vue) | Trigger `live_push_match` : `set1_ended_at` / `set2_ended_at` passe à non nul (posé par `stamp_live_set_times`). | Membres qui **suivent** le match (cloche), sur tous leurs appareils abonnés au club. |
| **Match terminé** — « Alex Dupont remporte le match 6/4, 7/5 contre Sam Martin » (+ « (abandon) ») | Passage à `finished`. Un set qui termine le match ne produit que cette alerte. | Suiveurs. |
| **Fil** — « Prénom Nom : message », « Nouveau sondage : … », « … a publié une photo » | Trigger `live_push_post` sur `live_posts`. | Suiveurs, sauf l'auteur. Tant qu'une alerte de fil attend son envoi, les suivantes la regroupent (« 3 nouvelles publications dans le fil »). Sur l'appareil, le tag `live-post-<match>` remplace l'alerte précédente du même match. |

- Une seule alerte `start`, `set1`, `set2`, `finish` par appareil et par match (`dedupe_key`), même après une correction de score ou « Rouvrir pour corriger ».
- L'annonce de début est refusée hors du club (`live_can_animate`), ignorée sur un match non `live` ou démarré depuis plus de 15 minutes, et n'est faite qu'une fois par match.
- Membres connectés uniquement. Un visiteur voit sur l'accueil des live une invitation à se connecter.
- Les alertes de plus de 30 minutes ne sont plus envoyées ; les livraisons envoyées/échouées sont supprimées après 3 jours. TTL Web Push : 10 min (fil), 15 min (début, set), 1 h (fin).
- Un membre retiré du club perd ses suivis et ses abonnements ; un club suspendu ne reçoit rien.

## Préférences et suivis

`course_push_subscriptions` reste **l'abonnement d'un appareil** (compte + club), avec deux préférences : `notify_courses` (vraie pour les abonnements existants) et `notify_live`. `push_subscribe(p_club, p_endpoint, p_p256dh, p_auth, p_courses, p_live)` crée ou met à jour l'abonnement ; `NULL` conserve la préférence (fausse à la création) et la fonction renvoie les préférences. `course_push_subscribe` reste en place pour les clients non mis à jour (il ne touche pas aux préférences d'un abonnement existant). Le trigger des cours filtre désormais sur `notify_courses`.

Les suivis (`live_match_follows`) sont par compte : `live_follow(p_club, p_match, p_on)` (match du club non terminé), `live_my_follows(p_club)`. Suivre un match sur un appareil non abonné abonne l'appareil sans activer de catégorie.

## Côté PWA

- Mon profil → **Notifications** : liste de lignes (`components/PushSwitchRow.tsx`) avec titre, sous-titre court et interrupteur à droite (`role="switch"`) : « Cours — Réponses à vos demandes et nouvelles demandes. », « Live — Début des matchs du club. ». Sur un appareil sans Web Push, les interrupteurs sont grisés et une note invite à ajouter l'application à l'écran d'accueil.

- `lib/coursePush.ts` : `enablePush` (permission demandée dans le geste), `disablePushCategory` (garde l'appareil abonné), `syncPush`, `onPushPreferences` ; `disableCoursePush` révoque tout l'appareil (déconnexion). `hooks/usePush.ts` partage l'état entre les contrôles de la page (une seule synchronisation).
- `components/live/LivePush.tsx` : `LivePushSettings` (ligne « Live » de Mon profil), `LivePushBanner` (accueil `/matches`, « Plus tard » mémorisé par compte), `LiveFollowButton` (cloche seule, sans bordure, sur les cartes en attente / en live et en haut à droite du live ; pleine quand le match est suivi).
- `lib/liveFollows.ts` : RPC de suivi et `announceLiveStart`.
- `public/course-push-sw.js` (nom conservé, chargé par `importScripts`) : accepte les URL `/matches/<uuid>`, tag et `renotify` pour le fil.

## Envoi

`course-push-dispatch` réclame d'abord `live_push_claim` (100 au plus), puis `course_push_claim` (10), et envoie 10 notifications en parallèle. Un échec de réclamation Live n'empêche pas l'envoi des cours (réponse 500 pour le signaler). Les triggers Live et l'annonce de début réveillent la fonction par `pg_net` (`live_push_kick`, mêmes secrets Vault que le cron) : l'alerte part en quelques secondes. Si `pg_net` ou Vault manque, ou si l'appel échoue, rien n'est levé et le cron de la minute rattrape. Aucune écriture de score ne peut échouer à cause du push.

## Tests

```sh
npm run test:live-push     # SQL (PGlite), UI PWA, dispatcher
npm run test:course-push   # non-régression cours + préférences d'appareil
npm --prefix pwa run build
```

## Mise en service

Prérequis : l'infra Web Push des cours est en service sur le projet (clés VAPID, secrets Edge, Vault `course_push_*`, cron `course-push-dispatch`). C'est le cas en DEV (24/09) et en prod (22/10/2026).

### DEV — `hnhsmefrcihpnkxbrxmr`

1. Vérifier que `2026102401` n'est pas déjà pris : `npx -y supabase@2.98.2 migration list` (worktree lié à DEV).
2. Appliquer `2026102401_live_web_push.sql` puis `2026102402_live_push_start_text.sql` `2026102403_live_push_result_text.sql` et `2026102404_live_push_score_format.sql` (`npx -y supabase@2.98.2 db push` ou SQL Editor).
3. Vérifier `pg_net` : `SELECT extname FROM pg_extension WHERE extname='pg_net';` (installée par le script cron des cours).
4. Déployer la fonction : `npx -y supabase@2.98.2 functions deploy course-push-dispatch --project-ref hnhsmefrcihpnkxbrxmr` (vérification JWT conservée).
5. Exposer la PWA DEV au téléphone sans toucher à Vercel : `npm run pwa:phone` (`scripts/pwa-phone-tunnel.sh`, prérequis `brew install cloudflared`). Le script builde la PWA avec `pwa/.env.local`, **refuse de démarrer s'il vise la prod**, accepte l'hôte du tunnel comme alias (`VITE_ALLOWED_HOSTS`) et affiche une URL `https://….trycloudflare.com` valable tant qu'il tourne (Ctrl+C pour arrêter). L'URL change à chaque lancement : sur iPhone, réinstaller l'app sur l'écran d'accueil à chaque fois. Les previews Vercel visent la base de prod : ne pas s'en servir pour cette recette. Le BO peut tourner en local (`npm run dev`, `.env.local` sur DEV) pour démarrer les matchs.
6. Recette sur appareil (PWA installée, notifications autorisées) — avec deux comptes membres A (téléphone) et B :
   - accueil des live : bandeau → « Activer » ; dans Mon profil, l'interrupteur Live est activé et celui des Cours inchangé ;
   - B démarre un match en laissant la case cochée → A reçoit « Match en direct » ; démarrer un autre match case décochée → rien ;
   - A touche « Alertes » sur la carte ; B gagne le 1er set → « Fin du 1er set » ; B publie deux messages vite → une alerte regroupée ; B termine → « Match terminé » ; toucher l'alerte ouvre la page du live ;
   - « Rouvrir pour corriger » puis terminer à nouveau → pas de 2ᵉ alerte ;
   - désactiver Live dans le profil → plus d'alerte de début mais les alertes des matchs suivis continuent ; se déconnecter → plus rien ;
   - visiteur non connecté : bandeau « Se connecter », aucune cloche.
7. Contrôler `SELECT dedupe_key,status,attempts,created_at,sent_at FROM live_push_deliveries ORDER BY created_at DESC LIMIT 20;` et les logs Edge (`claimed` / `sent`).

### Production — `ettausmxxxyfgmxxhvvx`

1. Avant le merge : contrôler le journal de prod `npx -y supabase@2.98.2 migration list --project-ref ettausmxxxyfgmxxhvvx` (la `2026092402` y figurait sans ses objets en octobre : vérifier aussi que `course_push_subscriptions` existe).
2. Appliquer `2026102401_live_web_push.sql` puis `2026102402_live_push_start_text.sql` `2026102403_live_push_result_text.sql` et `2026102404_live_push_score_format.sql` **avant** le déploiement de la fonction et du front (la fonction répond 500 tant que `live_push_claim` manque, sans bloquer les cours).
3. Vérifier `pg_net` et les secrets Vault `course_push_project_url`, `course_push_service_role_key`, `course_push_cron_secret` (`SELECT name FROM vault.secrets;`).
4. `npx -y supabase@2.98.2 functions deploy course-push-dispatch --project-ref ettausmxxxyfgmxxhvvx`.
5. Merger : Vercel déploie BO et PWA.
6. Recette courte avec un compte de test : activer Live, démarrer un match test case cochée, suivre, finir un set, publier un message, terminer. Puis supprimer le match test.
7. Surveiller une journée : logs Edge (réponses 200), `net._http_response` (statuts des réveils), volume de `live_push_deliveries`.

Rollback : redéployer la version précédente de `course-push-dispatch` et du front ; les tables Live peuvent rester (sans client, rien n'est produit hormis par les triggers set/fin/fil, qui n'ont pas de suiveurs). Pour couper totalement : `DROP TRIGGER live_push_match ON live_matches; DROP TRIGGER live_push_post ON live_posts;`.
