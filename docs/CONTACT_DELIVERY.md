# Formulaire de contact — PR11

## Comportement

La page Contact et le drawer partagent `ContactForm`. Le navigateur transmet l’identité du club et les champs du visiteur à `contact-form`, jamais le destinataire. La fonction lit `club_settings.config.contact.email` côté serveur : pour CAC Tennis sur dev, cette valeur est `cactennis82@gmail.com`.

Le message est enregistré dans `contact_messages` avant la notification Brevo. L’expéditeur vient de `CONTACT_FROM_EMAIL`, le `replyTo` est l’adresse du visiteur. Une panne Brevo laisse le message disponible dans `/admin/messages` et le formulaire signale que la notification email est indisponible. Une confirmation Brevo indique une acceptation par le fournisseur, pas une livraison garantie en boîte de réception.

La réception BO et les accès directs à la table sont réservés aux administrateurs du club et au super-admin. Les visiteurs, membres et managers ne peuvent pas lire les messages. Seul le service role écrit ; les requêtes publiques passent par la fonction.

## Configuration

Secrets serveur Supabase, dans Edge Functions → Secrets :

- `BREVO_API_KEY` : valeur complète d’une clé créée dans Brevo → SMTP & API → Clés API. Laisser l’option « Créer une clé API de serveur MCP » désactivée : les clés SMTP et MCP ne conviennent pas.
- `CONTACT_FROM_EMAIL` : expéditeur validé sur le domaine `feelike.pro`.
- `CONTACT_IP_SALT` : secret aléatoire stable utilisé pour hacher les IP avant comptage.

Ces secrets ne doivent jamais être préfixés par `VITE_`. Le fichier `.env.local` du dépôt principal sert à leur préparation locale ; les fonctions déployées lisent les secrets du projet Supabase. Les fichiers locaux BO et vitrine du worktree ne contiennent que les variables publiques de dev.

## Installation

Vérifier explicitement le projet ciblé avant chaque opération. Projet de développement : `hnhsmefrcihpnkxbrxmr` (DEV - club management).

```sh
supabase link --project-ref hnhsmefrcihpnkxbrxmr
supabase db push --dry-run
supabase db push
supabase functions deploy contact-form --project-ref hnhsmefrcihpnkxbrxmr --use-api
```

La nouvelle migration est `2026091102_contact_messages.sql`. `supabase/config.toml` désactive la vérification JWT uniquement pour `contact-form` : le visiteur est anonyme. La fonction assure validation, honeypot, club actif et limitation par IP hachée. Le comptage puis l’insertion sont deux requêtes : ce mécanisme n’est pas une limite atomique contre des requêtes simultanées. En l’absence du secret de hachage, la fonction refuse l’envoi. Une erreur du comptage bloque temporairement le formulaire.

## État de validation sur dev

- Migration appliquée et fonction déployée le 11 septembre 2026.
- Présence et concordance des trois secrets locaux/dev vérifiées sans exposer leur contenu.
- Destinataire CAC confirmé dans la configuration publique de dev.
- Appels réels sans écriture : OPTIONS 204, honeypot 200, corps malformé 400.
- 48 tests de sécurité et 40 tests vitrine réussis, dont interactions du formulaire, double clic, erreurs réseau, notification indisponible et destinataire issu du club.
- Builds BO et vitrine réussis ; vérification du bundle Vercel réussie.
- Aperçu local : `http://127.0.0.1:5181/contact`.
- Vérification visuelle automatisée indisponible : le service Computer Use ne démarre pas. Le rendu HTTP et les interactions DOM ont été vérifiés.
- Aucun email réel envoyé à ce stade. Dernière vérification Brevo : HTTP 401 `Key not found`, la clé fournie est une version MCP ; remplacement par une clé API classique attendu.
- Aucun déploiement Vercel ni changement du projet Supabase de production dans cette livraison.

Le passage général des URLs de la plateforme de `feelike.app` à `feelike.pro` reste distinct du formulaire : les règles de tenant et les URL canoniques existantes sont conservées dans cette branche. L’expéditeur Brevo est configurable et utilise le domaine acheté.
