# Spec — Interview d'après-match

> Statut : implémenté (MVP), migration `2026112010_live_interviews.sql`
> Dernière mise à jour : 2026-11-20
> Brief : `docs/briefs/interview-apres-match.md`

---

## Objectif

À la fin d'un live, chaque joueur **membre du club du match** — vainqueur comme perdant — reçoit une
demande d'interview « comme un pro ». Claude rédige les questions à partir du déroulé du match et
de l'historique du joueur, dont ses réponses aux interviews précédentes, pour faire le lien d'un
match à l'autre. Les réponses sont publiées dans le récap du live (zone mixte).

## Scope

**MVP** : rattachement automatique joueur ↔ membre, demande d'interview, génération des questions,
écran de réponse PWA, publication dans le récap, suppression.

**Hors MVP** : cartes citations et stories, reprise des réponses dans l'actu générée
(`generate-post`), incitation à créer un compte pour les joueurs non reconnus, saisie vocale,
interview de paire en double.

---

## 1. Rattacher les joueurs d'un live aux membres

### Règle

Un joueur d'un live est rattaché à un membre quand **exactement un** membre de `club_members` du
`club_id` du match a le même nom normalisé :

- normalisation : minuscules, sans accents, tout caractère hors `[a-z0-9]` retiré (« Jean-Marc
  Dupré » = « jeanmarcdupre ») ;
- les deux ordres sont acceptés : `prenom‖nom` du live comparé à `prenom‖nom` **ou** `nom‖prenom`
  du profil ;
- les profils sans prénom ni nom sont ignorés ;
- **aucun ou plusieurs** membres → pas de rattachement, sans erreur ni alerte.

Pas de rapprochement approximatif : l'interview est publiée sous le nom du joueur, une erreur
d'attribution est pire qu'une interview manquée (cas réel en prod : même nom de famille, autre
prénom).

**Live lié à une rencontre par équipes** (`team_match_line_id` non nul) : le `member_id` présent
dans `team_match_lines.joueurs_club` fait foi, avant toute comparaison de nom.

Mesure du 19/11/2026 sur la prod (259 lives terminés) : 23 des 46 joueurs du club reconnus, aucun
homonyme, aucun faux positif sur 304 adversaires ; 20 joueurs n'ont pas de compte.

### Modèle

Table **`live_match_members`** (`live_match_id`, `side` `j1…j4`, `club_id`, `member_id`, PK
`(live_match_id, side)`), lue et écrite par les seules fonctions SQL (aucun `GRANT` client). Une
table plutôt que des colonnes de `live_matches` : écrire `live_matches` aurait relancé ses
triggers (révision, Broadcast) pour le rattrapage, et un client authentifié aurait pu modifier ces
colonnes. Clé de nom : `live_name_key(prenom, nom)`, et `nameKey` côté TypeScript
(`shared/interviewFacts.ts`), identiques.

### Quand

- `live_match_resolve_members(match)` recalcule les rattachements d'un live, appelée par le
  trigger `live_interviews_on_finish` (`AFTER UPDATE OF status`) au passage à `finished`.
- Une correction de nom après la fin (« Rouvrir pour corriger » puis nouvelle fin) recalcule ; une
  interview déjà créée n'est pas réattribuée.
- **Rattrapage** dans la migration : tous les lives déjà `finished` sont rattachés, pour que
  l'historique et la continuité fonctionnent dès la première interview. Aucune demande d'interview
  n'est créée pour ces anciens matchs.

## 2. Demande d'interview

### Déclenchement

Trigger `AFTER UPDATE` au passage à `finished`, si le match **a été joué en live**
(`started_at` non nul : pas d'import Ten'Up ni de score saisi hors live). Une ligne
`live_interviews` par joueur rattaché, `ON CONFLICT DO NOTHING` (une seule interview par
joueur et par match, même après réouverture).

Simples et doubles : en double, chaque partenaire membre du club reçoit sa propre interview.
Match terminé sur abandon : l'interview est créée, les questions en tiennent compte (cf. §3).
Tout le trigger est dans un bloc `EXCEPTION` : une erreur (push compris) est journalisée en
`WARNING` et n'empêche jamais la fin du match.

### Table `live_interviews`

| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid PK | |
| `club_id` | uuid | Club du match (RLS) |
| `live_match_id` | uuid → `live_matches` ON DELETE CASCADE | |
| `member_id` | uuid → `auth.users` ON DELETE CASCADE | Joueur interviewé |
| `side` | `'j1'…'j4'` | Place du joueur dans le match |
| `status` | `pending` → `ready` → `published` / `declined`, puis `removed` (retirée) | « expirée » est calculé à la lecture (`expires_at` passé), pas stocké |
| `questions` | jsonb `[{ id, texte }]` | Rempli à la génération |
| `answers` | jsonb `[{ question_id, texte }]` | Réponses (vides = question passée) |
| `gen_attempts` | integer, défaut 0 | Tentatives de génération (3 au plus) |
| `generated_at`, `published_at` | timestamptz | |
| `expires_at` | timestamptz | `finished_at` + 48 h |
| `created_at` | timestamptz | |

`UNIQUE (live_match_id, member_id)`.

**Accès** : RLS activée, **aucun `GRANT`** client. Tout passe par des RPC `SECURITY DEFINER` :

| RPC | Qui | Rôle |
|---|---|---|
| `interview_my_pending(club)` | joueur connecté | Interviews `pending`/`ready` non expirées, avec résumé du match |
| `interview_get(id)` | le joueur seul | Interview, questions, réponses, statut (`expired` calculé) |
| `interview_gen_begin(id, limite)` | le joueur seul | Contrôles et plafonds, compte la tentative, renvoie les faits bruts (§3) |
| `interview_gen_save(id, member, questions)` | `service_role` seul | Enregistre les questions (`q1`, `q2`…), passe en `ready` |
| `interview_answer(id, answers)` | le joueur seul | Au moins une réponse non vide, 1 000 caractères au plus, passe en `published` |
| `interview_decline(id)` | le joueur seul | « Pas de commentaire » → `declined` |
| `interview_delete(id)` | joueur, admin du club, super-admin | Interview publiée → `removed` |
| `live_match_interviews(match, club)` | public (`anon` compris) | Zone mixte : interviews publiées, questions passées retirées, `can_delete` |

Pas de cron d'expiration : une interview dont `expires_at` est passé est refusée par les RPC et
affichée « expirée ».

### Prévenir le joueur

- **Canal « Interviews »** (migration `2026112101_interview_push_channel.sql`, 21/11/2026) :
  préférence d'appareil `notify_interviews`, **vraie par défaut, appareils déjà abonnés compris**.
  Un appareil n'est abonné que si les notifications sont autorisées au niveau du système : le
  canal est donc actif partout où le push l'est. Si l'autorisation est retirée ensuite, le
  service push refuse l'envoi et `course-push-dispatch` supprime l'abonnement (404/410).
  `push_subscribe` reçoit un 8ᵉ paramètre `p_interviews` (`NULL` conserve la préférence) ;
  l'ancienne signature à 7 paramètres reste pour les clients en cache. Ligne « Interviews » dans
  Mon profil → Notifications (`InterviewPushSettings`).
- **Push** : une livraison par appareil du joueur dans le club dont `notify_interviews` est
  active. Texte : « 🎙️ Interview d'après-match — Le club
  veut ta réaction après ta victoire contre Sam Martin » (« … ton match contre … » en cas de
  défaite). **Ouvre le live** (`/matches/<id>`) : c'est une URL que tous les service workers déjà
  installés acceptent, alors qu'une URL `/interviews/<id>` serait renvoyée vers `/cours` par une
  PWA pas encore mise à jour. Passe par la file des actus : `content_push_deliveries` avec
  `kind = 'interview'` (contrainte élargie), donc même réclamation `content_push_claim`, même
  `course-push-dispatch` (inchangée), réveil `live_push_kick`.
- **Dans l'app** : carte « Une interview t'attend » (`InterviewInvite`) en haut de l'accueil des
  live, dans Mon profil et, pour le joueur concerné, sur la page du live terminé, au-dessus du
  récap (là où mène la notification), tant que l'interview est `pending` ou `ready`. Les joueurs
  sans push n'ont que cette carte.

## 3. Génération des questions — `generate-interview`

Edge Function sur le modèle de `generate-post` : appelée par la PWA **à l'ouverture** de
l'interview, avec le jeton du joueur. Génération paresseuse : on ne paie que les interviews
ouvertes, et le push n'attend pas Claude.

- Vérifie que l'appelant est le `member_id` de l'interview, que le statut est `pending` et que
  l'interview n'a pas expiré ; si `ready`, renvoie les questions déjà générées (pas de second
  appel).
- Plafonds, vérifiés **avant** l'appel payant (dans `interview_gen_begin`, sur le modèle de
  `post_gen_check`) :
  - **par interview** : une seule génération réussie (les questions sont gardées, `ready`), et
    3 tentatives au plus (`gen_attempts`) pour qu'un échec répété ne boucle pas ;
  - **global** : 200 générations par 24 h glissantes, tous clubs confondus (variable
    `INTERVIEW_GEN_GLOBAL_DAILY_LIMIT`), garde-fou contre un emballement ;
  - **pas de quota mensuel par club** : le volume est borné par le nombre de matchs (4
    interviews au plus par live, ~260 lives en 6 mois chez CAC), pour un coût Haiku de l'ordre
    du centime par interview. À revoir si un club dépasse quelques centaines de lives par mois.
- Modèle : `claude-haiku-5-5`, réflexion désactivée, sortie en `json_schema`
  `{ questions: string[] }`. Nettoyage en code (`cleanQuestions` : numérotation, Markdown, 300
  caractères, 4 questions au plus) ; moins de 2 questions utilisables → 502, rien n'est enregistré.
- Les faits sont **relus en base** (`interview_gen_begin`, jeton du joueur), jamais reçus du
  client. Les questions sont enregistrées par `interview_gen_save` avec la clé `service_role` de
  la function. Les logs ne contiennent ni question ni prénom.
- Erreurs : 401 sans session, 403 interview d'un autre, 404 indisponible ou expirée, 429
  plafond, 503 sans `ANTHROPIC_API_KEY` ou API saturée, 504 délai, 502 sortie inutilisable.

### Faits transmis à Claude

Construits par `buildInterviewFacts` (`shared/interviewFacts.ts`, même principe que
`shared/teamPostFacts.mjs`). Le déroulé (`recapSets`, `replayFrames`, `matchHighlight`) a été
déplacé de `pwa/src/lib/liveRecap.ts` vers `shared/liveRecapCore.ts` (réexporté par la PWA) :
la PWA et la function lisent le match de la même façon. **Minimisation** : prénoms seuls (joueur,
partenaire, adversaires ; un prénom Ten'Up « Jean DUPONT » perd son nom), classements, aucun
identifiant.

1. **Le match** : vainqueur ou perdant, score par set du point de vue du joueur, abandon (de qui),
   durée de jeu et des sets, tie-breaks, moment fort (remontée, premier set perdu puis gagné,
   série d'au moins 4 jeux), breaks si le premier serveur est connu.
2. **Le contexte** : simple ou double (partenaire), tournoi (`event_id`) ou rencontre par équipes
   (équipe, compétition, adversaire, score de la rencontre), classements des deux côtés (une
   victoire contre mieux classé est une « perf »).
3. **L'ambiance** : spectateurs (au-delà de 10), nombre de publications et de photos.
4. **L'historique** (par `member_id`) : 5 derniers résultats (lives et lignes de rencontres par
   équipes), série en cours, matchs précédents contre le même adversaire (même clé de nom).
5. **La continuité** : questions et réponses de ses **2 dernières interviews publiées**.

### Consignes au modèle

- Ton de journaliste sportif en conférence de presse, mais **tutoiement**, comme le ton
  décontracté des actus du club.
- Au moins une question ancrée dans un fait précis du match (« À 2–5 dans le premier set, qu'est-ce
  qui a changé ? »).
- Si une interview précédente existe, une question y fait référence (« La semaine dernière, tu voulais
  travailler ta deuxième balle… »).
- Défaite : questions bienveillantes, sur ce qui a manqué et la suite, jamais humiliantes.
- Abandon : une question sur l'état physique au plus, sans insister ; sur abandon de l'adversaire,
  pas de question sur sa blessure.
- Ne jamais inventer un fait absent des données ; ne pas citer de nom d'adversaire absent des
  faits.

## 4. Écran de réponse — PWA `/interviews/:id`

- En-tête façon zone mixte : couleur du club, « Interview d'après-match », score du match.
- Une carte par question, réponse en texte libre (1 000 caractères au plus), possibilité de passer
  une question.
- Actions : **Publier** (au moins une réponse non vide), **Pas de commentaire** (`declined`, rien
  n'est publié).
- Brouillon gardé en `localStorage` tant que l'interview n'est pas publiée.
- Interview expirée, publiée ou refusée : écran d'état, avec lien vers le live si publiée.
- Accès réservé au joueur concerné ; un autre compte voit « Cette interview ne t'est pas
  destinée ».

## 5. Publication

- `interview_answer(id, answers)` : vérifie le joueur, le statut `ready` et l'expiration, enregistre
  les réponses, passe en `published`. Pas de modification après publication (MVP).
- **Récap du live** (`LiveInterviews.tsx`, sous `LiveRecap`) : section « Zone mixte », une interview
  par joueur publiée, questions et réponses, prénom et nom du joueur ; les questions passées
  n'apparaissent pas.
- **Suppression** : `interview_delete(id)` par le joueur, un admin du club ou le super-admin →
  statut `removed`, l'interview disparaît du récap (la ligne reste : une seule interview par
  joueur et par match).
- Pas de push aux suiveurs à la publication (MVP).

---

## Décisions (19/11/2026)

- **Tutoiement** dans les questions et les textes adressés au joueur.
- **48 h** de validité après la fin du match.
- **Plafonds** : une génération par interview (3 tentatives), 200 par jour au global, pas de quota
  mensuel par club (cf. §3).
- **Profils sans nom** : pas de relance ; ces membres ne sont simplement pas rattachés.

## Mise en service

1. Migrations `2026112010_live_interviews.sql` (qui rattache aussi les lives déjà terminés) et
   `2026112101_interview_push_channel.sql` (`supabase db push`).
2. Déployer `generate-interview` (`ANTHROPIC_API_KEY` déjà en place pour `generate-post` ;
   `INTERVIEW_GEN_GLOBAL_DAILY_LIMIT` facultatif, 200 par défaut). `course-push-dispatch` est
   inchangée.
3. PWA : déploiement Vercel au merge (`pwa/` et `shared/` sont dans son `ignoreCommand`).
4. Recette : deux comptes membres dont le profil porte le nom saisi au live ; terminer un live
   → push et carte « Une interview t'attend » pour chacun ; ouvrir, répondre, publier ; la zone
   mixte apparaît sous le récap ; « Pas de commentaire » et retrait par un admin.

Tests : `npm run test:interviews` (SQL PGlite, faits, Edge Function simulée).
