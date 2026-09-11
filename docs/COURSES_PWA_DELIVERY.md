# Cours — livraison PWA et évolutions BO V2

Worktree : `/Users/m.tresalmauroz/Desktop/perso/tmc-courses-pwa-design`.
Branche : `codex/spec-courses-pwa-v2`, basée sur le BO `e27123a`.
Contrat métier : `docs/specs/COURSES_PWA_V2.md` (prioritaire sur les règles V1 remplacées).

## Fonctionnalités

- Quatrième onglet **Cours** : catalogue public du club, groupes par jour, pagination de 20,
  détail, quotas et image facultative du type. Thème issu de la configuration du club,
  disponible aussi avant connexion depuis la migration historique `20260909`.
- **Mes cours** et compteur global : demandes en attente et inscriptions confirmées,
  conservées après H−4 et pendant la séance, jusqu'à sa fin.
- Demande personnelle, confirmation serveur, désistement avant H−4, retour de connexion
  au cours sans inscription automatique. Une demande est possible même quota plein.
- **Mon profil** : prénom, nom, sexe ; révision commune avec les éditions BO. En cas de
  conflit, le formulaire exige une relecture explicite avant de reprendre la nouvelle révision.
- **Encadrement** : cours du responsable, ou tous les cours pour les admins, compteur
  global des demandes à traiter avant début. File bornée à 50, décision des demandes en
  attente, refus motivé obligatoire, consultation des décisions et annulation confirmée du cours.
- BO : responsable choisi parmi les membres, recherche paginée, badge de reprise pour
  les anciens cours sans responsable ; motif de refus obligatoire, y compris pour révoquer.
- Statuts et capacités relus après mutation, au retour au premier plan, manuellement et
  toutes les minutes. Horloge d'affichage recalée sur l'heure serveur ; contrôles de délai
  répétés en transaction. Pas de mutation optimiste ni de notifications email/push.

Les HTML de Claude restent une référence locale ignorée par Git : aucun runtime du
prototype, persona, horloge fictive ou image de démonstration n'est embarqué.

## Contrats SQL

Migrations additives : **`supabase/migrations/2026091002_courses_pwa.sql`**, puis
**`supabase/migrations/2026091101_course_owner_identity.sql`** (11 septembre).
Cette dernière supprime le champ libre du contrat client et dérive `owner_first_name`
du profil du responsable dans le BO et la PWA. Les anciennes valeurs `coach_name` restent
stockées, mais ne sont plus lues ni écrites par l'application.
La migration BO `2026091001_courses.sql` reste inchangée.

| RPC | Accès / rôle |
|---|---|
| `course_catalog(club, offset, target)` | Public, métadonnées et effectifs agrégés uniquement |
| `course_my_page(club, view, offset, target)` | Compte connecté, statuts propres ; `all`, `mine`, `manage` |
| `course_my_context(club)` | Profil propre, appartenance, compteurs globaux et capacité de gestion |
| `course_member_command(club, course, operation, revision, request_id)` | Membre du club, demande ou désistement propre |
| `course_save_my_profile(club, prenom, nom, sex, revision, request_id)` | Identité exclusivement issue de `auth.uid()` |
| `course_manage_queue(club, course, offset, filter)` | Responsable actuel ou admin, noms/quota/date/statut/motif uniquement |
| `course_manage_command(club, operation, data, request_id)` | Décision pending→approved/denied ou annulation du cours |
| `course_admin_command` / `course_admin_read` | BO admin, contrat V1 étendu avec `owner_id` |

Les paramètres SQL portent le préfixe `p_`. Les helpers internes sont privés, sans droit
EXECUTE client. BO et PWA gestion appellent le **même moteur de mutation** : droits,
révisions, quota, journal et clés de commande sont partagés. Verrou de club puis de cours,
contrôles après attente. Les commandes historiques BO gardent leur idempotence après migration.
Le retrait du membre met ses responsabilités à null et annule ses demandes futures actives.
Aucun GRANT d'écriture directe sur les profils ou les inscriptions n'est ouvert.

## Tester localement

La configuration `.env.local` de développement a été copiée dans ce worktree, à la racine
et dans `pwa/` ; elle reste ignorée et n'est pas affichée dans les journaux. Dépendances installées.

BO, dans un terminal :

```sh
cd /Users/m.tresalmauroz/Desktop/perso/tmc-courses-pwa-design
npm run dev -- --port 5173 --strictPort
```

PWA, dans un deuxième terminal :

```sh
cd /Users/m.tresalmauroz/Desktop/perso/tmc-courses-pwa-design/pwa
npm run dev -- --port 5174 --strictPort
```

Ouvrir `http://localhost:5174/cours`. Si un port est déjà occupé par un autre worktree,
arrêter ce serveur ou choisir un autre port explicitement. Le BO et la PWA ont des sessions
séparées par origine : se connecter dans chacun avec les comptes de test appropriés.
Les écrans de cours nécessitent les migrations ci-dessous sur le projet Supabase de dev.

## Migrations et déploiement (non exécutés)

1. Conserver le formulaire d'activation BO sans upsert de profil livré en V1.
2. Depuis **ce worktree**, vérifier le projet Supabase de développement et l'historique.
   Si besoin, lier le projet avec `supabase link --project-ref <référence-dev>`.
3. Exécuter :

   ```sh
   supabase migration list --workdir /Users/m.tresalmauroz/Desktop/perso/tmc-courses-pwa-design
   supabase db push --dry-run --workdir /Users/m.tresalmauroz/Desktop/perso/tmc-courses-pwa-design
   ```

   Le dry-run doit proposer les migrations restantes dans cet ordre : `2026091001`,
   `2026091002`, `2026091101`. Si les deux premières ont déjà été appliquées,
   seule **`2026091101`** doit apparaître.
   Si les anciennes migrations sont annoncées absentes localement, vérifier le workdir :
   ne pas marquer leur historique distant `reverted` pour contourner cette erreur.
4. Après contrôle du dry-run, appliquer avec `supabase db push --workdir` suivi du même
   chemin. Cette commande n'a pas été exécutée pendant le développement.
5. Livrer BO et PWA V2 ensemble avec la migration. Éviter les éditions BO pendant la
   transition : le BO V1 ne transmet pas encore le responsable désormais requis à la création.
6. Les cours historiques ont un responsable null : les admins peuvent le choisir dans
   Modifier. Aucun rapprochement automatique à partir du nom d'encadrant.

Ne pas supprimer les tables de cours pour revenir à une ancienne UI ; conserver les données
et le formulaire d'activation sécurisé. La durée de conservation reste à fixer avant lancement,
sans purge automatique dans ce lot.

## Vérifications et limites

- `npm run test:courses` : 28 tests SQL et React/DOM (V1 rejouée avec V2 + cas PWA).
- `npm run test:security` : 27 tests existants.
- `npm run test:pwa-network` : 4 tests de cache, session et réseau, dont thème public et
  vidage des données privées au changement de compte.
- `npm run test:courses:concurrency` : **exécuté avec succès** sur PostgreSQL 18 local
  et jetable, deux connexions, BO et PWA responsables en concurrence pour la dernière place.
  Le test attend la preuve du verrou inter-connexions ; exactement un succès, un QUOTA_FULL.
  Sans `COURSES_TEST_DATABASE_URL`, ce test est ignoré. Pour le rejouer, fournir une base
  locale **vide**, nom `courses_test*`, et le module `pg` via `COURSES_PG_CLIENT` si nécessaire.
- Builds BO/PWA et lint ciblé. Avertissement de taille des bundles conservé.
- La validation visuelle dans un navigateur reste à faire : le service local de pilotage
  du navigateur ne démarre pas. Les tests DOM ne prouvent pas le rendu mobile ni le comportement
  natif du dialogue. Recetter à 320/390/430 px : noms et motifs longs, thème/logo absent,
  clavier, focus de retour, safe areas et bannière d'installation.
- Aucun projet Supabase distant n'a été modifié par cette livraison. Les tests SQL utilisent
  un schéma minimal : ils ne constituent pas un rejeu complet des migrations historiques.

Recette dev prioritaire : connexion puis demande ; validation/refus par le responsable ;
réassignation par admin pendant que la file est ouverte ; changement de profil concurrent ;
états à H−4, pendant et après le cours ; quotas pleins ; désistement et annulation du cours.

## Améliorations BO du 11 septembre

Navigation commune aux écrans Cours, Types de cours et Membres : onglet actif, icônes,
libellés d'aide, accès à l'accueil et adaptation mobile. Titres, espacements des champs,
boutons, focus clavier et pagination harmonisés. Le formulaire ne demande plus d'encadrant
libre : choisir le responsable suffit. Les droits et actions des membres sont inchangés.
L'outil de contrôle visuel du navigateur reste indisponible lors de cette passe.

## Validation des inscriptions et recherche de membres

La vue BO affiche désormais un résumé du cours, les places confirmées par quota, les
attentes globales et des filtres par statut. Chaque membre a une fiche avec les décisions
principales, un refus saisi dans cette même fiche, et un volet pour l'historique et les
corrections. L'ajout manuel est repliable ; les erreurs, succès et chargements sont explicites.

`MemberAutocomplete` remplace recherche + select pour l'ajout et le choix du responsable :
recherche serveur temporisée, dix suggestions visibles avec invitation à affiner, sélection
par clic ou flèches/Entrée, Échap, profil incomplet signalé. Toute modification du texte
invalide le compte sélectionné ; une réponse obsolète ne remplace pas les derniers résultats.
Aucune migration supplémentaire nécessaire pour cette passe UI. Tests React/DOM et build
BO validés ; le rendu visuel navigateur reste à recetter avec l'outil disponible.

## Action de compte PWA

Les onglets Live et Cours utilisent « Connexion / Déconnexion » dans le header.
La connexion depuis Cours conserve le retour au contexte d'origine. Le profil se complète
via l'encart de profil incomplet ou la demande d'inscription ; le raccourci « Mon profil »
est retiré du header. Aucun espace profil dédié n'est ajouté à ce stade.
