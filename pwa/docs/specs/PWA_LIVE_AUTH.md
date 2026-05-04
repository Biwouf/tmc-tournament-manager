# Spec — Authentification et live score dans la PWA

> Statut : prêt pour développement
> Dernière mise à jour : 2026-05-02

---

## Contexte

La PWA CAC Tennis (`pwa/`) est actuellement en lecture seule via le rôle Supabase `anon`. Le back-office (`src/`) contient un module Live Score complet (création de match, saisie du score, CRUD). L'objectif de cette tâche est de permettre aux utilisateurs ayant un compte back-office de se connecter depuis la PWA et d'y avoir un périmètre fonctionnel identique au back-office pour la gestion des lives.

Lire `docs/CODEBASE.md`, `docs/specs/LIVE_SCORE.md` et `docs/specs/PWA.MD` avant de commencer.

---

## Fonctionnalités à implémenter

### 1. Authentification

- **Login** : page dédiée `pwa/src/pages/LoginPage.tsx` avec un formulaire email/mot de passe. Utiliser `supabase.auth.signInWithPassword()`. Design cohérent avec le reste de la PWA (tokens CSS, police Manrope, couleur primaire `#e51828`).
- **Session persistante** : configurer le client Supabase avec `auth: { persistSession: true, autoRefreshToken: true }`. La durée de vie souhaitée est 30 jours — à aligner avec le paramètre "JWT expiry" du projet Supabase (réglable dans le dashboard Supabase → Settings → Auth → JWT expiry). Ce réglage est à faire manuellement dans le dashboard, il n'est pas dans le code.
- **Logout** : bouton accessible depuis l'onglet Matches quand l'utilisateur est connecté (ex. icône ou lien discret en haut à droite de la page). Appelle `supabase.auth.signOut()`.
- **Guard de route** : les routes `/matches/new` et `/matches/:id/score` sont accessibles uniquement aux utilisateurs authentifiés → redirection vers `/login` sinon. Les autres routes (`/actus`, `/evenements`, `/matches`) restent publiques.
- **Redirection post-login** : après connexion, revenir sur `/matches`.

### 2. Floating Action Button (FAB) — Créer un match

- Visible **uniquement dans l'onglet `/matches`** et **uniquement si l'utilisateur est authentifié**.
- Position : `fixed`, bas de l'écran, à droite, au-dessus de la `BottomNav` (tenir compte du `padding-bottom` safe-area iPhone).
- Action : navigue vers `/matches/new`.

### 3. Formulaire de création de match — `pwa/src/pages/NewMatchPage.tsx`

Route : `/matches/new` (protégée).

Formulaire iso back-office (`src/components/LiveMatchForm.tsx`) :

| Champ | Type | Obligatoire |
|---|---|---|
| Type de match | select Simple / Double | Oui |
| Date | date | Oui |
| Heure de début | time | Non |
| Événement lié | select (events des 30 derniers jours) | Non |
| J1 Prénom, Nom | text | Oui |
| J1 Classement, Club | text | Non |
| J2 Prénom, Nom | text | Oui |
| J2 Classement, Club | text | Non |
| J3 Prénom, Nom (si double) | text | Oui si double |
| J3 Classement, Club | text | Non |
| J4 Prénom, Nom (si double) | text | Oui si double |
| J4 Classement, Club | text | Non |

- Création avec `status = 'pending'`, `scored_by = null`.
- Après soumission : redirection vers `/matches`.

### 4. Actions sur les cartes match — `MatchCard.tsx`

Adapter `MatchCard.tsx` pour afficher des actions conditionnelles selon l'état d'authentification et l'ownership du live :

| Situation | Boutons affichés |
|---|---|
| `status = 'pending'`, utilisateur authentifié | **"Démarrer le live"** |
| `status = 'live'`, `scored_by = auth.uid()` | **"Reprendre le live"** + **"Libérer"** |
| `status = 'live'`, `scored_by ≠ auth.uid()` | Aucun (lecture seule) |
| `status = 'finished'`, utilisateur authentifié | **"Voir"** + **"Supprimer"** |
| Utilisateur non authentifié | Aucun |

**"Démarrer le live"** : `update({ status: 'live', scored_by: auth.uid() })`, puis navigation vers `/matches/:id/score`.

**"Libérer"** : `update({ status: 'pending', scored_by: null })`. Le match repasse en attente et peut être repris par n'importe quel utilisateur authentifié. Afficher une confirmation avant d'exécuter.

**"Supprimer"** : confirmation + `supabase.from('live_matches').delete()`.

### 5. Page de saisie de score — `pwa/src/pages/LiveMatchPage.tsx`

Route : `/matches/:id/score` (protégée).

- Accessible si `status = 'live'` **et** `scored_by = auth.uid()`. Sinon : rediriger vers `/matches` avec un message d'erreur ("Ce live est géré par quelqu'un d'autre" ou "Ce match n'est pas en cours").
- Interface de saisie iso back-office : adapter `src/components/LiveScoreEntry.tsx` et `src/pages/LiveMatchPage.tsx` pour la PWA.
- Même logique de boutons +/- par joueur, même gestion des sets (tiebreak auto à 6/6, format set 3), même sauvegarde Supabase immédiate à chaque action.
- Même logique de détection automatique de fin de match et bouton "Annuler la fin de match".
- Copier `src/liveScoreRules.ts` dans `pwa/src/liveScoreRules.ts` (voir note ci-dessous).

---

## Fichiers à créer dans `pwa/src/`

```
pwa/src/
  pages/
    LoginPage.tsx          # Formulaire email/mot de passe
    NewMatchPage.tsx       # Formulaire de création (iso LiveMatchForm.tsx du BO)
    LiveMatchPage.tsx      # Saisie du score (iso LiveMatchPage.tsx du BO)
  components/
    matches/
      LiveScoreEntry.tsx   # Composant +/- (adapté depuis le BO)
  liveScoreRules.ts        # Copié depuis src/liveScoreRules.ts
```

## Fichiers à modifier dans `pwa/src/`

- `App.tsx` : ajouter les routes `/login`, `/matches/new`, `/matches/:id/score` + guard d'authentification
- `lib/supabase.ts` : ajouter `auth: { persistSession: true, autoRefreshToken: true }`
- `components/matches/MatchCard.tsx` : ajouter les boutons conditionnels
- `pages/MatchesPage.tsx` : ajouter le FAB, passer le contexte auth aux cartes

---

## Aucune migration SQL nécessaire

Tout le schéma est déjà en place :
- `scored_by UUID REFERENCES auth.users(id)` existe dans `live_matches`
- Les policies RLS `authenticated` pour INSERT/UPDATE/DELETE sont déjà créées (migration `20260423_live_matches.sql`)
- La policy `live_matches_anon_select` (lecture publique) est décrite dans `docs/specs/PWA.MD`

Vérifier que `live_matches_anon_select` est bien appliquée avant de commencer le développement. Si ce n'est pas le cas, l'exécuter manuellement dans le dashboard Supabase.

---

## Ordre d'implémentation recommandé

1. Config auth dans `lib/supabase.ts` + `LoginPage.tsx` + guard dans `App.tsx` → vérifier que le login fonctionne et que la session persiste après fermeture de l'app
2. `MatchesPage` + `MatchCard` : détecter l'état d'authentification, afficher le FAB et les boutons conditionnels sur les cartes
3. `NewMatchPage` : formulaire de création
4. `LiveMatchPage` + `LiveScoreEntry` : saisie du score
5. Tests manuels (voir ci-dessous)

---

## Scénarios de test manuels

- Login / logout → vérifier que la session persiste après fermeture et réouverture de l'app
- Créer un match depuis la PWA → vérifier qu'il apparaît dans la liste et dans le back-office
- Démarrer un live depuis la PWA → vérifier que `scored_by` est bien renseigné en base et que le score est mis à jour en Realtime côté lecteurs anonymes
- Depuis un second compte authentifié : vérifier que la carte du live en cours n'affiche aucun bouton d'action
- Libérer un live → vérifier que le match repasse en `pending` et qu'un autre utilisateur peut le reprendre
- Créer un match dans le back-office, démarrer le live depuis la PWA → vérifier que tout fonctionne (cas nominal du use case tournoi)
- Supprimer un match → vérifier la confirmation et la disparition de la liste

---

## Points d'attention

- **`liveScoreRules.ts`** : ce fichier vit dans `src/` (back-office). Le copier dans `pwa/src/` et noter dans `docs/CODEBASE.md` qu'il existe en deux exemplaires — ils doivent rester synchronisés si les règles de score changent.
- **Realtime + auth** : le canal Realtime `live_matches_pwa` dans `MatchesPage` fonctionne en `anon`. L'authentification ne change pas ce comportement — ne pas toucher à cette logique.
- **UX mobile** : les boutons d'action sur les cartes doivent avoir une zone de tap minimum de 44px. Veiller à ce que les boutons "Libérer" et "Supprimer" ne soient pas trop proches l'un de l'autre.
- **Ne pas modifier le back-office** (`src/`) dans le cadre de cette tâche.
