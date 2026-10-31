# Notifications Web Push des actus et événements

Extension de l'infra Web Push des cours et du Live (`docs/COURSE_PUSH.md`, `docs/LIVE_PUSH.md`) : même abonnement d'appareil, même fonction `course-push-dispatch`, même cron, même réveil `pg_net` (`live_push_kick`). Migration : `supabase/migrations/2026102901_content_web_push.sql`.

## Règles

| Alerte | Déclencheur | Destinataires |
|---|---|---|
| **Nouvelle actu** — titre de l'actu | Case « Envoyer une notification aux membres du club » (cochée par défaut) au clic sur **Publier** dans le formulaire BO, tant que l'actu n'a jamais été publiée. Un brouillon ne notifie pas. | Appareils du club dont la préférence **Actus et événements** est active, sauf la personne qui publie. |
| **Nouvel événement** — « Titre · 20/12 à 14h30 » (heure de Paris) | Même case à la **création** d'un événement dans le BO (pas à la modification). | Idem. |

- Le formulaire appelle `content_push_announce(p_club, p_kind, p_id)` (`kind` = `actu` ou `event`) après l'enregistrement ; un échec n'empêche jamais l'enregistrement.
- Réservé aux admins/gestionnaires du club (`can_manage_club_content`) ; une actu doit être publiée. Une seule annonce par contenu.
- Toucher l'alerte ouvre `/actus/<id>` ou `/evenements/<id>` dans la PWA.
- Les annonces de plus de 24 h ne sont plus envoyées (TTL Web Push : 24 h) ; les livraisons envoyées/échouées sont supprimées après 7 jours.

## Préférence

`course_push_subscriptions.notify_news` (vraie par défaut, **y compris pour les appareils déjà abonnés**). `push_subscribe` reçoit un 7ᵉ paramètre `p_news` (`NULL` conserve la préférence, vraie à la création) ; l'ancienne signature à 6 paramètres reste pour les clients en cache. PWA : ligne « Actus et événements » dans Mon profil → Notifications (`components/actu/NewsPushSettings.tsx`).

## Tests

```sh
npm run test:content-push  # SQL (PGlite) + dispatcher
npm run test:course-push   # préférences d'appareil et service worker
```

## Mise en service (DEV puis prod)

1. Vérifier que la version `2026102901` est libre dans le journal du projet (`npx -y supabase@2.98.2 migration list`).
2. Appliquer `2026102901_content_web_push.sql` **avant** de déployer la fonction (sinon `content_push_claim` manque : réponse 500, sans bloquer Live ni cours).
3. `npx -y supabase@2.98.2 functions deploy course-push-dispatch --project-ref <ref>`.
4. Merger : Vercel déploie BO et PWA.
5. Recette : sur un téléphone abonné (Live ou Cours), vérifier la ligne « Actus et événements » activée ; publier une actu case cochée depuis un autre compte → alerte, toucher → page de l'actu ; créer un événement case décochée → rien ; contrôler `SELECT kind,status,attempts,created_at FROM content_push_deliveries ORDER BY created_at DESC LIMIT 20;`.

Rollback : redéployer la version précédente de `course-push-dispatch` et du front. La table et la colonne peuvent rester.
