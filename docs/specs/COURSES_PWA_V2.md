# Cours PWA — périmètre V2 et intégration du design Claude

Statut : **implémenté dans le worktree V2, recette visuelle à faire**, 10 septembre 2026.
Base : BO développé au commit `e27123a`, spec `COURSES.md`, export Claude Design
`Exploration système de design.zip` / `design_handoff_cours_pwa`.

Le commanditaire a demandé de revoir le périmètre avec les nouveautés du design, puis a
répondu aux arbitrages ci-dessous. Ce document remplace les règles correspondantes de la
V1 ; les autres invariants de `COURSES.md` restent applicables. Le code est accompagné de tests SQL et React/DOM ; les étapes de migration et la recette
restante sont décrites dans `../COURSES_PWA_DELIVERY.md`. Aucun déploiement distant effectué.

## 1. Arbitrages du commanditaire

| Sujet | Règle retenue |
|---|---|
| Responsable d'un cours | Un admin choisit un membre du club comme responsable de chaque cours. Aucun nouveau rôle global « encadrant ». |
| Gestion dans la PWA | Le responsable traite les demandes et peut annuler son cours. Les admins du club et super-admins conservent l'accès à tous les cours du club actif. |
| Autres cours | Un responsable conserve ses droits de membre : il peut demander une place aux autres cours, quel que soit leur responsable. |
| Profil personnel | Le membre peut modifier prénom, nom et sexe. Les admins gardent l'édition des profils des membres de leur club. |
| Date de naissance | Non ajoutée. Aucun contrôle d'âge. Un enfant avec compte personnel rattaché et profil complet peut demander une place. |
| Licence | Aucun champ ni contrôle de licence. Le rattachement au club suffit ; employer « membre du club ». |
| Notifications | Statut consultable dans la PWA uniquement. Aucun email/push, aucune promesse d'alerte ultérieure. |
| Motif du refus | Obligatoire pour toute nouvelle décision de refus ; mise en cohérence du BO et du serveur nécessaire. |
| Navigation secondaire | Intégrer « Tous les cours / Mes cours » et la vue des cours encadrés, avec les limites définies ci-dessous. |

Le motif obligatoire et la navigation proviennent du périmètre de design retenu. Les trois
premiers arbitrages (responsabilité, profil sans naissance/licence, aucune notification)
ont fait l'objet de réponses explicites. Les règles de présentation détaillées ci-après
sont des choix d'intégration pour rendre ce périmètre cohérent et testable.

## 2. Invariants maintenus

- Cours gratuits, publiés dès création ; lecture publique du club actif.
- Prénom/nom non blancs et sexe renseigné avant réservation, côté membre comme côté admin.
- Sexe `female` / `male`, capacité distincte pour chaque quota ; seuls les `approved` comptent.
- Demandes possibles avant H−4 même quota plein, sans place garantie, ordre de priorité ou
  promotion automatique. Aucun dépassement, y compris par responsable/admin.
- Fermeture des nouvelles demandes **et désistements membres** à H−4 exactement.
- Décision du responsable/admin possible jusqu'au début du cours, même après H−4.
- Aucun changement d'inscription ni annulation du cours une fois le cours commencé.
- Catalogue public masqué à début +24 heures écoulées, fuseau Europe/Paris.
- Statuts en base : `pending`, `approved`, `denied`, `cancelled`. Le `withdrawn` du README
  est un alias de présentation à convertir, pas un cinquième statut à créer.
- Une ligne courante par `(course_id,user_id)`, journal des transitions conservé.
- Aucun effacement du statut après un désistement ; nouvelle demande explicite possible
  après annulation individuelle, avant H−4. Pas de nouvelle demande membre après refus.
- Date/heure et durée verrouillées après première demande. Annuler puis recréer pour déplacer.
- Modification du sexe du profil sans reclassification automatique des inscriptions.
- Conservation : durée toujours à décider avant lancement ; pas de purge dans ce lot.

## 3. Écarts à corriger dans l'export

Les HTML et leur README sont des références de design. Ne pas exécuter ou embarquer leur
runtime `support.js` dans la PWA, ni recopier leur modèle de données comme une migration.

| Référence de l'export | Adaptation pour l'intégration |
|---|---|
| `course_sessions`, `category`, `decision_reason`, `withdrawn` | Réutiliser `courses`, `quota_sex`, `denial_reason`, `cancelled`. Conserver les tables et données déjà développées. |
| Formulaire catégorie + naissance | Formulaire prénom, nom, sexe ; aucune date de naissance. |
| « Membres licenciés » | « Membres du club ». |
| « Vous recevrez une notification… » | « Demande envoyée. Votre place sera confirmée après validation par le club. » Pas de promesse de notification. |
| Encadrant non propriétaire en consultation seule | Lecture et réservation personnelle permises ; seules les actions de gestion sont masquées. |
| « Seul le propriétaire du cours voit cet écran » | Supprimer : les admins y ont aussi accès. Aucun texte de contrôle serveur dans l'UI. |
| Motif de refus prérempli dans le prototype | Champ initialement vide et obligatoire pour les nouvelles décisions. Ne pas inventer un motif au nom de l'encadrant. |
| Retour anticipé pour un cours `closed/live/finished` avant de lire l'inscription | Composer état temporel et statut personnel ; ne pas masquer la confirmation. |
| `Mes cours` limité à `phase === 'open'` | Conserver les inscriptions quand les demandes ferment à H−4, et pendant la séance. |
| « Mes créneaux » compté uniquement sur les cours `open` | Conserver les cours clos aux membres mais encore gérables jusqu'au début. |
| Suppression de l'état local au désistement | Afficher l'état confirmé `cancelled` et conserver l'historique serveur. |
| `setTimeout(1100)` et résultats simulés | Attendre le résultat réel de la RPC ; aucun succès optimiste. |
| « Impossible d'envoyer » pour toute erreur réseau | En cas de réponse incertaine, proposer une relecture sans affirmer l'échec de l'écriture. |
| Logos, personnes et photos de démonstration | Config du club / données réelles ; aucune personne fictive ni marque CAC en fallback pour les autres clubs. |

## 4. Identité du responsable et droits

### Modèle

Ajouter `courses.owner_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL` par une
**nouvelle migration**, sans modifier la migration `2026091001_courses.sql` déjà fournie
pour application. Le responsable doit être un membre actuel du même club au moment de
l'assignation ; cette règle est contrôlée serveur, pas seulement dans le sélecteur BO.

- Nouveaux cours : responsable obligatoire dans le BO et dans la création serveur.
- Cours existants : `owner_id=NULL` accepté pour la migration, badge BO « Responsable à
  désigner ». Aucune attribution automatique à partir du texte de l'entraîneur.
- Un cours sans responsable reste consultable/réservable ; sa gestion est réservée aux admins.
- Arbitrage du 11 septembre : supprimer la saisie libre de l'encadrant. Le prénom affiché
  provient du profil actuel du responsable (`owner_first_name` dans les lectures), sans
  copie dans le cours. Un changement du profil se répercute à la prochaine lecture.
  Sans responsable ou prénom renseigné : « À désigner ». La colonne historique `coach_name`
  est conservée hors des lectures/écritures applicatives, sans suppression des anciennes valeurs.
  Migration complémentaire : `2026091101_course_owner_identity.sql`.
- Seuls les admins changent le responsable, avant le début du cours. Changer le responsable
  ne change ni date, ni effectifs, ni demandes ; pas besoin d'annuler/recréer.
- Retrait du club : supprimer immédiatement la capacité de gestion de l'ancien responsable,
  mettre `owner_id` à null pour ses cours et conserver les inscriptions des autres membres.
  Son éventuelle inscription personnelle est traitée par la règle de retrait déjà existante.
- Suppression du compte : même perte de gestion, sans suppression du cours. Les références
  nominatives d'acteur suivent le traitement déjà prévu par la V1.

### Matrice d'accès

| Acteur | Catalogue | Demande personnelle | Demandes d'autrui | Actions de gestion PWA |
|---|---|---|---|---|
| Visiteur | Oui | Connexion requise | Non | Non |
| Connecté non membre | Oui | Non | Non | Non |
| Membre ou manager | Oui | Oui, si éligible | Non | Non |
| Membre responsable du cours | Oui | Droits de membre inchangés | Demandes de ce cours seulement | Approuver, refuser, consulter décisions, annuler ce cours |
| Admin du club / super-admin | Oui | Rattachement requis pour réserver pour soi | Tous les cours du club courant | Mêmes actions de gestion sur tous ces cours |

Le statut de responsable est un droit local à un cours, indépendant de `club_members.role`.
Il ne donne ni accès au BO admin, ni édition des types, ni ajout manuel d'un tiers, ni édition
administrative du profil d'autrui. Ces fonctions restent dans le BO, réservées aux admins.

Un propriétaire voit prénom/nom et quota figé des demandeurs de son cours, ancienneté et
statut/motif de décision. Pas d'email, date de naissance, profil complet, historique dans
les autres cours ou liste des autres clubs de la personne. Les UUID techniques ne sont pas
montrés dans les écrans publics. Toutes les vérifications sont répétées dans les RPC.

## 5. Évolution du profil

Créer un parcours PWA de profil (`/profil`) pour le propre compte connecté, avec retour au
cours d'origine. Champs : prénom, nom, sexe ; mêmes validations que dans le BO (noms 1–100
caractères après trim ; sexe female/male). Email affichable en lecture seule si utile.

- Le formulaire s'ouvre depuis l'encart « Profil incomplet » et le parcours de demande.
  Arbitrage du commanditaire : l'action de compte du header est « Connexion / Déconnexion »,
  comme sur Live. Pas de raccourci « Mon profil » pour un profil déjà complet ; un espace
  profil dédié pourra être ajouté ultérieurement.
- Message : « Renseignez votre prénom, nom et sexe pour demander une place. »
- Sauvegarde explicite ; toast « Profil enregistré. Vous pouvez envoyer une demande. »
  uniquement si le cours reste ouvert ; retour sans demande automatique.
- RPC dédiée d'édition propre : identité exclusivement `auth.uid()`, pas de `user_id` cible
  fourni par le navigateur. Écriture atomique de `profiles` + `profile_details`, avec révision.
- **Ne pas rétablir de GRANT INSERT/UPDATE global sur `profiles`.** Ne jamais permettre de
  toucher `is_super_admin`, les rôles ou l'appartenance. Les écritures restent via RPC.
- Le profil est global : prévenir sobrement que ses modifications valent pour ses clubs,
  sans exposer les identités des autres clubs.
- Le sexe n'est pas ajouté à la table publique `profiles` ; le conserver dans `profile_details`.
- Un changement de sexe ne déplace pas une inscription déjà créée vers l'autre quota. La
  correction explicite demeure une fonction admin BO, avec garde de capacité.
- Pas de donnée naissance, licence ni consentement supposé par un nouveau champ.

## 6. Refus obligatoire, données existantes et transitions

Tout nouveau passage à `denied`, depuis le BO ou la PWA, exige `denial_reason` non blanc
après trim, longueur 1–1000. Le motif est saisi par la personne qui prend la décision,
jamais prérempli avec une cause fictive. « Envoyer le refus » reste inactif tant que vide.

Ne pas ajouter un CHECK global invalidant les anciens refus sans motif : conserver leur
lecture avec « Demande refusée », sans lien « Voir le motif ». Faire appliquer la règle
par la mutation de décision et la validation UI. Ne pas remplir les anciens refus avec
un motif inventé. Un réexamen retire le motif courant comme en V1.

Dans la PWA de gestion : l'encadrant approuve ou refuse une demande `pending`. Les cartes
traitées deviennent en lecture seule avec leur décision. Réexaminer/révoquer une décision,
ajouter un tiers ou corriger le quota restent dans le BO admin pour ce lot. Annuler le
cours demande une confirmation explicite et annule ses demandes actives dans la même transaction.

## 7. Navigation et comportement des listes

### Membre

« Tous les cours / Mes cours ». Liste de 20 par page, tri par début croissant et groupage
par jour. « Tous » conserve la fenêtre publique V1, y compris les cours terminés depuis
moins de 24 heures après leur début et les cours annulés encore visibles.

« Mes cours » : `pending` ou `approved`, cours non annulé, fin du cours dans le futur.
Les cours fermés à H−4 **et en cours** restent présents. Compteur = nombre de ces cours,
pas nombre de places ni nombre d'éléments de la page chargée. Les cours refusés/annulés
restent consultables dans « Tous » pendant leur fenêtre de visibilité.

### Responsable et admin

Conserver l'accès à **Mes cours** personnels ; ne pas remplacer ce segment et faire perdre
les réservations de l'encadrant. Ajouter un accès secondaire **Encadrement** pour les comptes
qui ont au moins un cours attribué ou qui sont admins. À l'intérieur, reprendre le style
« Mes créneaux » du design : responsable = ses cours, admin = tous les cours du club.

La liste Encadrement présente les séances avant leur fin, y compris celles déjà closes aux
inscriptions membres. À partir du début : demandes et décisions en lecture seule. Un
cours sans demande reste visible pour son responsable, avec « Aucune demande reçue ».
Le compteur d'attention = demandes `pending` sur les cours non annulés **pas encore commencés**
gérables par le compte. Calcul global serveur, indépendant de la pagination.

Le bouton « Gérer les demandes » et son compteur sont possibles dans « Tous » pour les
cours gérables. Si le responsable a aussi sa propre inscription, conserver son statut et
ses actions personnelles séparément des actions de gestion ; ne pas fusionner ces deux états.

### États combinés

- `approved` + H−4 : confirmation visible, désistement masqué.
- `pending` + H−4 : attente visible ; aucune annulation membre, décision encadrant possible.
- `approved` + cours en cours : confirmation et badge « En cours » ; aucune mutation.
- `pending` + fin dépassée : « Terminé — demande non validée », sans refus artificiel.
- Cours annulé : annonce d'annulation prioritaire, aucun CTA de demande ou gestion active.
- Ancien responsable : ses actions de gestion disparaissent après relecture ; refus serveur
  immédiat si une action était encore affichée.

## 8. Intégration visuelle et interactions

Conserver les cellules à colonne horaire, le bandeau vert de confirmation, les badges,
les quotas neutres « Femmes x/y · Hommes x/y », les espacements, les bottom sheets et les
confirmations du design, avec les corrections de ce document.

Utiliser les tokens du club pour les couleurs identitaires ; garder les couleurs sémantiques
succès/attente/erreur. Image du type facultative, sans image fictive si absente. Layout 320,
390 et 430 px, safe areas et bannière d'installation existante ; toasts au-dessus de la
navigation/bannière et dialogues accessibles (focus, fermeture, retour au déclencheur).

Les sélecteurs de persona, horloge fictive, simulation de panne et boutons de simulation de
validation présents dans le prototype ne sont **pas** des fonctions de production.
L'état `sending` est local ; `pending` n'apparaît qu'après réponse serveur. Après timeout,
relire avant de relancer, conserver la même clé de commande pour une relance technique.
Les statuts changent à la mutation, au retour au premier plan et au rafraîchissement ; aucun
email/push ni toast prétendant qu'une alerte externe sera envoyée.

## 9. Contrats serveur à ajouter / faire évoluer

Nouvelles RPC publiques/personnelles distinctes du transport BO :

| Opération | Contrat |
|---|---|
| Catalogue public | Métadonnées de cours + type/image, compteurs approuvés par quota, fenêtre de visibilité ; aucune donnée de demandeur |
| Mes inscriptions | Compte via auth.uid, club courant, cours ciblés ou filtre Mes cours ; statut, motif courant, quota figé, dates et révision |
| Demander / me désister | Appartenance, profil, horaire serveur et transition contrôlés ; unicité et idempotence |
| Mon profil : lire / modifier | Propre identité uniquement, aucune élévation de rôle, révision partagée avec édition admin |
| Mes capacités de gestion | Cours gérables + compteurs nécessaires, construits serveur ; aucune confiance dans une persona envoyée par le client |
| Liste des demandes d'un cours | Responsable actuel ou admin ; données strictement nécessaires, pages bornées |
| Décider pending → approved/denied | Droits + délai avant début + quota sous verrou + motif obligatoire si refus |
| Annuler un cours | Responsable actuel ou admin, délai avant début, annulations liées atomiques |

Le choix final des noms RPC doit être centralisé dans le client, sans recréer les tables
proposées par l'export. Réutiliser/extraire les invariants du BO ; ne pas créer deux versions
divergentes du calcul des places ou des transitions.

Conserver le protocole du lot BO : sérialisation par club, puis verrou du cours et contrôles
après attente du verrou. Toutes les mutations, changement de responsable compris, participent
à cette coordination. La sélection d'un propriétaire dans le client n'est jamais une preuve
d'autorisation. RLS/GRANT sur les tables demeurent fermés aux écritures libres.

## 10. Découpage livrable

1. Migration additive : owner_id, contrats de droits, édition propre, motif obligatoire pour
   les nouvelles décisions, catalogue/personnel/encadrement. Tests SQL et concurrence.
2. BO : sélection du responsable, reprise des anciens cours sans propriétaire, refus obligatoire.
3. PWA membre : quatrième onglet, catalogue, détail, demandes/statuts, Mes cours, connexion
   avec retour au cours, profil, désistement et erreurs réseau.
4. PWA encadrement : liste des créneaux, file des demandes et décisions, annulation du cours.
5. Fidélité visuelle, responsive et recette des états combinés ; documentation des migrations
   et ordre de déploiement. Pas de déploiement implicite pendant l'intégration.

## 11. Recette spécifique V2

1. Un membre devient responsable de A sans changer de rôle ; il gère A mais pas B.
2. Ce responsable peut demander une place à B comme tout membre ; un admin peut gérer A et B.
3. Réassigner A révoque immédiatement les anciennes actions, même si le panneau est encore ouvert.
4. Retirer le responsable du club laisse le cours et les inscriptions des autres personnes ;
   les admins peuvent désigner un nouveau responsable.
5. Deux validations simultanées de la dernière place donnent exactement un succès, y compris
   si l'une vient du BO et l'autre de la PWA.
6. H−4 ferme la demande personnelle mais laisse la décision encadrant possible jusqu'au début.
7. Les statuts personnels et Mes cours ne disparaissent pas à H−4 ; fin du cours et +24 h ont
   leurs effets distincts sur Mes cours et Tous.
8. Le profil propre se modifie, celui d'autrui et les droits ne sont pas modifiables par cette RPC.
9. Deux éditions BO/PWA concurrentes du même profil provoquent un conflit de révision sans perte.
10. Un refus vide est rejeté serveur/UI ; un ancien refus sans motif reste lisible sans erreur.
11. Aucun écran ni payload n'exige naissance ou licence ; aucune notification n'est promise/envoyée.
12. Compteurs globaux corrects avec plus de 20 cours/50 demandes ; aucun calcul limité à la page.
13. Visiteur et autre membre ne lisent ni file des demandes ni raisons d'autrui, y compris par API.
14. Logo/config/images absents, noms longs, motif long, clavier et safe areas restent utilisables.

## 12. Références et état du travail

Export original conservé dans `docs/briefs/design_handoff_cours_pwa` (ignoré par Git).
Le README du fournisseur reste intact pour conserver la provenance ; ce document porte les
arbitrages qui le corrigent. Le lot BO est déjà commité (`e27123a`). La V2 implémente désormais la PWA et sa migration
additive dans le worktree dédié ; aucune base distante n'a été modifiée.
