# Cours — réservation gratuite dans la PWA

> **Évolution du périmètre le 10 septembre 2026 :** lire aussi
> [COURSES_PWA_V2.md](COURSES_PWA_V2.md). Ce complément prend priorité pour le responsable
> de cours et ses droits PWA, le profil éditable par le membre, le motif de refus obligatoire
> et la navigation « Mes cours / Encadrement ». Le présent document décrit le socle V1 et
> reste applicable aux règles non modifiées. Les nouveautés V2 ne sont pas encore implémentées.

Statut : **contrat fonctionnel et technique V1 exploitable ; conservation à fixer avant
mise en production, maquettes Claude Design attendues pour la finition visuelle**.
Date : 2026-09-09. Base inspectée : `caabb4260b7c1254eb25da6fd33ef4deae1626e1`.
Branche de rédaction : `codex/spec-resa-section`.
Source locale : `docs/briefs/resa_section.md` (ignorée par Git ; exigences reprises ici).

Ce document est autonome. Les décisions produit du §2 intègrent les réponses du
2026-09-09. Les choix complémentaires du §2.2 sont des choix de conception explicites,
pas des réponses attribuées au commanditaire. Ils définissent le comportement V1.
Cette tâche porte sur la spécification ; aucun développement ni déploiement n'est demandé.

## 1. Objectif et exigences acquises

Permettre aux membres d'un club de demander gratuitement une place à un cours de tennis
depuis la PWA. Un administrateur du club examine les demandes dans le BO.

- Lecture du catalogue PWA publique, y compris sans connexion ; onglet « Cours ».
- Réservation réservée aux membres du club, quel que soit leur rôle.
- Prénom, nom et sexe renseignés avant toute demande. Valeurs du brief : masculin/féminin.
- Chaque cours appartient à un club et comporte un type, un nom, une date/heure de début,
  une durée, un entraîneur en texte libre et deux capacités (femmes/hommes).
- Capacité totale = somme des deux capacités ; pas de troisième total éditable.
- Types de cours administrables par club, avec image facultative.
- Demande créée en `pending` (« En attente de validation »), puis décision `approved`
  (« Inscription confirmée ») ou `denied` (« Demande refusée »).
- Motif de refus facultatif, visible par le demandeur dans la PWA.
- Le BO affiche les demandes et permet les changements de statut, l'ajout d'un membre
  par admin/super-admin et la consultation de son historique.
- Fermeture des nouvelles demandes à H−4.
- Les cours quittent la liste publique un jour après leur tenue, sans supposer une
  suppression des données.
- Le design PWA sera défini avec Claude Design ; le présent document fixe le comportement.

## 2. Décisions et périmètre V1

### 2.1 Réponses et recommandations validées le 2026-09-09

| ID | Sujet | Décision |
|---|---|---|
| D01 | Public éligible | Hommes et femmes avec compte personnel déjà rattaché au club, tous rôles. Un enfant avec son compte peut s'inscrire. Aucun âge ni contrôle d'âge ajouté ; aucun invité sans compte ni compte familial. |
| D02 | Occupation | Seuls les `approved` consomment une place ; les `pending` ne réservent rien. |
| D03 | Cours complet | Demandes possibles avant H−4 même quota plein ; aucune promotion automatique ni redistribution automatique entre quotas. |
| D04 | Désistement | Membre autorisé avant H−4 ; nouvelle demande après désistement, pas après refus. |
| D05 | Admin | Ajout directement approuvé avec choix explicite ; décisions jusqu'au début du cours, aucun dépassement. |
| D06 | Profil | Seuls admin/super-admin modifient les membres. Gestion de son profil par le membre hors V1. Profil complet obligatoire pour réserver, sans bloquer les autres modules. |
| D07 | Publication | Cours publié dès la création. |
| D08 | Fuseau | Fuseau européen retenu : identifiant IANA `Europe/Paris`, avec changements d'heure. |
| D10 | Notifications | Aucun email/push lié aux cours. Les emails d'invitation existants restent distincts. |
| D11 | Image | Image facultative attachée au type de cours. |

### 2.2 Choix complémentaires de conception

Ces règles donnent un comportement déterministe aux cas non détaillés dans les réponses.
Elles prolongent les recommandations formulées, sans les présenter comme des validations
individuelles du commanditaire.

- D07 : supprimer définitivement uniquement un cours sans aucune demande ; sinon l'annuler.
  Archiver un type déjà utilisé. Pas de restauration d'un cours annulé en V1.
- D08 : « un jour après » = début + 24 heures écoulées ; pas le lendemain à minuit.
- D09 : historique BO des inscriptions du membre dans le club courant, avec cours, dates,
  statut courant et chronologie des demandes/décisions. Pas de présence/absence.
  **Durée de conservation non décidée par le commanditaire** : aucune purge automatique
  livrée dans ce lot. Fixer durée, périmètre et traitement des suppressions avant mise en
  production ; l'absence de purge dans ce lot n'est pas une décision de conservation illimitée.
- D10 : récurrence, lieu/terrain, paiement, plafond par membre et détection de chevauchement
  restent hors V1. Chaque cours est une séance indépendante.
- D11 : renommer un type ou remplacer son image actualise ses cours existants ; pas de copie
  historique d'image. Le cours conserve son propre nom. Les maquettes ne sont pas fournies.
- D12 : quota figé à chaque demande ; modifier le sexe du profil ne reclassifie pas les
  inscriptions. Correction explicite par l'admin, avec vérification de capacité.
- D13 : retrait du club = perte immédiate d'accès et annulation des demandes futures actives
  de ce club avec libération des places, sans effet sur les autres clubs.
- D14 : dès la première demande, date/heure et durée du cours ne sont plus modifiables,
  même si toutes les demandes sont ensuite refusées/annulées. Annuler et recréer pour déplacer.
  Les capacités restent modifiables, sans baisse sous le nombre d'approbations.

## 3. Constat sur le dépôt

Constats issus du code à la base indiquée, et non d'une inspection de la base en production :

- `profiles` est global au compte. L'appartenance à un ou plusieurs clubs passe par
  `club_members(user_id, club_id, role)` ; ne pas ajouter un `club_id` unique au profil.
- `prenom` et `nom` sont déjà `NOT NULL`, mais acceptent `''`. Le trigger
  `handle_new_user()` crée justement un profil vide lors des invitations.
- `src/pages/AcceptInvitePage.tsx` exige déjà prénom/nom non blancs à l'activation et fait
  un `profiles.upsert`. « Obligatoire » nécessite donc une règle sur les chaînes vides,
  pas seulement `NOT NULL`.
- `profiles` a une lecture publique globale. Le sexe ne doit pas être exposé par un
  simple ajout de colonne couvert par les `GRANT SELECT` de table existants.
- `is_super_admin` est protégé par des droits d'écriture par colonne. Toute évolution du
  profil doit conserver cette protection, y compris la branche INSERT de l'upsert.
- `src/pages/LiveScorePage.tsx` utilise `profiles.select('*')` : une restriction des colonnes
  lues impose de remplacer cette sélection et de vérifier tous les consommateurs.
- Le BO possède `ClubRoleContext` et des routes admin. La PWA possède un contexte Auth,
  mais son garde `RequireAuth` ne vérifie pas l'appartenance au club.
- Le helper SQL `can_manage_club_content` autorise également les `manager` : il n'est
  pas adapté à l'administration des cours réservée aux admins.
- La PWA a trois onglets, un `headerConfig`, TanStack Query et un cache renouvelé lorsque
  l'identité change. Réutiliser ces conventions pour le quatrième onglet.

Références : `20260521_profiles.sql`, `20260629_multi_tenant_socle.sql`,
`2026081801_profiles_column_grants.sql`, `20260905_audit_content_permissions.sql`,
`supabase/functions/club-members/index.ts`, `docs/CODEBASE.md`.

## 4. Contrat métier V1

### 4.1 Capacités

- Capacités entières >= 0, somme > 0. Une capacité à zéro interdit toute approbation
  dans ce quota ; le libellé PWA doit éviter de promettre une place.
- `approved_count(sex) <= capacity(sex)` est un invariant serveur.
- Complet global : les deux quotas sont atteints. Quota personnel plein : celui du membre
  est atteint, même si le cours a encore des places dans l'autre quota.
- Ne jamais stocker un booléen `is_full` modifiable : disponibilité dérivée des approbations.
- Le nombre de demandes `pending` est distinct des places occupées ; l'UI montre clairement
  qu'une demande ne vaut pas confirmation.
- Baisse de capacité sous l'effectif approuvé : refus atomique et message explicite.
- Une libération de place ne valide personne automatiquement.

### 4.2 Temps

- Stockage du début en `timestamptz`, durée en minutes entières strictement positives.
- Fin calculée = début + durée. Fermer la demande si `server_now >= starts_at - 4 hours`.
- L'horloge serveur fait autorité ; recontrôle lors de la transaction même si le bouton
  était encore actif. L'heure du navigateur ne permet aucun contournement.
- Catalogue visible si `server_now < starts_at + interval '24 hours'`. Inclure les cours
  annulés dans cette fenêtre, avec leur état. Aucun masquage anticipé des inscriptions.
- Saisir/afficher en `Europe/Paris`, indépendamment du fuseau du navigateur. Refuser une heure
  locale inexistante au passage à l'heure d'été ; pour une heure ambiguë à l'automne, demander
  explicitement le décalage UTC avant enregistrement. Tester les cours franchissant minuit.
- Masquage PWA ≠ suppression : le BO conserve l'accès selon la politique d'historique.
- Décisions, ajout, correction de quota et édition/annulation d'un cours interdits dès
  `server_now >= starts_at` ; historique en lecture. Le retrait d'un membre peut toujours
  intervenir, mais ne réécrit pas ses inscriptions aux cours déjà commencés.
- Les demandes encore `pending` au début restent en attente dans l'historique ; l'UI précise
  « Cours terminé — demande non validée » après la fin. Aucune approbation implicite.
- Un nouveau cours doit débuter dans le futur ; création à moins de quatre heures permise,
  avec demandes membres déjà fermées et ajout admin encore possible.

### 4.3 Transitions

| Origine | Action | Destination | Garde |
|---|---|---|---|
| Aucune | Membre demande | pending | Club actif, membre, profil complet, avant H−4, cours ouvert |
| pending | Admin approuve | approved | Droits admin, délai D05, place dans le quota |
| pending | Admin refuse | denied | Droits admin, délai D05 ; motif facultatif |
| approved | Admin révoque | denied | Droits admin, délai D05 ; place libérée |
| denied | Admin réexamine | pending | Droits admin, délai D05 |
| pending / approved | Membre se désiste | cancelled | Avant H−4 |
| cancelled | Membre redemande | pending | Mêmes gardes qu'une demande initiale |
| Aucune | Admin ajoute | pending ou approved | Choix explicite ; membre cible éligible ; capacité si approuvé |
| cancelled | Admin réinscrit | pending ou approved | Membre toujours rattaché ; profil complet ; avant début ; quota si approuvé |
| pending / approved | Admin annule pour le membre | cancelled | Avant début ; motif d'annulation technique `admin` |
| pending / approved (cours futur) | Retrait du club | cancelled | Transaction système ; motif `membership_removed` |

Les transitions non listées sont refusées. Pour approuver après refus, l'admin réexamine
puis approuve ; les deux actions sont explicites. Une répétition
de la même demande ne crée pas de doublon. Retirer le motif visible dès que le statut n'est
plus `denied` ; le journal conserve la décision antérieure sans réexposer son motif au
membre via le statut courant. Une nouvelle demande met à jour `requested_at`, prend le sexe
actuel du profil et remet les champs de décision à null.
L'annulation du cours prime sur le statut individuel et interdit toute nouvelle action.
Elle passe les `pending`/`approved` à `cancelled` avec origine `course_cancelled`, dans la
même transaction. Les anciens refus/désistements restent dans l'historique.
Une répétition technique d'une action utilise la même clé d'idempotence ; une nouvelle
demande volontaire après désistement utilise une nouvelle clé.

## 5. Modèle de données et API

Noms et contrats suivants à utiliser dans ce lot. UUID pour les identifiants, `timestamptz`
pour les dates, valeurs de sexe `female` / `male`, statuts texte avec CHECK.
Les FK cours/type et inscription/cours portent aussi le `club_id` pour garantir l'isolation.

- `course_types` : id, club_id, name, image_path nullable, archived_at nullable, timestamps.
  Référentiel par club plutôt qu'enum PostgreSQL : l'admin doit pouvoir créer des valeurs.
  Interdire suppression d'un type utilisé ; utiliser un archivage qui le retire du sélecteur
  de création sans casser les cours existants. Le nom reste lisible dans l'historique.
  Les noms de types sont uniques parmi les types non archivés d'un même club après trim
  et comparaison insensible à la casse ; doublon => erreur de validation.
- `courses` : id, club_id, type_id, name, starts_at, duration_minutes, coach_name,
  capacity_female, capacity_male, cancelled_at nullable, timestamps, revision.
  Une FK composite ou garde équivalente garantit que type et cours partagent le même club.
- `course_registrations` : id, club_id, course_id, user_id, status, quota_sex,
  denial_reason nullable, requested_at, decided_at nullable, decided_by nullable,
  created_by, updated_at, revision, cancellation_source nullable. Unicité `(course_id, user_id)` pour l'état courant.
  Vérifier appartenance cible, y compris pour un ajout admin. Dates/acteurs calculés serveur.
- `course_registration_events` : id, registration_id, club_id, from_status nullable,
  to_status, actor_id nullable, occurred_at, source, quota_sex, denial_reason nullable,
  request_id. Journal append-only serveur des transitions et corrections de quota.
  Pas de noms/emails copiés. Index `(club_id, registration_id, occurred_at, id)`.
- `profile_details` : `user_id` PK/FK auth.users, `sex` nullable CHECK female/male,
  `revision` entier >= 0, timestamps. Table privée ; ne pas ajouter le sexe à la table
  `profiles` publiquement lisible. Une ligne absente équivaut à un profil incomplet.
- Historique des inscriptions : index `(club_id, user_id, requested_at, id)` ; index
  `(course_id, status, quota_sex)` pour les compteurs. Catalogue : `(club_id, starts_at, id)`.
- Suppression du compte Auth : supprimer ses inscriptions et leurs événements par cascade,
  sans conserver son nom/email dans un snapshot ; anonymiser les références d'acteur
  (`decided_by`, `created_by`, `actor_id` à null) dans les inscriptions des autres personnes.
  Cette règle technique explicite est distincte de la durée de conservation encore ouverte.

### Profil : administration uniquement

- `MembersPage` ajoute une action « Modifier le profil » : prénom, nom, sexe obligatoires
  à l'enregistrement, email affiché en lecture seule. Aucun changement d'email dans ce lot.
- Le profil incomplet reste représentable pour les invitations/comptes existants ; l'admin
  le complète depuis Membres après invitation. L'invitation par email seule reste possible.
- `AcceptInvitePage` ne saisit/modifie plus le prénom/nom : elle gère l'activation et le mot
  de passe. Une absence de profil complet n'empêche pas l'activation.
- Retirer les droits INSERT/UPDATE directs des utilisateurs sur les colonnes d'identité de
  `profiles` : cacher un formulaire ne suffit pas. Le trigger de création est conservé.
- RPC `admin_update_member_profile(club_id, user_id, prenom, nom, sex, expected_revision)` :
  vérifie admin du club actif et appartenance cible, ou super-admin sur cible rattachée,
  puis écrit identité + détails en une transaction. Refuser les propriétés supplémentaires.
  Aucun paramètre `is_super_admin`, rôle, email ou identifiant de remplacement.
- Le profil est global au compte : une modification vaut pour tous ses clubs. Le BO indique
  « Ce profil est partagé entre les clubs de ce membre », sans exposer leur identité.
- Lecture du sexe : propre compte ou RPC admin contextualisée sur un membre de son club.
  Pas de lecture globale par tous les admins, ni de jointure publique depuis les cours.
- Contrôler révision du profil pour éviter que deux admins écrasent leurs modifications.
  La première édition crée `profile_details` si absent ; révision initiale attendue = 0.
- Réserver exige côté serveur prénom/nom non blancs et sexe renseigné, même pour ajout admin.
  La PWA affiche « Votre profil est incomplet. Contactez un administrateur du club pour
  renseigner votre prénom, nom et sexe. » Aucun écran d'édition du profil membre en V1.

### Validation des champs

Bornes techniques V1, identiques en UI et serveur : trim des textes ; prénom/nom 1–100
caractères chacun, type 1–80, nom du cours et entraîneur 1–120, motif de refus 0–1000.
Durée entière 1–1440 minutes ; chaque capacité entière 0–1000, somme strictement positive.
Motif vide normalisé à null. Image JPEG/PNG/WebP, 5 Mo maximum, validation du type réel ;
aucun SVG. Clé Storage `${club_id}/course-types/${uuid}.${extension}` dans un bucket dédié
`course-type-images`. Ne jamais écraser une clé existante ; mise à jour de la référence
seulement après upload réussi, nettoyage d'un ancien objet non référencé après succès.
Type archivé interdit pour un nouveau cours ; cours existant conservant ce type éditable.

### Mutations serveur

Utiliser des RPC transactionnelles pour demander, se désister, décider, ajouter un membre,
modifier les capacités et annuler un cours. Le client ne peut pas écrire librement le statut.

Toute opération qui change les effectifs ou capacités verrouille la même ligne `courses`
avant de relire les effectifs et de modifier les données. Vérifier dans la transaction le
club actif, les droits, le profil, le délai, la transition, la révision et le quota.
Utiliser un ordre stable de verrouillage pour les opérations touchant plusieurs cours.
Une correction de quota suit le même protocole. Retrait de membership et annulation des
inscriptions futures sont atomiques (trigger sur suppression de `club_members`, applicable
aussi au service role). Les demandes/approbations verrouillent et recontrôlent aussi la
ligne d'appartenance avant le cours ; l'ordre partagé est membership puis cours triés par id.
L'annulation d'un cours ne prend que son verrou et ne prend pas ensuite un verrou membership.
Les opérations vérifient l'heure réelle après attente d'un verrou (`clock_timestamp()`),
pas seulement l'heure de début de transaction.

Les `SECURITY DEFINER` doivent avoir un `search_path` maîtrisé, des droits EXECUTE explicites,
et reconstruire l'identité avec `auth.uid()` ; ne jamais faire confiance à un `actor_id`
ou un rôle envoyé par le navigateur. Protéger aussi les tables contre l'écriture directe.

Contrat d'erreurs à fournir au client : `NOT_MEMBER`, `PROFILE_INCOMPLETE`,
`REGISTRATION_CLOSED`, `COURSE_CANCELLED`, `QUOTA_FULL`, `INVALID_TRANSITION`,
`VERSION_CONFLICT`, `FORBIDDEN`, `NOT_FOUND`, `COURSE_STARTED`, `VALIDATION_ERROR`. Aucun détail d'un autre club dans les erreurs.
Après timeout, relire l'état avant de proposer une relance ; double clic idempotent.

## 6. Matrice d'accès

| Acteur | Catalogue actif public | Sa demande | Autres demandes / historique | Administration |
|---|---|---|---|---|
| Visiteur | Oui | Non | Non | Non |
| Connecté non membre | Oui | Pas de réservation | Non | Non |
| member / manager du club | Oui | Lecture + actions autorisées | Non | Non |
| admin du club | Oui | Idem membre | Oui, dans ce club | Oui |
| super-admin | Oui | Uniquement si membre du club | Oui, club explicitement ciblé | Oui |

- Catalogue public : métadonnées du cours et disponibilité seulement ; aucun nom de
  participant, email, sexe individuel, motif, identifiant utilisateur ou acteur de décision.
- Demande privée : accessible à son propriétaire et aux admins autorisés uniquement.
- Droits garantis par RLS/GRANT/RPC, y compris pour les requêtes directes hors UI.
- Les nouvelles policies ne doivent pas réutiliser un droit d'écriture destiné aux managers.
- Club suspendu : pas de catalogue public ni de réservation. Accès support super-admin à
  aligner sur les conventions du dépôt sans permettre une réservation membre.
- Storage : écriture admin du club seulement, préfixe club dans la clé, type/taille contrôlés.
  La lecture publique est acceptable pour les illustrations du catalogue.

## 7. Contrat des écrans

### BO

- Carte « Cours » admin/super-admin sur l'accueil ; routes `/courses`,
  `/courses/new`, `/courses/:id/edit`, `/courses/:id/registrations`, `/courses/types`.
- Liste à venir / passés, date, nom, type, entraîneur, places approuvées par quota,
  nombre de demandes en attente, état complet/annulé et actions.
- Formulaire : champs requis du brief ; validation des entiers, libellés non blancs,
  date/heure et fuseau explicites ; erreurs serveur conservant la saisie.
- Validation : membres, statut, quota, date de demande ; filtres de statut ; motif au
  refus ; historique dans un panneau conservant le cours courant.
- Ajout manuel : recherche paginée des membres du club (réutiliser/étendre le contrat
  `club-members`), signalement d'un profil incomplet ou d'une demande existante.
- Pas de succès optimiste sur une approbation. Après conflit, recharger effectifs/statut.
- Toute suppression/annulation affiche clairement sa portée avant validation.

### PWA

- Quatrième onglet « Cours », route publique `/cours`, tri début croissant puis id,
  chargement par pages de 20 (curseur starts_at/id) ; dates en Europe/Paris.
- Cellule : date/heure, entraîneur, type, nom, durée, disponibilité et état personnel ;
  illustration du type facultative, absence d'image sans placeholder obligatoire.
- Visiteur : « Se connecter pour s'inscrire » ; retour à `/cours` après connexion.
  Aucun envoi automatique de demande à la connexion.
- Non-membre : message d'inéligibilité et contact du club si disponible.
- Profil incomplet : message de contact admin (§5), inscription désactivée ; contact du club
  si configuré, sinon simple texte. Pas de formulaire de profil ni de notification envoyée.
- Membre éligible : confirmation de la demande réussie après réponse serveur uniquement ;
  libellé « En attente de validation », pas « Réservé ».
- Demande refusée : statut et motif s'il existe, rendu texte échappé.
- Afficher indépendamment l'annulation ou fermeture du cours et le statut personnel déjà
  obtenu ; un cours terminé encore visible n'est plus réservable.
- Sur cours complet : « Demander une place — cours complet »
  et explication de l'absence de garantie. Ne pas masquer une demande existante sous « Complet ».
- États attendus : chargement, catalogue vide, erreur avec réessai, hors ligne, envoi en cours,
  profil incomplet, non-membre, quota plein, fermé, annulé, pending/approved/denied/cancelled.
- Cache privé isolé par identité et club ; invalidation après mutation ; relecture au retour
  au premier plan et au rafraîchissement. Aucune mutation différée hors ligne.
- Validation serveur toujours décisive ; aucun besoin de Realtime obligatoire en V1.
- Maquettes attendues : liste + variantes, message profil incomplet, confirmation, motif de
  refus, désistement, BO liste/formulaire/validation/historique/édition membre. En attendant,
  réutiliser les composants et conventions existants ; aucune nouvelle charte inventée.
  Vérifier mobile, clavier, libellés accessibles et états non distingués par la couleur seule.

## 8. Découpage d'implémentation

1. Migration + RPC + confidentialité + tests SQL : quotas, concurrence, temps, rôles,
   isolation des clubs, invitation avec profil vide. Valider sur la chaîne réelle des
   migrations du dépôt ; ne pas supposer l'état de production.
2. Gestion admin du profil, adaptation d'AcceptInvitePage, droits d'écriture et tests.
3. BO : types, cours, décisions, ajout, historique ; contrôles serveur déjà disponibles.
4. PWA : catalogue, quatrième onglet, demande/statuts/désistement, message profil incomplet.
5. Recette intégrée et mise à jour `docs/CODEBASE.md`, `docs/specs/PWA.md` et matrice des rôles
   de `docs/specs/MULTI_TENANT.md`. Build/lint des projets touchés et suites pertinentes.
6. Avant mise en production : décider la conservation et valider le rendu avec les maquettes.
   L'absence de ces livrables ne bloque pas les lots 1–5 ; elle ne vaut pas validation implicite.

Déploiement : livrer le BO d'activation sans écriture de profil avant de révoquer les anciens
GRANT, puis migrations/RPC et interfaces de gestion/réservation. Prévoir une vérification
explicite d'un parcours d'invitation existant et nouveau. Ne pas déployer dans cette tâche.

Ne pas modifier les anciennes migrations : ajouter des migrations avec versions uniques.
Chaque nouvelle table comporte RLS et GRANT explicites. Le rollback applicatif ne doit pas
nécessiter de détruire les inscriptions ; privilégier des migrations additives.

## 9. Critères de recette à rendre exécutables

Tester les règles ci-dessus côté serveur et les parcours essentiels côté client.

1. Un visiteur voit les cours du club actif, jamais les demandes ni données privées.
2. Un membre d'un autre club ne peut réserver ni lire une inscription par son identifiant.
3. Un manager peut demander pour lui-même, mais ne peut administrer, même via appel direct.
4. Un profil vide peut être créé/activé par invitation ; réserver échoue jusqu'à complétion
   par un admin. Un membre ne peut modifier son identité/sexe par appel API direct.
5. Aucune voie de complétion ne permet d'écrire `is_super_admin`.
6. Un double clic / retry ne crée qu'une inscription courante.
7. Avec une dernière place, deux approbations concurrentes donnent exactement un succès ;
   réaliser ce test avec deux connexions PostgreSQL réelles, pas deux promesses sérialisées.
8. Un quota plein interdit son approbation même si l'autre quota dispose de places.
9. Une baisse concurrente de capacité ne viole jamais les effectifs approuvés.
10. À H−4 exactement, nouvelle demande refusée ; juste avant, acceptée si éligible.
11. Désistement/révocation libère la place ; aucune promotion implicite de demande en attente.
12. Annulation concurrente avec une demande/approbation laisse un état cohérent et non réservable.
13. Motif visible par son destinataire et l'admin autorisé seulement, absent du catalogue.
14. Le cours disparaît à début + 24 heures écoulées ; son historique BO reste accessible.
    Tester passage été/hiver, fuseau navigateur différent et bornes temporelles exactes.
15. Changement de compte/club, déconnexion et retour hors ligne n'exposent pas un ancien état privé.
16. Invitation, consultation des noms Live Score et accès super-admin existants fonctionnent encore.
17. Modification de sexe, retrait du club, suppression de compte et édition du cours suivent
    les règles D12–D14 et ne corrompent ni les quotas ni l'historique.
18. Un admin ne peut éditer que le profil d'un membre de son club ; un manager ne peut pas.
    Deux éditions de profil concurrentes ne s'écrasent pas ; aucune écriture ne change les rôles.
19. Un enfant avec compte rattaché et profil complet peut demander sans champ d'âge.
20. Aucun envoi email/push n'est déclenché par une demande, une décision ou une annulation.
21. Changer l'image du type actualise les cours liés ; archiver le type conserve leur affichage.

## 10. Contrat des opérations

Toutes les mutations reçoivent un UUID `request_id` pour dédoublonner les retries par acteur
et opération ; les éditions/décisions reçoivent la révision attendue. Une même clé réutilisée
avec un autre payload est rejetée. Stocker le résultat minimal dans la transaction (table
privée de commandes : acteur, opération, clé, empreinte du payload, identifiant résultant,
révision ; aucun profil ou motif en clair) ; aucun nouvel événement sur retry.
Recontrôler les droits avant toute restitution d'un résultat mémorisé ; relire les données
privées sous les droits actuels. Une ancienne réponse ne rétablit pas un accès retiré.
Les lectures privées et publiques sont distinctes. Échec atomique : aucune modification partielle.
Les créations reçoivent un `club_id` explicite ; les autres mutations déduisent le club de
la cible et vérifient sa concordance avec le contexte demandé. Aucun club implicite par défaut.

| Opération RPC | Entrée métier | Résultat / effet |
|---|---|---|
| `list_public_courses` | club_id, cursor, limit <= 50 | Champs publics §7, capacités et effectifs par quota, état annulé ; jamais d'inscription nominative |
| `get_my_course_registrations` | club_id, course_ids (max 50) | Ses statuts, motifs courants, révisions ; identité via auth.uid uniquement |
| `request_course_registration` | course_id | pending ; création ou nouvelle demande après désistement |
| `cancel_my_course_registration` | registration_id, expected_revision | cancelled avant H−4 |
| `admin_add_course_registration` | course_id, user_id, pending/approved | Ajout explicite ; inscription existante => erreur explicite, pas d'écrasement |
| `admin_set_course_registration_status` | registration_id, status, denial_reason, expected_revision | Transition §4.3 ; cible complète et membre pour pending/approved |
| `admin_correct_registration_quota` | registration_id, quota_sex, expected_revision | Avant début, quota égal au sexe actuel corrigé du profil, vérification capacité, événement ; pas de conversion de quota pour contourner une limite |
| `admin_save_course` | id nullable, champs éditables §5, expected_revision si édition | Cours créé/publié ou modifié ; date/durée verrouillées après première demande |
| `admin_cancel_course` | course_id, expected_revision | Annulation du cours et des inscriptions actives atomiques |
| `admin_delete_course` | course_id, expected_revision | Suppression uniquement avant début et sans historique de demande |
| `admin_save_course_type` | id nullable, name, image_path, expected_revision si édition | Type créé/modifié dans le club autorisé |
| `admin_archive_course_type` | type_id, expected_revision | Archivage ; suppression définitive uniquement si jamais utilisé via opération dédiée |
| `admin_update_member_profile` | paramètres §5 | Profil et révision à jour, aucune modification des quotas existants |
| `admin_list_course_registrations` | course_id, status nullable, cursor, limit <= 50 | Demandes et données des membres nécessaires à l'écran |
| `admin_get_member_course_history` | club_id, user_id, cursor, limit <= 50 | Inscriptions du membre dans ce club, dernières demandes en premier, puis événements paginés |

Ajouter `revision` aux types de cours également ; révisions initiales = 0, incrémentées
uniquement par le serveur. Utiliser des sélections explicites. `SELECT *` et jointures
publiques vers les profils/détails/inscriptions sont interdits sur les nouveaux endpoints.
Les lectures admin vérifient les droits comme les mutations. Pagination par curseur stable,
jamais chargement de tous les membres/historiques dans chaque cellule.

## 11. Points restant ouverts avant production

- Politique de conservation : durée non connue, aucune durée réglementaire supposée.
  Aucun nettoyage planifié dans ce lot ; décision et mise en œuvre nécessaires avant lancement.
- Référence Claude Design : non fournie. Contrat des états fixé au §7 ; adaptation visuelle
  ultérieure sans modification silencieuse des règles de réservation.

Le périmètre de cette tâche reste documentaire : aucune migration appliquée, aucun compte
modifié, aucune notification envoyée. La spec est maintenue dans son worktree dédié.

## 12. État d'implémentation — premier lot BO

Le commanditaire a autorisé le développement BO sans attendre les maquettes. Le lot couvre
les écrans admin, profils et mutations serveur décrits dans `docs/COURSES_BO_DELIVERY.md`.
La PWA (catalogue, demandes membres, H−4, disparition à +24 h) reste à implémenter.

Ajustements techniques du BO : opérations serveur regroupées en `course_admin_read` et
`course_admin_command`, pagination offset bornée à 50 avec ordre déterministe ; verrou
commun du club avant le cours pour coordonner le retrait des membres. Le contrat métier
ci-dessus reste applicable au lot PWA suivant. Les images sont validées en signature et
par décodage dans le client ; Storage impose MIME/taille, sans inspection serveur des octets.
Voir le document de livraison pour les prérequis de déploiement et les limites de validation.
