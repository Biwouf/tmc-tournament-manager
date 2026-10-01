# Synchronisation Ten’Up

Le BO et la PWA appellent la fonction Supabase `tenup-sync` pour préparer un aperçu.
Cette fonction vérifie la session, puis appelle `team_tenup_begin` avec le JWT du
membre (club actif, appartenance, quota, révision et lien). Le worker ouvre seulement
la feuille publique demandée et retourne sa lecture du DOM. La fonction conserve
ce résultat côté serveur, valable 15 minutes. Le navigateur utilisateur ne reçoit
aucun secret et ne peut pas modifier le contenu qui sera importé.

`team_tenup_apply(preview_id, side)` consomme cet aperçu avec la session utilisateur.
L’équipe 0 est la première de la feuille, l’équipe 1 la seconde. L’utilisateur doit
explicitement choisir son équipe et vérifier les deux clubs et la date dans l’aperçu.
L’association est ensuite fixe et unique par club. Le serveur compare la date locale
Europe/Paris, le format, les places, les scores et le barème. Tout le lot est atomique.
Les résultats existants, les matchs liés au Live et les compositions différentes sont
conservés. Une modification concurrente invalide l’aperçu. La réponse perdue peut être
redemandée avec le même identifiant sans double import. Un import complet confirme la
rencontre ; un import partiel laisse la vérification habituelle aux membres.

## Lancer en local

Node 22 ou ultérieur ; `npm ci` dans ce dossier puis `npx playwright install chromium`.
Définir `TENUP_WORKER_TOKEN` avec un secret aléatoire d’au moins 32 caractères dans
l’environnement du processus, puis `npm start`. Le serveur écoute sur 127.0.0.1:8788.
Le jeton est exigé dans `Authorization: Bearer …`, y compris pour les tests HTTP.
Le serveur accepte uniquement `POST /extract` avec `{"url":"https://tenup.fft.fr/…"}`.
Le préremplissage des compétitions utilise le même endpoint avec
`{"kind":"competition","url":"https://tenup.fft.fr/championnat/82678463"}`.
Le worker lit la fiche publique du championnat (nom, composition, points par match,
règles des sets), sans importer les équipes, le calendrier ou les résultats.
La fonction Supabase conserve le lien original avec ses filtres de poule, mais
transmet au worker le lien du championnat sans filtres. Les paramètres non reconnus
restent à choisir manuellement dans le formulaire avant enregistrement.

Il n’a aucun accès Supabase et n’utilise ni login ni mot de passe FFT.

## Mise en service

1. Appliquer `supabase/migrations/2026092901_tenup_sync.sql`, puis
   `supabase/migrations/2026100101_admin_competitions.sql` après les migrations existantes.
   Cette dernière ouvre les noms libres et réserve le préremplissage aux administrateurs
   et managers du club, avec un maximum de trois demandes par minute et par utilisateur.
2. Héberger le worker sur un serveur capable de lancer Chromium, derrière HTTPS.
   Le Dockerfile est fourni ; utiliser un utilisateur non root et le profil seccomp
   recommandé par [Playwright](https://playwright.dev/docs/docker#crawling-and-scraping)
   pour conserver le sandbox Chromium. Restreindre le réseau sortant aux destinations
   Ten’Up et Queue-it, sans accès au réseau privé ni aux métadonnées de l’hébergeur.
3. Configurer `TENUP_WORKER_URL` (URL HTTPS du worker) et `TENUP_WORKER_TOKEN`
   dans les secrets de la fonction Supabase. Le jeton doit correspondre à celui du worker.
4. Déployer la fonction `tenup-sync`, puis le BO et la PWA. Les interfaces fonctionnent
   sans variables VITE supplémentaires. Sans worker configuré, le message indique que
   la synchronisation n’est pas disponible et la saisie manuelle reste utilisable.
5. Vérifier une feuille réelle depuis le réseau d’hébergement : Queue-it peut avoir
   un comportement différent selon l’adresse IP. Aucun déploiement distant n’est
   effectué par la simple création de ce code.

## Connexion Supabase à Vercel

Pour Vercel, configurer dans les secrets Supabase l’endpoint direct stable :

```text
TENUP_WORKER_URL=https://tmc-tenup-worker-check.vercel.app/api/extract
```

La fonction respecte maintenant le chemin explicite de `TENUP_WORKER_URL`.
Une origine seule conserve le chemin `/extract` pour le worker autonome.
Le raccourci `/extract` du déploiement Vercel du 30 septembre renvoie 405 ;
`/api/extract` appelle correctement la fonction. L’endpoint direct évite cette
réécriture sans nécessiter un nouveau déploiement du worker.

Pour un projet protégé par Vercel Authentication :

1. Dans Vercel → projet worker → Settings → Deployment Protection →
   Protection Bypass for Automation, créer un secret dédié à Supabase.
2. Dans Supabase → Edge Functions → Secrets, enregistrer sa valeur sous
   `TENUP_WORKER_BYPASS_TOKEN`. Ne pas modifier `TENUP_WORKER_TOKEN` : ce dernier
   reste le secret d’authentification du worker lui-même.
3. Redéployer `tenup-sync` depuis la racine du worktree :
   `supabase functions deploy tenup-sync --project-ref REF_DU_PROJET`.

La fonction transmet le bypass dans l’en-tête `x-vercel-protection-bypass`,
uniquement au worker configuré, après contrôle de la session et des droits.
Aucun de ces secrets n’est renvoyé au navigateur. Le bypass est facultatif pour
un hébergement sans protection Vercel. Les secrets fournis par le client sont ignorés.

Documentation : [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

## Limites explicites de cette première version

- Feuilles complètes de matchs terminés normalement, dans les formats existants du club.
  Les WO, abandons, feuilles partielles et formats inconnus sont refusés ; aucune
  interprétation approximative ni contournement de CAPTCHA/file d’attente.
- La règle du troisième set des simples doit être configurée dans la compétition.
- En double, Ten’Up affiche des poids : le classement individuel est repris des simples
  pour la même personne, ou affiché « Non renseigné ». Aucun membre interne n’est
  automatiquement associé sur la seule base de son nom.
- Cache serveur de 60 secondes, une extraction à la fois par worker, trois demandes
  par minute et par utilisateur. La lecture expire en moins de 50 secondes.
- Les aperçus de plus d’un jour sont purgés lors de la prochaine demande du même
  utilisateur. Le quota compte aussi les échecs, pour éviter les rafales de requêtes.
- Le résultat importé ne fabrique pas de suivi point par point. Les corrections d’un
  résultat déjà saisi restent dans le parcours manuel ; elles ne sont pas écrasées.

## Vérifications

Depuis la racine : `npm run test:competitions`, `npm run test:tenup`, `npm run test:team-matches`, `npm run build`,
puis `npm --prefix pwa run build`. Installer aussi les dépendances du worker avant
`test:tenup`. Les tests ne contactent ni Ten’Up ni Supabase distant. L’extraction
réelle peut être testée séparément avec `node smoke.mjs URL_DE_LA_RENCONTRE` depuis
ce dossier ; ce script ne conserve que date, nombre de matchs et score dans sa sortie.

Validation de développement : extraction réelle réussie le 29/09/2026 sur la rencontre
9832770 (27/09/2026, quatre matchs, 3–1), sans authentification FFT. Tests SQL
dans PGlite, tests du composant partagé et de la fonction Edge, rendu mobile 390 px,
builds BO/PWA et build PWA isolé de la racine vérifiés. L’environnement d’hébergement
du worker devra également être validé lors de sa mise en service.

## Option Vercel (test de lecture validé)

Le même dossier contient une fonction Node dans `api/extract.mjs`.
Utiliser son endpoint direct `/api/extract` pour la connexion Supabase. Chromium 153 est embarqué
avec `@sparticuz/chromium`, correspondant à la version majeure de Playwright 1.63.
Aucun téléchargement de navigateur depuis une URL fournie par l’utilisateur.

1. Créer un projet Vercel séparé pointant vers ce dépôt et la branche de travail.
   Root Directory : `services/tenup-worker`. Framework Preset : Other. Node.js : 22.x.
   Conserver les réglages de build du `vercel.json` de ce dossier.
2. Dans Settings → Environment Variables, ajouter `TENUP_WORKER_TOKEN`, un secret
   aléatoire d’au moins 32 caractères. Ne pas ajouter les secrets Supabase ou FFT.
3. Déployer le projet de test, puis appeler `POST https://ADRESSE-VERCEL/api/extract`
   avec le Bearer token et le corps JSON `{ "url": "URL_COMPLETE_RENCONTRE" }`.
   Si la protection Vercel du déploiement bloque cet appel, configurer son accès
   serveur-à-serveur avant de relier Supabase. Le token du worker reste obligatoire.
4. Vérifier la réponse réelle : rencontre 9832770, date 2026-09-27, quatre matchs,
   score `[3,1]`. Vérifier aussi un démarrage à froid, la durée totale (<50 secondes,
   délai actuel de Supabase), le refus sans jeton et le refus d’une autre URL.
5. Une fois ce test réussi, utiliser l’URL HTTPS complète terminée par `/api/extract` comme `TENUP_WORKER_URL`.
   OVH n’intervient pas : l’adresse technique Vercel suffit.

Cette option utilise l’isolation des fonctions Vercel : le Chromium serverless
fonctionne sans son sandbox propre. L’entrée Docker conserve son sandbox activé.
La liste des destinations réseau autorisées et le jeton sont communs aux deux modes.
Ne pas héberger d’autres secrets dans ce projet dédié. Le verrou et le cache sont
locaux à chaque instance Vercel, pas globaux ; le quota utilisateur reste dans Supabase.

La préparation locale ne constitue pas une validation depuis Vercel. Le navigateur
Linux serverless ne peut pas être exécuté directement sur macOS ; le test distant
reste nécessaire, notamment pour Queue-it et le temps de démarrage à froid.

### Redéploiement direct depuis le CLI

Le projet de test existant utilise `Root Directory = .`. Pour ce mode, envoyer
uniquement le dossier du worker, et non la racine de l’application :

```sh
vercel deploy --prod --cwd services/tenup-worker --project tmc-tenup-worker-check --scope biwoufs-projects
```

Exécuter cette commande depuis la racine du worktree contenant les modifications.
Le `vercel.json` du worker impose le preset Other (`framework: null`), la fonction
`api/extract.mjs` et la réécriture `/extract`. L’option `--project` sélectionne
explicitement le projet du worker sans dépendre du lien `.vercel` du dépôt parent.
Ne pas mélanger cette méthode avec un projet Git configuré avec
`Root Directory = services/tenup-worker` : ce dernier reçoit le dépôt complet.
Pour vérifier les fichiers sans publier, remplacer `--prod` par `--dry --json`.

### Test distant du 29 septembre 2026

Projet isolé `biwoufs-projects/tmc-tenup-worker-check`, Node 22, région `iad1`.
Déploiement de test :
https://vercel.com/biwoufs-projects/tmc-tenup-worker-check/FrNDBkjBzXmm6phUFkcJzo2vGeHf

- Premier appel authentifié après déploiement : HTTP 200, 7,95 s, date 2026-09-27,
  quatre matchs et score `[3,1]` pour la rencontre 9832770.
- Appel suivant : HTTP 200, 0,62 s (cache).
- URL hors Ten’Up : HTTP 400. Sans secret : HTTP 401 (vérifié sur le déploiement
  précédent du même adaptateur).
- Build Vercel réussi avec Chromium embarqué ; aucune donnée FFT d’authentification.
- Projet déconnecté de Git pour éviter les déploiements automatiques des applications.
- Protection Vercel maintenue : les essais utilisent `vercel curl` avec la session
  autorisée. Cette URL de preview n’est pas encore directement appelable par Supabase.

Le test valide la lecture depuis Vercel, pas l’import de bout en bout en production.
Aucune migration ou fonction Supabase distante ni application BO/PWA n’a été déployée.
Pour la mise en service, configurer un point d’entrée accessible à Supabase, conserver
le secret obligatoire, puis tester le parcours complet avec aperçu et confirmation.

## Ajouter une équipe et son calendrier

Le mode `pool` lit le lien complet de la poule (championnat + division + phase + poule), les identifiants des équipes et toutes les journées du sélecteur public Ten’Up. Il refuse les calendriers incomplets. Le nom du club aide à suggérer des équipes, mais l’administrateur choisit toujours l’équipe exacte et confirme l’aperçu.

Pour déployer cette évolution, depuis le worktree :

```sh
supabase db push --dry-run
supabase db push
vercel deploy --prod --cwd services/tenup-worker --project tmc-tenup-worker-check --scope biwoufs-projects
supabase functions deploy tenup-sync
```

La nouvelle migration est `2026100102_tenup_team_calendar.sql`. Déployer également le backoffice ; la PWA doit être reconstruite lorsqu’elle est publiée avec ces types. Les secrets existants restent valables.

La création atomique passe par `team_equipe_create`. Pour Ten’Up, le navigateur transmet l’identifiant d’un aperçu et d’une équipe ; le serveur utilise le calendrier sauvegardé depuis le worker. Les aperçus expirent après 15 minutes. Chaque équipe Ten’Up ne peut être ajoutée qu’une fois dans une compétition. Deux équipes du club peuvent partager une division, une poule, et même une rencontre : leur côté domicile/extérieur distingue leurs sources. Aucun résultat n’est importé à la création.

Le calendrier public donne des dates sans heures : la date est stockée à minuit Europe/Paris pour conserver le jour exact. L’aperçu indique que les heures doivent être précisées dans les rencontres. Une journée exempte crée une étape sans rencontre. La saisie manuelle des divisions et journées reste disponible.

Validation : `npm run test:team-calendar`, puis les suites compétitions/Ten’Up existantes.

Le lecteur de poule attend l’ouverture effective du menu après hydratation de la page, puis chaque journée complète (toutes ses cartes de rencontres). Le test `tests/tenup-pool-loading.test.mjs` simule ces délais dans Chromium. Les erreurs techniques d’extraction sont journalisées côté worker sans corps de requête ni variables d’environnement ; la réponse publique reste générique.

La migration `2026100103_team_numbers_not_unique.sql` autorise plusieurs équipes au même numéro dans une compétition, sans supprimer le contrôle de doublon sur l’identifiant Ten’Up. Ce correctif SQL ne nécessite pas de redéploiement du worker ou de `tenup-sync`.

Dans le backoffice, une seule équipe probable peut être présélectionnée depuis le nom ou la ville configurés du club ; l’administrateur confirme toujours le calendrier. La correspondance entre compétition et championnat est contrôlée par l’identifiant de son lien Ten’Up lorsqu’il est enregistré. Sans ce lien, le formulaire avertit que la correspondance n’est pas vérifiable. Ces ajustements de suggestion nécessitent seulement le déploiement du backoffice.
