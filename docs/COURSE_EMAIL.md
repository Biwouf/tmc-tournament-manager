# Alertes mail des cours

Les nouveaux événements d’inscription déclenchent les mails suivants, sans abonnement push :

- Demande initiale ou renouvelée après refus/annulation : uniquement le propriétaire désigné (`owner_id`), sans copie aux admins. Le corps précise le prénom et le nom du membre demandeur (repli « Un membre » si le profil ne renseigne aucun nom).
- Passage de `pending` à `approved` : membre demandeur, place confirmée.
- Passage de `pending` à `denied` : membre demandeur, refus.

Les autres transitions restent silencieuses. Le motif du refus est inclus dans le mail au demandeur lorsqu’il est renseigné, et reste consultable dans l’application.
Les événements antérieurs à la migration ne sont pas repris. Les mails comportent le nom du cours et invitent à consulter l’application du club.

La file transactionnelle `course_email_deliveries` est privée (RLS et droits SQL). Seul le service serveur peut prendre un lot ou enregistrer son résultat. Les destinataires sont déterminés en base, et leur email courant est lu dans Supabase Auth côté serveur. Les clubs suspendus et les membres retirés sont exclus lors de la prise du lot.

Une commande rejouée ne crée pas de nouveau mail. Les lots sont verrouillés avec `SKIP LOCKED` et un bail de cinq minutes. Les pannes temporaires sont réessayées avec délai croissant, cinq tentatives au maximum et une durée de vie de 24 heures. Les échecs définitifs restent visibles en base. Une interruption après acceptation par Brevo mais avant enregistrement peut produire un doublon : la livraison n’est pas garantie « exactement une fois ». `sent` signifie accepté par Brevo, pas réception garantie en boîte mail.

## Mise en service par environnement Supabase

1. Appliquer `supabase/migrations/2026092301_course_email.sql` après les migrations des cours et de leur propriétaire, puis `2026092302_course_email_requester.sql` pour le nom du demandeur et `2026092303_course_email_denial_reason.sql` pour le motif du refus.
2. Configurer les secrets Edge `BREVO_API_KEY` et `COURSE_FROM_EMAIL` (expéditeur validé chez Brevo). Si `COURSE_FROM_EMAIL` est absent, `CONTACT_FROM_EMAIL` est utilisé.
3. Déployer `supabase functions deploy course-email-dispatch`, en conservant la vérification JWT.
4. Créer les secrets Vault `course_email_project_url` et `course_email_service_role_key` (JWT historique `service_role`, jamais une variable `VITE_`).
5. Générer un secret aléatoire (`openssl rand -hex 32`) et enregistrer la même valeur dans Edge Functions → Secrets sous `COURSE_EMAIL_CRON_SECRET` et dans Vault sous `course_email_cron_secret`. Ce secret authentifie le cron dans la fonction via `x-course-email-secret`, indépendamment de la clé serveur injectée dans le runtime. La vérification JWT Supabase reste activée.
6. Exécuter `supabase/scripts/course-email-cron.sql` pour un traitement chaque minute, dix mails par lot.
7. Avec des comptes de test autorisés, vérifier une demande, une acceptation et un refus : propriétaire puis membre, état de la file et réception réelle. Surveiller les lignes `failed` et les erreurs du cron/Edge.

Une configuration mail absente provoque une réponse 503 sans consommer la file. L’envoi est asynchrone : une panne Brevo ne remet pas en cause la décision sur la place.

## Vérification locale

`node --test tests/course-email-sql.test.mjs`

Le test exécute les migrations et les commandes dans PGlite : destinataires, acceptation/refus, répétition de commande, rollback, accès privés, reprise après crash, limite de tentatives et exclusion des membres retirés/clubs suspendus.

Après une mise à jour du mécanisme d’authentification : configurer les deux copies du secret dédié, redéployer la fonction et réexécuter le script cron (même nom de tâche, mise à jour de la planification). Ne pas ajouter ces secrets au dépôt.
