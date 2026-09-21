# PR13 — Domaines feelike.pro

## État et périmètre

**Code préparé ; mise en service OVH/Vercel non effectuée.** Domaine confirmé par le
propriétaire le 16 septembre 2026 : `feelike.pro`. Les références à `feelike.app` dans
les migrations historiques sont seulement des commentaires et restent inchangées.
Aucune migration SQL ni nouvelle Edge Function dans cette PR.

| Adresse | Projet / comportement |
|---|---|
| `admin.feelike.pro` | Projet BO existant, domaine exact ; connexion puis choix du club |
| `<slug>.feelike.pro` | Projet vitrine `web/`, domaine `*.feelike.pro`, SSR par club |
| `app-<slug>.feelike.pro` | Même wildcard, réécriture vers l’origine technique du projet PWA |

Un wildcard ne peut pas être attaché simultanément aux deux projets. Le build de la
vitrine ajoute donc une route **avant** les assets et le SSR, conditionnée par l’hôte
`app-<slug>.feelike.pro`. Elle transmet le chemin au projet PWA sans redirection : le
navigateur conserve son origine par club (session, manifest, service worker, liens).
`admin.feelike.pro` est attaché directement au BO ; sa correspondance exacte prime
sur le wildcard de la vitrine. `app-*`, `admin`, `www`, `api`, `app` restent réservés.

Le domaine racine et `www` ne reçoivent pas de nouvelle page marketing dans cette PR.
Les domaines de clubs, dont `tennisclubcastelsarrasin.fr`, sont le chantier **PR14**.

## Code et accès

- BO central : seules les appartenances de l’utilisateur à des clubs actifs sont proposées.
  La sélection est conservée en sessionStorage par compte. Changer de club démonte les
  écrans métier et revient à l’accueil. Les gardes de rôle et la RLS restent appliquées.
- Le super-admin peut ouvrir la console sans être membre d’un club, y compris pour créer
  le premier. Le diagnostic d’un club suspendu est un mode support explicite.
- Invitations et récupération du mot de passe sont accessibles avant le choix d’un club.
- PWA : seul `app-<slug>.feelike.pro` résout un club en production. Hôte inconnu, slug
  réservé ou club suspendu : écran neutre, aucun contenu ni formulaire métier monté.
- Erreur de lecture réseau/DB : message temporaire et bouton Réessayer ; jamais repli CAC.
- Vitrine : 404 pour club/page indisponible, 503 pour erreur technique ; page autonome
  lisible sans JavaScript, pas de marque CAC, pas de cache, pas d’indexation.
- Développement : localhost + `VITE_DEV_CLUB_SLUG` explicite. Alias techniques BO/PWA :
  les hôtes exacts `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`
  sont injectés au build ; `VITE_ALLOWED_HOSTS` permet d’ajouter des alias exacts.
  Aucun repli générique sur `.vercel.app`. Le slug de dev reste nécessaire sur ces alias.

## Préparer les déploiements avant de changer les DNS

1. Identifier les trois projets Vercel existants et leurs origines de production.
   Relever l’origine **du projet PWA**, sans la confondre avec la vitrine.
2. Vérifier les variables Supabase de chaque environnement. Sur BO/PWA, conserver
   `VITE_DEV_CLUB_SLUG=cac-tennis` pour les alias techniques existants et activer
   l’exposition des variables système Vercel. Ajouter si besoin les alias historiques
   exacts dans `VITE_ALLOWED_HOSTS`, puis rebuild. Les previews utilisent la base dev.
3. Sur le projet vitrine, définir **`PWA_ORIGIN=https://<projet-pwa>.vercel.app`**, puis
   rebuild. La valeur doit être une origine HTTPS `.vercel.app` sans chemin, secret,
   port ni paramètres ; elle ne doit pas désigner la vitrine (boucle de proxy).
   Vérifier que cette origine sert la PWA publiquement sans protection de déploiement.
   La variable est propre à l’environnement : ne pas diriger une preview vers la prod.
   Sans variable, le build historique vitrine reste possible mais le wildcard PWA
   **n’est pas opérationnel**. Ne pas activer le wildcard dans cet état.
4. Rattacher `admin.feelike.pro` au projet BO, `*.feelike.pro` au projet vitrine.
   Ne pas créer `app-*.feelike.pro` comme un second wildcard : ce n’est pas un wildcard DNS.
5. Dans Supabase Auth, configurer l’origine BO comme Site URL et ajouter les retours
   `https://admin.feelike.pro/**` et `https://app-*.feelike.pro/**` aux Redirect URLs.
   Garder les retours des déploiements existants durant la transition. Vérifier une
   invitation depuis la console et une récupération BO/PWA. Les paramètres CORS et
   retours des intégrations doivent couvrir les nouvelles origines si une allowlist
   a été configurée hors du dépôt.

## OVH : conserver les emails et les autres services

Lecture DNS publique du 16/09/2026 : NS `dns200.anycast.me` / `ns200.anycast.me`,
MX OVH `mx1.mail.ovh.net` (1), `mx2.mail.ovh.net` (5), `mx3.mail.ovh.net` (100).
L’apex résout vers `213.186.33.5` ; `admin.feelike.pro` n’a pas de réponse A lors du contrôle.
Cette lecture n’est **pas** un export complet de zone : les sélecteurs DKIM, sous-domaines
et autres enregistrements doivent être inventoriés depuis OVH.

La procédure standard Vercel impose ses nameservers pour le certificat wildcard.
**Le domaine reste acheté/renouvelé chez OVH et les boîtes mail restent chez OVH.** Seule
la gestion DNS change. Avant une bascule des NS :

1. Exporter la zone OVH complète et noter la configuration DNSSEC/DS et les TTL.
2. Préparer la zone Vercel et recopier les enregistrements à conserver : MX, SPF, DKIM,
   DMARC, Brevo, vérifications, sous-domaines et services existants. Préserver les
   entrées apex/`www` existantes tant qu’aucune nouvelle destination n’est décidée.
3. Comparer les réponses des serveurs autoritaires Vercel avec la zone OVH avant bascule.
   Traiter DNSSEC avec la procédure fournisseur pour éviter un DS obsolète / SERVFAIL.
4. Dans OVH, remplacer les NS par les valeurs **affichées par Vercel** pour ce domaine.
   Conserver l’export et la zone OVH pour retour arrière.
5. Attendre la validation Vercel et l’émission HTTPS ; contrôler aussi l’envoi/réception
   mail OVH et les validations Brevo. Ne pas se contenter de voir le site charger.

Si la gestion DNS doit impérativement rester chez OVH, arrêter avant la bascule : il faut
valider une autre stratégie avec Vercel. Des domaines exacts configurés manuellement
permettent un premier test, mais ne remplissent pas le critère « nouveau club sans action Vercel ».

## Recette de mise en service

- CAC : vitrine, PWA, connexion BO, choix du club, création/modification d’un contenu.
- Deuxième club de test : accessible sur vitrine et PWA immédiatement après création,
  sans ajouter de domaine dans Vercel ; identité et contenus distincts.
- Hôte inconnu : pas de CAC en repli. Club suspendu : pas de contenu actif ; accès support
  super-admin explicite. Une panne Supabase reste une panne temporaire.
- PWA derrière le wildcard : `/`, une route profonde, `/assets/...`, `/sw.js` et le manifest
  servent bien le projet PWA, jamais le SSR vitrine. Tester installation puis mise à jour
  du service worker sur deux origines de clubs ; le changement d’origine ne migre pas
  une ancienne installation `.vercel.app` (la réinstaller depuis la nouvelle URL).
- BO : compte multi-clubs, compte sans club, compte membre, console super-admin,
  invitation, récupération de mot de passe et déconnexion/reconnexion avec un autre compte.
- Vérifier 404/503, canonical et sitemap de la vitrine sur les adresses de production.

Tests locaux : `npm run test:domains`, `npm run test:security`,
`npm run test:password-recovery`, `npm --prefix web test`, builds BO/PWA/web et
`npm --prefix web run check:build`. Ils ne remplacent pas la recette DNS/TLS/Auth réelle.

Validation locale : trois builds et contrôle du bundle Vercel réussis ; tests domaines,
vitrine, sécurité et récupération de compte réussis. Rendu de l’écran indisponible
contrôlé dans le navigateur. Le lint ciblé des nouveaux composants passe ;
`ClubContext.tsx` conserve les trois erreurs Fast Refresh déjà présentes sur la base
(exports de fonctions/hook avec le provider), vérifiées par comparaison avec HEAD.

## Retour arrière

Ne pas toucher aux données. Revenir aux déploiements précédents et à leurs alias exacts,
conserver les Redirect URLs précédentes. Si la délégation DNS a été changée, restaurer
les NS/configuration DNSSEC OVH sauvegardés ; prévoir le délai de propagation. Restaurer
le seul code sans revenir sur les domaines ne suffit pas : l’ancien code attendait `.app`.

## Références officielles consultées

- [Wildcard et certificats Vercel](https://vercel.com/docs/domains/working-with-domains)
- [Plusieurs projets et une origine](https://vercel.com/kb/guide/how-can-i-serve-multiple-projects-under-a-single-domain)
- [Routes de la Build Output API](https://vercel.com/docs/build-output-api/configuration)
- [Conserver les enregistrements DNS](https://vercel.com/docs/domains/working-with-domains/add-a-domain)


## Retrait de l’ancienne adresse PWA

Après migration de `web` vers `PWA_ORIGIN=https://pwa-cac-tennis.vercel.app`
et redéploiement Production, `pwa/vercel.json` redirige uniquement l’hôte
`tmc-tournament-manager-tau.vercel.app` vers `https://app-cac-tennis.feelike.pro`
en 308. La règle précède les fichiers statiques et le fallback SPA ; chemins et
paramètres de requête sont conservés par le routage Vercel.

Ne pas rediriger `pwa-cac-tennis.vercel.app` : cette origine sert le proxy de tous
les clubs. Les previews et les hôtes `app-<slug>.feelike.pro` ne sont pas concernés.
Aucune migration d’installation n’est prévue : aucun parc installé n’a été signalé.

Recette après déploiement : vérifier `/`, `/cours?source=legacy`,
`/reset-password?code=test` et `/manifest.webmanifest` sur l’ancien domaine,
puis `/cours`, `/sw.js` et le manifest sur la nouvelle origine et l’origine technique.
