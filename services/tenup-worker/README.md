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
Il n’a aucun accès Supabase et n’utilise ni login ni mot de passe FFT.

## Mise en service

1. Appliquer `supabase/migrations/2026092901_tenup_sync.sql` après les migrations existantes.
2. Héberger le worker sur un serveur capable de lancer Chromium, derrière HTTPS.
   Le Dockerfile est fourni ; utiliser un utilisateur non root et le profil seccomp
   recommandé par [Playwright](https://playwright.dev/docs/docker#crawling-and-scraping)
   pour conserver le sandbox Chromium. Restreindre le réseau sortant aux destinations
   Ten’Up et Queue-it, sans accès au réseau privé ni aux métadonnées de l’hébergeur.
3. Configurer `TENUP_WORKER_URL` (origine HTTPS du worker) et `TENUP_WORKER_TOKEN`
   dans les secrets de la fonction Supabase. Le jeton doit correspondre à celui du worker.
4. Déployer la fonction `tenup-sync`, puis le BO et la PWA. Les interfaces fonctionnent
   sans variables VITE supplémentaires. Sans worker configuré, le message indique que
   la synchronisation n’est pas disponible et la saisie manuelle reste utilisable.
5. Vérifier une feuille réelle depuis le réseau d’hébergement : Queue-it peut avoir
   un comportement différent selon l’adresse IP. Aucun déploiement distant n’est
   effectué par la simple création de ce code.

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

Depuis la racine : `npm run test:tenup`, `npm run test:team-matches`, `npm run build`,
puis `npm --prefix pwa run build`. Installer aussi les dépendances du worker avant
`test:tenup`. Les tests ne contactent ni Ten’Up ni Supabase distant. L’extraction
réelle peut être testée séparément avec `node smoke.mjs URL_DE_LA_RENCONTRE` depuis
ce dossier ; ce script ne conserve que date, nombre de matchs et score dans sa sortie.

Validation de développement : extraction réelle réussie le 29/09/2026 sur la rencontre
9832770 (27/09/2026, quatre matchs, 3–1), sans authentification FFT. Tests SQL
dans PGlite, tests du composant partagé et de la fonction Edge, rendu mobile 390 px,
builds BO/PWA et build PWA isolé de la racine vérifiés. L’environnement d’hébergement
du worker devra également être validé lors de sa mise en service.
