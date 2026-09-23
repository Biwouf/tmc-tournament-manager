# Emails aux couleurs du club

Les notifications du formulaire de contact, les alertes de cours et les emails Auth utilisent le même
rendu (`supabase/functions/_shared/email-template.ts`) : logo public HTTPS, nom du
club, liseré et bouton dans `brand.color`, texte du bouton contrasté, version texte
et lien de secours. Les contenus dynamiques sont échappés. Sans couleur valide,
un bleu-gris neutre est utilisé ; sans logo public HTTPS, le nom reste affiché.

## Identité du club

- Cours : `club_id` lu dans le job réclamé de `course_email_deliveries`, puis
  configuration du club. Le titre et le corps enregistrés restent inchangés,
  y compris le nom du demandeur et tout détail ajouté par les migrations métier.
- Contact : club validé par la fonction, configuration déjà lue côté serveur.
- Auth : domaine `app-<slug>.feelike.pro` du `redirect_to` signé par Supabase,
  puis lecture du club actif et de ses paramètres en base.
- Alias techniques ou domaines personnalisés : mapping serveur explicite
  `AUTH_EMAIL_HOST_CLUBS`, objet JSON `{"preview.example.com":"slug-du-club"}`.
  Ne renseigner que des domaines contrôlés et autorisés dans Supabase Auth.
- Développement local : la PWA transmet le slug de son `ClubContext` dans
  `redirect_to`, par exemple `/reset-password?club_slug=tc-moissac`. Le hook ne
  le prend en compte que pour une origine locale déclarée explicitement dans
  `AUTH_EMAIL_DYNAMIC_ORIGINS` (tableau JSON, exemple `["http://localhost:5173"]`).
  Changer `VITE_DEV_CLUB_SLUG` change donc le club du prochain mail sans modifier
  les secrets Supabase. Le hook vérifie que ce club existe et est actif, puis lit
  son nom, son logo et sa couleur en base. Ce paramètre ne confère aucun droit.
  Une origine dynamique ignore les anciens alias fixes, même en l'absence de slug.
  Le port est significatif ; HTTP reste limité aux adresses de boucle locale.
- Back-office central `admin.feelike.pro`, origine locale non configurée, slug
  absent/invalide, club absent/suspendu ou domaine inconnu : identité neutre Feelike.
  Le domaine `app-<slug>.feelike.pro` prime sur tout paramètre `club_slug`.
  Ne jamais deviner un club à partir de l'email ou des métadonnées du destinataire.

L'inscription reste sans confirmation email comme actuellement. Le modèle de
confirmation est prêt si cette option est activée ultérieurement. Récupération,
invitation, lien magique, changement d'adresse (y compris double confirmation),
réauthentification par code et notifications de sécurité partagent l'habillage.

## Activation distante (DEV d'abord)

Le code seul ne modifie pas les emails du projet hébergé. Le hook **remplace**
l'envoi SMTP Auth : il utilise l'API Brevo existante, et non les templates du
Dashboard. Le SMTP reste disponible pour revenir au fonctionnement précédent.

1. Déployer `contact-form`, `course-email-dispatch` et `send-auth-email` sur le projet DEV.
2. Configurer `BREVO_API_KEY`, `AUTH_FROM_EMAIL` (ou `CONTACT_FROM_EMAIL` en repli)
   avec un expéditeur Brevo validé. Garder ces secrets côté serveur uniquement.
3. Dans Supabase Authentication → Hooks, préparer un **Send Email Hook** HTTP
   vers `https://<project-ref>.supabase.co/functions/v1/send-auth-email`.
   Récupérer son secret et le définir comme `SEND_EMAIL_HOOK_SECRET` dans les
   secrets Edge Functions avant d'activer le hook.
4. Ajouter les alias nécessaires à `AUTH_EMAIL_HOST_CLUBS` et, sur DEV uniquement,
   les origines locales à `AUTH_EMAIL_DYNAMIC_ORIGINS`. Conserver la liste
   précise des redirections autorisées et les protections Auth existantes.
5. Désactiver le suivi/réécriture des liens Auth chez Brevo.
6. Avec des comptes de recette autorisés, contrôler la réception et l'ouverture
   d'une récupération PWA, d'une récupération BO central, d'une invitation et
   des deux confirmations de changement d'adresse. Vérifier mobile et desktop
   dans les clients email utilisés. Contrôler aussi le formulaire de contact.
   Vérifier aussi une demande de cours, une acceptation et un refus. Les alertes
   de cours gardent leur cron, leur secret dédié et leur vérification JWT ; elles
   ne passent pas par le hook Auth (voir [COURSE_EMAIL.md](COURSE_EMAIL.md)).
7. Reproduire la configuration en production après validation DEV.

Le webhook n'accepte que POST et vérifie la signature Standard Webhooks avant
les lectures en base ou l'envoi. Une panne Brevo est remontée à Supabase Auth ;
aucun token ni payload n'est journalisé. L'absence de JWT sur cette fonction est
volontaire : sa protection est la signature du hook, pas une session utilisateur.

Retour arrière Auth : désactiver le Send Email Hook pour reprendre le SMTP et les
modèles du Dashboard. Les notifications de contact restent indépendantes.

## Vérification locale

`npm run test:emails` (Node 22.19+) couvre le rendu, l'échappement, le contraste,
la résolution du club, les liens Auth, le mapping des deux confirmations et les
handlers avec doubles API. Les tests de handler doublent la bibliothèque de
signature : une recette avec le vrai webhook Supabase reste nécessaire.
Aucun email réel n'est envoyé par ces tests.

## Sources

- [Supabase Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
- [Brevo Send a transactional email](https://developers.brevo.com/reference/send-transac-email)

## Recette locale multi-club sur DEV

Configurer `AUTH_EMAIL_DYNAMIC_ORIGINS=["http://localhost:5173"]`, déployer
`send-auth-email` et lancer la PWA mise à jour depuis cette branche. L'ancien
mapping fixe de localhost vers CAC dans `AUTH_EMAIL_HOST_CLUBS` n'est plus nécessaire.
Passer `VITE_DEV_CLUB_SLUG` de `cac-tennis` à `tc-moissac`, redémarrer Vite après la
modification de son environnement et demander un nouveau mail. Le nom, le logo
et la couleur doivent suivre le club de la PWA. Les anciennes versions de la PWA
qui ne transmettent pas le slug produisent un mail neutre, jamais celui du précédent club.

La couleur CAC précédemment vide a été renseignée explicitement à `#e51828` sur
DEV ; les autres clubs conservent leurs propres paramètres. Aucune modification
production et aucun email réel ne sont effectués par les tests automatisés.
