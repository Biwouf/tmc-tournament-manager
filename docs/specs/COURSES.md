# Cours — réservation gratuite dans la PWA

Statut : **raffinement en cours — décisions produit à confirmer avant implémentation**.
Date : 2026-09-09. Base inspectée : `caabb4260b7c1254eb25da6fd33ef4deae1626e1`.
Branche de rédaction : `codex/spec-resa-section`.
Source locale : `docs/briefs/resa_section.md` (ignorée par Git ; exigences reprises ici).

Ce document est autonome. Les éléments marqués **proposition** ne constituent pas des
décisions validées. Codex ne doit pas les convertir silencieusement en règles produit.
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

## 2. Challenge du brief et décisions attendues

| ID | Question / risque | Proposition à confirmer |
|---|---|---|
| D01 | « Adhérentes » en introduction mais deux quotas et tous les membres ensuite | Femmes et hommes ; un compte personnel existant, rattaché au club. Pas de réservation pour enfant/tiers sans compte en V1. |
| D02 | Une demande en attente réserve-t-elle une place ? | Seuls les `approved` consomment le quota. `pending` est une demande à examiner, sans garantie de place. |
| D03 | Demandes quand le quota est plein ; redistribution | Autoriser les demandes tant que H−4 n'est pas atteint, même complet ; validation manuelle, sans promotion ni transfert de quota automatiques. |
| D04 | Désistement / nouvelle demande | Désistement membre avant H−4, statut `cancelled`. Nouvelle demande après désistement, pas après refus. |
| D05 | Pouvoirs admin et délai | Ajout directement approuvé possible avec choix explicite ; changements jusqu'au début du cours ; aucun dépassement de quota. |
| D06 | Obligation de profil / comptes existants / modification | Complétion exigée pour réserver, pas de blocage global des comptes existants. Membre modifie son profil ; droits admin à préciser. |
| D07 | Publication et suppression d'un cours | Publication dès création en V1. Suppression possible sans demandes ; sinon annulation conservée. |
| D08 | Sens de « un jour après » / fuseau | Masquage à début + 24 h ; saisie et affichage Europe/Paris si tous les clubs sont dans ce fuseau. |
| D09 | Sens et durée de l'historique | Demandes du membre dans ce club, cours/date/statut et dates de décision. Pas de suivi des présences. Durée de conservation à décider. |
| D10 | Périmètre V1 | Pas de paiement, notifications email/push, récurrence, terrain/lieu, plafond par membre ni détection de chevauchement. |
| D11 | Image / design | Image attachée au type uniquement ; maquettes et comportement d'une modification de l'image à confirmer. |
| D12 | Sexe changé après demande | Mémoriser le quota à la soumission ; aucune reclassification rétroactive implicite. Une correction sur une inscription nécessite un contrôle de capacité. |
| D13 | Membre retiré du club / compte supprimé | Révoquer l'accès immédiatement ; annuler ses demandes futures et libérer les places. Traitement de l'historique à aligner sur D09. |
| D14 | Cours modifié après demandes | Refuser une baisse sous les effectifs approuvés ; modification de date/durée à confirmer (information des inscrits sans notifications V1). |

D02–D08 conditionnent les transitions et le modèle final. D09 et D13 conditionnent la
conservation et les cascades de suppression. D11 conditionne la livraison UI.

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

## 4. Contrat métier proposé, sous réserve des décisions

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
- D08 fixera l'expression exacte du filtre de visibilité et le fuseau. Tester les
  changements d'heure et les cours franchissant minuit.
- Masquage PWA ≠ suppression : le BO conserve l'accès selon la politique d'historique.
- Si D05 retenu : action admin interdite dès `server_now >= starts_at` ; historique en lecture.

### 4.3 Transitions proposées

| Origine | Action | Destination | Garde |
|---|---|---|---|
| Aucune | Membre demande | pending | Club actif, membre, profil complet, avant H−4, cours ouvert |
| pending | Admin approuve | approved | Droits admin, délai D05, place dans le quota |
| pending | Admin refuse | denied | Droits admin, délai D05 ; motif facultatif |
| approved | Admin révoque | denied | Droits admin, délai D05 ; place libérée |
| denied | Admin réexamine | pending | Droits admin, délai D05 |
| pending / approved | Membre se désiste | cancelled | Avant H−4 si D04 retenu |
| cancelled | Membre redemande | pending | Mêmes gardes qu'une demande initiale |
| Aucune | Admin ajoute | pending ou approved | Choix explicite ; membre cible éligible ; capacité si approuvé |

Les transitions non listées sont refusées, sauf précision produit ultérieure. Une répétition
de la même demande ne crée pas de doublon. Retirer le motif visible dès que le statut n'est
plus `denied` ; conserver l'ancien motif seulement dans le journal privé si retenu.
L'annulation du cours prime sur le statut individuel et interdit toute nouvelle action.

## 5. Modèle de données et API proposés

Noms indicatifs à figer après arbitrage ; invariants obligatoires quelle que soit la structure.

- `course_types` : id, club_id, name, image_path nullable, archived_at nullable, timestamps.
  Référentiel par club plutôt qu'enum PostgreSQL : l'admin doit pouvoir créer des valeurs.
  Interdire suppression d'un type utilisé ; proposer archivage qui le retire du sélecteur
  de création sans casser les cours existants. Le nom reste lisible dans l'historique.
- `courses` : id, club_id, type_id, name, starts_at, duration_minutes, coach_name,
  capacity_female, capacity_male, cancelled_at nullable, timestamps, revision.
  Une FK composite ou garde équivalente garantit que type et cours partagent le même club.
- `course_registrations` : id, club_id, course_id, user_id, status, quota_sex,
  denial_reason nullable, requested_at, decided_at nullable, decided_by nullable,
  created_by, updated_at, revision. Unicité `(course_id, user_id)` pour l'état courant.
  Vérifier appartenance cible, y compris pour un ajout admin. Dates/acteurs calculés serveur.
- Journal éventuel `course_registration_events` : inscription, ancien/nouveau statut,
  acteur, date, origine membre/admin ; nécessaire si D09 inclut toutes les tentatives et
  modifications, car une ligne d'état courant n'est pas un historique complet.
- Sexe : préférer une table privée de complément de profil par `user_id`, avec lecture
  propre et accès admin contextualisé, afin de ne pas élargir l'exposition publique.
  Si ajouté à `profiles`, remplacer les droits SELECT de table par des accès sûrs et
  adapter les lecteurs existants ; ne pas se contenter de cacher la colonne dans l'UI.

Le profil incomplet doit rester techniquement représentable pour les invitations et
comptes existants. Bloquer côté serveur l'inscription si prénom/nom blancs ou sexe absent.
Aucun remplissage automatique fictif ; D06 précise quand demander la complétion.

### Mutations serveur

Préférer des RPC transactionnelles pour demander, se désister, décider, ajouter un membre,
modifier les capacités et annuler un cours. Le client ne peut pas écrire librement le statut.

Toute opération qui change les effectifs ou capacités verrouille la même ligne `courses`
avant de relire les effectifs et de modifier les données. Vérifier dans la transaction le
club actif, les droits, le profil, le délai, la transition, la révision et le quota.
Utiliser un ordre stable de verrouillage pour les opérations touchant plusieurs cours.
Une correction de quota suit le même protocole.

Les `SECURITY DEFINER` doivent avoir un `search_path` maîtrisé, des droits EXECUTE explicites,
et reconstruire l'identité avec `auth.uid()` ; ne jamais faire confiance à un `actor_id`
ou un rôle envoyé par le navigateur. Protéger aussi les tables contre l'écriture directe.

Contrat d'erreurs à fournir au client : `NOT_MEMBER`, `PROFILE_INCOMPLETE`,
`REGISTRATION_CLOSED`, `COURSE_CANCELLED`, `QUOTA_FULL`, `INVALID_TRANSITION`,
`VERSION_CONFLICT`, `FORBIDDEN`, `NOT_FOUND`. Aucun détail d'un autre club dans les erreurs.
Après timeout, relire l'état avant de proposer une relance ; double clic idempotent.

## 6. Matrice d'accès

| Acteur | Catalogue actif public | Sa demande | Autres demandes / historique | Administration |
|---|---|---|---|---|
| Visiteur | Oui | Non | Non | Non |
| Connecté non membre | Oui | Pas de réservation | Non | Non |
| member / manager du club | Oui | Lecture + actions autorisées | Non | Non |
| admin du club | Oui | Idem membre | Oui, dans ce club | Oui |
| super-admin | Oui | Réservation personnelle selon D01 | Oui, club explicitement ciblé | Oui |

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

- Carte « Cours » admin/super-admin sur l'accueil ; routes proposées `/courses`,
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

- Quatrième onglet « Cours », route publique proposée `/cours`, tri début croissant puis id,
  chargement paginé ; dates et heures dans le fuseau décidé.
- Cellule : date/heure, entraîneur, type, nom, durée, disponibilité et état personnel ;
  illustration du type facultative, absence d'image sans placeholder obligatoire.
- Visiteur : « Se connecter pour s'inscrire » ; retour à `/cours` après connexion.
  Aucun envoi automatique de demande à la connexion.
- Non-membre : message d'inéligibilité et contact du club si disponible.
- Profil incomplet : « Compléter mon profil », puis retour au cours ; jamais de demande
  implicite après enregistrement du profil.
- Membre éligible : confirmation de la demande réussie après réponse serveur uniquement ;
  libellé « En attente de validation », pas « Réservé ».
- Demande refusée : statut et motif s'il existe, rendu texte échappé.
- Afficher indépendamment l'annulation ou fermeture du cours et le statut personnel déjà
  obtenu ; un cours terminé encore visible n'est plus réservable.
- Si les demandes sur cours complet sont autorisées : « Demander une place — cours complet »
  et explication de l'absence de garantie. Ne pas masquer une demande existante sous « Complet ».
- États attendus : chargement, catalogue vide, erreur avec réessai, hors ligne, envoi en cours,
  profil incomplet, non-membre, quota plein, fermé, annulé, pending/approved/denied/cancelled.
- Cache privé isolé par identité et club ; invalidation après mutation ; relecture au retour
  au premier plan et au rafraîchissement. Aucune mutation différée hors ligne.
- Validation serveur toujours décisive ; aucun besoin de Realtime obligatoire en V1.
- Maquettes attendues : liste + variantes, complétion profil, confirmation, motif de refus,
  désistement si retenu, BO liste/formulaire/validation/historique. Vérifier mobile et clavier.

## 8. Découpage d'implémentation après arbitrage

1. Figer D01–D14, modèle, matrice complète des transitions et limites de champs ; intégrer
   le contrat visuel. Marquer ensuite seulement cette spec « prête à implémenter ».
2. Migration + RPC + confidentialité + tests SQL : quotas, concurrence, temps, rôles,
   isolation des clubs, invitation avec profil vide. Valider la migration sur la chaîne
   réelle du dépôt ; ne pas supposer les migrations déployées en production.
3. Complétion profil et évolution éventuelle de l'activation/gestion membres suivant D06.
4. BO : types, cours, décisions, ajout, historique ; contrôles serveur déjà disponibles.
5. PWA : catalogue, navigation, profil, demande/statuts, désistement suivant D04.
6. Recette intégrée et mise à jour `docs/CODEBASE.md`, `docs/specs/PWA.md` et matrice des rôles
   dans `docs/specs/MULTI_TENANT.md` si nécessaire. Build/lint des projets touchés et suites
   existantes pertinentes. Documenter l'ordre de déploiement sans le lancer implicitement.

Ne pas modifier les anciennes migrations : ajouter des migrations avec versions uniques.
Chaque nouvelle table comporte RLS et GRANT explicites. Le rollback applicatif ne doit pas
nécessiter de détruire les inscriptions ; privilégier des migrations additives.

## 9. Critères de recette à rendre exécutables

Les tests conditionnels sont ajustés après les décisions ; ils ne les remplacent pas.

1. Un visiteur voit les cours du club actif, jamais les demandes ni données privées.
2. Un membre d'un autre club ne peut réserver ni lire une inscription par son identifiant.
3. Un manager peut demander pour lui-même, mais ne peut administrer, même via appel direct.
4. Un profil vide peut être créé par invitation ; réserver échoue jusqu'à complétion.
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
14. Le cours disparaît exactement à la borne D08 ; son historique reste accessible selon D09.
15. Changement de compte/club, déconnexion et retour hors ligne n'exposent pas un ancien état privé.
16. Invitation, consultation des noms Live Score et accès super-admin existants fonctionnent encore.
17. Modification de sexe, retrait du club, suppression de compte et édition du cours suivent
    les règles D12–D14 et ne corrompent ni les quotas ni l'historique.

## 10. Fin du raffinement

À compléter après réponse : décisions datées, choix alternatifs rejetés si utiles, noms et
champs définitifs, limites de validation, contrat RPC, transitions finales, conservation,
référence des maquettes et scénarios de recette adaptés. Aucun point bloquant ne doit rester
sous « proposition » dans une spec livrée comme directement exécutable par Codex.
