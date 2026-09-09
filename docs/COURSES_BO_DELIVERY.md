# Cours — livraison du back-office

Branche : `codex/spec-resa-section`. Ce lot implémente le BO sans dépendre des maquettes PWA.

## Livré

- Routes admin `/courses`, `/courses/new`, `/courses/:id/edit`, `/courses/types`,
  `/courses/:id/registrations` et carte d'accueil.
- Types : création, édition, image facultative, archivage, suppression si inutilisé.
- Cours : publication à la création, date Europe/Paris, durée, entraîneur, quotas, liste
  à venir/passés, modification, annulation avec historique ou suppression sans demandes.
- Inscriptions : ajout manuel, décision, motif de refus, désinscription, réexamen,
  correction explicite du quota, recherche paginée des membres et historique paginé.
- Profil : action dans Membres et depuis l'ajout d'inscription ; prénom/nom/sexe administrés
  uniquement. Activation du compte conservée avec choix du mot de passe.
- SQL : tables privées, RPC admin, droits et club actif contrôlés, révisions, clés de retry,
  quotas transactionnels, retrait de membre et suppression du compte gérés.

## Contrat technique du lot

Le contrat métier de `docs/specs/COURSES.md` reste la référence. Le transport BO regroupe
les opérations de sa section 10 dans deux RPC pour mutualiser les contrôles :

- `course_admin_read(p_club, p_kind, p_target, p_search, p_offset, p_filter)` : `types`,
  `courses`, `members`, `registrations`, `history`, `events`. Pages bornées à 50 lignes.
- `course_admin_command(p_club, p_operation, p_data, p_request_id)` : `profile`,
  `save_type`, `archive_type`, `delete_type`, `save_course`, `cancel_course`, `delete_course`,
  `add_registration`, `set_status`, `correct_quota`. Payload en liste blanche ; la révision
  attendue est `p_data.revision`. Identité reconstruite depuis `auth.uid()`.

Les mutations verrouillent le club puis le cours. Ce verrou plus large que celui prévu
initialement simplifie la coordination avec un retrait de membre ; les commandes de deux
cours d'un même club sont donc sérialisées. Les futures RPC PWA doivent adopter ce même
protocole avant toute écriture. `has_registrations` est une trace historique serveur qui
interdit un déplacement même après suppression du compte du dernier inscrit ; ce n'est
pas un compteur de places ni un indicateur « complet ».

Le sexe reste dans `profile_details`, table privée. Ne pas ajouter de SELECT public sur
les inscriptions. Ce lot n'expose **aucun catalogue ni commande de réservation PWA**.

Images : bucket dédié public, écritures admin contextualisées, MIME/taille au niveau
Storage ; détection de signature et décodage côté client. Aucun traitement antivirus ou
contrôle serveur des octets n'est livré. Une image référencée ne peut pas être supprimée
via les policies de ce bucket. Un échec d'upload/édition peut laisser un objet non référencé,
à nettoyer ultérieurement ; le BO ne supprime jamais un objet dont l'écriture SQL est incertaine.

## Déploiement — non exécuté dans cette tâche

1. Construire et livrer le BO contenant la nouvelle `AcceptInvitePage` (mot de passe seul).
   Les nouveaux écrans nécessitent la migration : ne pas annoncer leur disponibilité avant
   l'étape suivante. Les anciennes pages d'activation déjà ouvertes doivent être rechargées.
2. Appliquer une seule fois `supabase/migrations/2026091001_courses.sql` après les migrations
   déjà présentes dans le dépôt. La migration révoque les écritures d'identité de l'ancien
   formulaire ; la livrer en premier casserait les activations qui font encore un upsert.
3. Vérifier une invitation/activation réelle en environnement de développement, puis compléter
   un profil depuis Membres. Vérifier les parcours admin/manager/membre et deux clubs.
4. La PWA, sa réservation à H−4 et son filtre début +24 h seront livrés dans un lot suivant.
   Fixer la conservation avant l'ouverture du service aux adhérents.

Retour arrière applicatif : conserver une page d'activation sans upsert de profil et les
tables de cours. Ne pas rétablir de GRANT d'écriture global sur `profiles`, ne pas détruire
les inscriptions pour revenir à une ancienne interface.

## Vérifications

- `npm run build` : TypeScript + bundle BO.
- `npm run test:courses` : contrats SQL exécutés dans PGlite et parcours React/DOM avec
  backend simulé (quotas, erreurs, historique, formulaire, retry et fuseau).
- `npm run test:security` : régressions existantes.
- Lint ciblé sur les fichiers touchés ; le lint global peut signaler des erreurs existantes
  hors de ce lot.

Les tests SQL embarqués chargent les dépendances minimales de la migration. Ils ne valent
pas preuve que toutes les migrations historiques peuvent être rejouées sur une base vide.
Le schéma de production n'a pas été consulté ni modifié.

### Résultats de ce lot

- Build BO réussi ; avertissement existant de taille du bundle conservé.
- Lint ciblé réussi.
- 11 tests Cours réussis et 27 tests de sécurité existants réussis.
- `tests/courses-concurrency.test.mjs` : test réel réussi avec deux connexions PostgreSQL
  18 locales ; preuve de l'attente sur verrou, puis rejet de la seconde approbation et
  exactement une place occupée. Le serveur temporaire a été arrêté après le test.
- Pas de recette visuelle navigateur : le service d'automatisation UI local était indisponible.
  Les parcours sont testés en React/DOM ; une vérification visuelle en environnement de
  développement reste à faire avant mise en production.

Rejouer le test de concurrence sur une base **vide et jetable**, nommée `courses_test*`,
accessible sur localhost. Installer `pg` séparément si absent, puis fournir
`COURSES_TEST_DATABASE_URL` et éventuellement `COURSES_PG_CLIENT` (chemin du module `pg`).
Lancer `npm run test:courses:concurrency`. Sans URL, le test est explicitement ignoré ;
un résultat ignoré ne prouve pas la concurrence. Ne jamais pointer vers une base de club.
