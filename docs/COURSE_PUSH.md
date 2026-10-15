# Notifications de cours dans la PWA

Le flux couvre deux événements :

- demande nouvelle ou renouvelée (`pending`) → encadrant désigné du cours (`owner_id`) ;
- décision sur une demande en attente (`approved` ou `denied`) → membre demandeur.

Les événements sont produits par `course_registration_events`, après réussite de la commande SQL. Le trigger crée une livraison par appareil déjà abonné. La fonction Edge `course-push-dispatch` prend les livraisons en attente et les envoie via Web Push. Un échec transitoire est réessayé jusqu'à cinq fois ; un abonnement expiré (HTTP 404/410) est supprimé. Les notifications ouvrent le cours concerné. La raison d'un refus n'est pas affichée sur l'écran verrouillé : elle reste consultable dans la PWA.

## Mise en service, par projet Supabase

1. Appliquer `2026092402_course_web_push.sql`.
2. Générer une paire VAPID dédiée au projet, par exemple avec `npx web-push generate-vapid-keys --json`. Garder la clé privée hors du dépôt.
3. Configurer `VITE_VAPID_PUBLIC_KEY` dans le build de la PWA. Dans les secrets de la fonction Edge, configurer la **même** clé publique comme `VAPID_PUBLIC_KEY`, la clé privée comme `VAPID_PRIVATE_KEY`, et `VAPID_SUBJECT` comme `mailto:adresse-de-contact-du-club`.
4. Générer un secret aléatoire dédié (au moins 32 caractères) et configurer `COURSE_PUSH_CRON_SECRET` dans les secrets Edge et la même valeur sous `course_push_cron_secret` dans Vault. Déployer `course-push-dispatch` avec la vérification JWT activée (valeur par défaut). Configurer dans Supabase Vault `course_push_project_url` (URL du projet) et `course_push_service_role_key` (JWT `service_role` historique). Ne mettre aucune de ces valeurs dans le dépôt ou dans une variable `VITE_`.
5. Exécuter `supabase/scripts/course-push-cron.sql` dans le SQL Editor. Vérifier dans les logs Cron et Edge Function que les appels s'exécutent chaque minute.
6. Tester sur un appareil réel : activer les notifications depuis la page Cours, déposer une demande avec un membre, puis l'approuver ou la refuser avec l'encadrant. Sur iPhone, installer d'abord la PWA sur l'écran d'accueil et autoriser les notifications dans iOS.

Le bouton d'activation apparaît seulement pour un membre connecté. La déconnexion depuis la PWA désabonne l'appareil. Les clubs suspendus et les membres retirés ne reçoivent plus de nouvelles livraisons. Le navigateur garde la permission système, même après désactivation dans l'application.

## Fiabilité et coexistence avec les emails

Les emails Brevo et les Web Push sont deux canaux indépendants : recevoir les deux est voulu. Brevo ne transporte pas les push.

Le cron traite au maximum 10 livraisons par minute, avec un délai réseau de 10 secondes par envoi. Les réservations expirent après 5 minutes ; une livraison est abandonnée après 5 tentatives ou 24 heures. Une réponse 404/410 supprime l'abonnement expiré. Un identifiant stable limite les doublons affichés après une reprise.

L'abonnement est lié au compte et au club. Une permission système déjà accordée ne réactive pas automatiquement les notifications pour un autre compte. Les opérations concurrentes d'activation/désactivation sont sérialisées et la déconnexion révoque l'abonnement.

## Validation DEV — 24 septembre 2026

Projet Supabase : `hnhsmefrcihpnkxbrxmr` (`DEV - club management`). Migration appliquée, clés VAPID et secret cron dédiés configurés, fonction déployée avec vérification JWT, cron actif chaque minute. Aucun changement en production.

Vérifications réalisées : tests SQL, client et dispatcher ; régressions emails, cours et mise à jour PWA ; build PWA ; compilation Deno et chiffrement Web Push réel sans envoi. Le test transactionnel distant a confirmé les destinataires, la coexistence email/push et la réservation des livraisons, puis annulé toutes ses données.

Commandes utiles :

```sh
npm run test:course-push
npm run test:courses
npm run test:emails
npm run test:pwa-updates
npm --prefix pwa run build
ECE_KEYLOG=0 npx deno test --allow-env --no-config --no-lock --node-modules-dir=none supabase/functions/course-push-dispatch/crypto_test.ts
```

### Recette restant à effectuer sur appareil

Déployer le frontend DEV avec la clé VAPID publique correspondante, puis utiliser deux comptes de test et des adresses email de test :

- activer les notifications du gestionnaire et du membre depuis Cours ;
- envoyer une demande : vérifier le push et l'email du gestionnaire ;
- accepter une demande puis en refuser une autre : vérifier les push et emails du membre ;
- répéter avec la PWA fermée et l'écran verrouillé, puis ouvrir le cours en touchant la notification ;
- désactiver les notifications et vérifier leur absence ; se déconnecter puis changer de compte pour vérifier l'isolation.

La réception réelle sur appareil reste à valider. La session Vercel CLI locale est déconnectée : le frontend n'a pas été publié pendant cette intervention. Les configurations locales de DEV et les clés privées sont ignorées par Git.
