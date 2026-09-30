# Alertes email des inscriptions au club

- Nouvelle demande : un email par administrateur (`club_members.role = admin`) du club concerné, avec le prénom et le nom du demandeur. Les managers et les super-admins sans rôle admin dans ce club ne sont pas destinataires.
- Validation : email au demandeur confirmant son accès membre.
- Refus : email au demandeur, même sans appartenance au club.

Le modèle HTML commun reprend le nom, la couleur et le logo du club. Les invitations et les révocations ne déclenchent pas ces alertes. Aucune reprise des anciennes demandes.

La file privée `signup_email_deliveries` est alimentée dans la transaction de création ou de décision, depuis Auth comme depuis le RPC. Rejouer une commande ne crée pas de doublon. Les adresses courantes sont lues dans Auth par le serveur ; le client ne choisit jamais les destinataires.

Avant chaque prise de lot, les demandes déjà traitées, décisions devenues obsolètes, admins retirés ou rétrogradés et clubs suspendus sont exclus. Les refus restent envoyables sans accès membre. Les lots de dix utilisent un bail de cinq minutes et `SKIP LOCKED`. Les erreurs temporaires sont réessayées jusqu’à cinq fois, pendant 24 heures maximum. Les lignes `failed` permettent de surveiller les échecs. Une interruption après acceptation Brevo et avant enregistrement peut produire un doublon ; `sent` signifie accepté par Brevo, pas réception garantie.

## Mise en service

1. Appliquer `supabase/migrations/202609250002_signup_email.sql` après les migrations d’inscription.
2. Configurer `BREVO_API_KEY` et `SIGNUP_FROM_EMAIL` (expéditeur validé chez Brevo). Sans `SIGNUP_FROM_EMAIL`, `CONTACT_FROM_EMAIL` est utilisé.
3. Déployer `supabase functions deploy signup-email-dispatch --project-ref <REF>`, avec la vérification JWT activée.
4. Configurer dans Vault `signup_email_project_url` et `signup_email_service_role_key` (JWT historique service_role).
5. Générer un secret aléatoire (`openssl rand -hex 32`) et enregistrer la même valeur dans le secret Edge `SIGNUP_EMAIL_CRON_SECRET` et le secret Vault `signup_email_cron_secret`.
6. Exécuter `supabase/scripts/signup-email-cron.sql` pour un traitement chaque minute. Réexécuter ce script met à jour la tâche du même nom.
7. Avec des comptes de test autorisés, vérifier une nouvelle demande, une validation et un refus, ainsi que la réception des emails et les états de la file.

Ces alertes utilisent un cron indépendant des cours ; le Send Email Hook Auth n’intervient pas. Une configuration absente renvoie 503 sans consommer les tentatives. Ne jamais enregistrer les secrets dans Git.

## Vérification locale

`npm run test:emails` couvre la file SQL et l’envoi Brevo simulé ; `npm run test:signup` vérifie les parcours existants. Aucun email réel n’est envoyé par les tests.
