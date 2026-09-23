# Récupération de compte — Supabase Auth et Brevo

## Livraison applicative

Le back-office et la PWA proposent `/forgot-password` depuis la connexion et
`/reset-password` pour choisir le nouveau mot de passe. La demande appelle
`resetPasswordForEmail` avec une redirection sur l'origine de l'application courante.
La réponse de succès ne révèle pas si le compte existe. Une erreur réseau ou de
quota conserve le formulaire et permet de réessayer.

Le client écoute `PASSWORD_RECOVERY` dès sa création, avant le montage de React.
Un marqueur temporaire par onglet permet de recharger le formulaire sans perdre
le parcours. Il ne contient aucun token. Il expire après une heure et disparaît
après succès, déconnexion, changement d'utilisateur ou ouverture d'un nouveau lien.
Une session ordinaire ne suffit pas à activer ce formulaire ; un lien en erreur
ne retombe pas sur une ancienne session. Supabase reste responsable de la validation
réelle des tokens, des sessions et de la politique de mot de passe.

La saisie demande au moins 8 caractères et une confirmation. Après succès, l'utilisateur
reste connecté et peut poursuivre vers son espace (`/` en BO, `/cours` en PWA).
La configuration Auth du serveur peut imposer des exigences supplémentaires.
Le mot de passe est celui du compte Supabase, commun aux applications/clubs du même projet.

## Configuration distante indispensable

La clé `BREVO_API_KEY` du formulaire de contact ne configure pas l'envoi de Supabase Auth.
Le fournisseur intégré Supabase est limité à 2 emails par heure. Avec un SMTP personnalisé,
la documentation annonce un plafond initial de 30 emails par heure, modifiable dans les
réglages Auth. Cela ne supprime ni les protections anti-abus ni les quotas Brevo.

Commencer sur **DEV - club management**, référence `hnhsmefrcihpnkxbrxmr`.
Le SMTP du projet dev a été configuré par l’utilisateur ; la production reste à configurer séparément.

1. Dans Brevo → SMTP & API → SMTP, récupérer l'identifiant SMTP et une clé SMTP.
   Ne pas utiliser la clé API REST ou MCP et ne pas placer ces identifiants dans une
   variable `VITE_`, un fichier versionné ou une capture d'écran.
2. Dans Supabase → Authentication → configuration SMTP, activer le SMTP personnalisé :
   - Hôte : `smtp-relay.brevo.com`.
   - Port : `587` (connexion STARTTLS).
   - Identifiant : identifiant SMTP fourni par Brevo.
   - Mot de passe : clé SMTP Brevo.
   - Expéditeur : `contact@feelike.pro`, déjà validé selon `CONTACT_DELIVERY.md`.
   - Nom d'expéditeur proposé : `Feelike` (configuration commune au projet Auth).
3. Vérifier dans Auth → Rate Limits le plafond d'emails effectivement appliqué.
   Commencer avec 30/h pour la recette et ajuster au volume attendu et au quota Brevo.
   Conserver le délai de protection entre demandes pour une même adresse.
4. Dans Auth → URL Configuration, autoriser les URLs exactes de récupération :
   `https://<domaine-back-office>/reset-password` et
   `https://<domaine-pwa>/reset-password`, pour chaque domaine de club concerné.
   En dev uniquement, ajouter les origines locales utilisées. Ne pas compter sur
   le Site URL de repli : il peut conduire vers une autre application.
5. Personnaliser le modèle Supabase « Reset Password » en français en conservant
   le lien `{{ .ConfirmationURL }}`. Le modèle doit inviter à choisir un nouveau
   mot de passe et préciser d'ignorer l'email si la demande n'est pas à l'origine
   du destinataire. Désactiver la réécriture/le suivi des liens chez le fournisseur.
6. Le SMTP personnalisé s'applique aussi aux autres emails Auth, dont les invitations :
   contrôler que leur modèle et leur redirection `/accept-invite` fonctionnent toujours.

Le lien doit être ouvert dans un navigateur ; il n'est pas nécessaire que ce soit
celui qui a demandé la récupération (flux implicite actuel). L'écran fonctionne
également dans la PWA installée si le système y ouvre le lien. Si le stockage de
session est indisponible, la continuité après rechargement n'est pas garantie :
le parcours en mémoire reste disponible.

## Recette avant déploiement

- Lancer `npm run test:password-recovery` après installation des dépendances BO/PWA.
- Compiler BO et PWA.
- Sur dev, demander un email pour un compte de test autorisé, ouvrir le lien,
  saisir un nouveau mot de passe puis vérifier la connexion avec ce mot de passe.
- Répéter depuis l'autre application et tester l'ouverture dans un autre navigateur.
- Tester un lien expiré/réutilisé et un lien invalide avec une session déjà présente.
- Vérifier une invitation et les redirections des domaines concernés.
- Contrôler l'acceptation puis la livraison dans Brevo : une réponse SMTP positive
  n'est pas une preuve de réception en boîte de réception.

Aucun email réel n'a été envoyé et aucun mot de passe distant n'a été modifié pour
les tests automatisés. L’utilisateur a confirmé le fonctionnement de l’envoi réel sur dev après correction du port SMTP en 587.

## Références

- [Supabase : SMTP personnalisé](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase : limites Auth](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase : récupération de mot de passe](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Brevo : relais SMTP](https://developers.brevo.com/docs/smtp-integration)

## Vérifications effectuées le 13 septembre 2026

- 8 tests automatisés réussis (4 scénarios sur chacune des deux applications).
- Builds back-office et PWA réussis ; avertissements de taille des bundles.
- TypeScript et lint des fichiers applicatifs modifiés réussis.
- Contrôle visuel et accès aux réglages distants indisponibles : le service
  Computer Use ne démarre pas dans cette session.
- Configuration SMTP et recette par email réel encore à effectuer.

## Validation dev du 15 septembre 2026 et passage en production

- L’utilisateur a confirmé que l’envoi fonctionne après remplacement du port 584
  par 587. La configuration du projet prod reste indépendante de celle du dev.
- L’email reçu passe SPF, DKIM (domaine feelike.pro) et DMARC, selon les résultats
  Gmail fournis. Le classement en spam reste possible. Le message de confirmation
  rappelle : « Pensez à vérifier vos spams. »
- L’interface signale une attente prolongée après 10 secondes et distingue quota,
  expiration du délai serveur et erreur serveur. Les diagnostics console ne
  contiennent que le statut et le code d’erreur, sans email ni token.
- Les tests couvrent aussi les réponses 500 et 504 ; TypeScript et lint validés.
- Avant activation en production : configurer le SMTP, vérifier le quota Auth,
  déclarer les URLs HTTPS exactes des applications de production et conserver
  les URLs d’invitation. Déployer les écrans avant la recette réelle.
- Aucune migration SQL ni Edge Function supplémentaire n’est nécessaire.

## Habillage des emails par club

Voir [Emails aux couleurs du club](CLUB_EMAILS.md) pour le modèle partagé et son
activation. Une fois le Send Email Hook activé, les étapes SMTP/templates ci-dessus
servent au retour arrière ; les emails Auth passent par le hook et l'API Brevo.
