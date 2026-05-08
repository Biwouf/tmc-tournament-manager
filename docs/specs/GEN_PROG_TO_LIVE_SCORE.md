# Basculement GEN_PROG → Live Score

> Module : `src/pages/ProgrammationImagePage.tsx`
> Spec créée : 2026-05-07

---

## Contexte & motivations

Le module Programmation Image (`/programmation-image`) permet d'importer une feuille FFT/TEN'UP et de générer une affiche des matchs du jour. Ces matchs sont déjà structurés en mémoire (joueurs, classements, clubs, horaires) mais restent isolés dans ce module.

Le module Live Score (`/live-score`) gère la saisie de score en temps réel, mais la création d'un match y est manuelle et fastidieuse (formulaire champ par champ).

Cette fonctionnalité crée un pont entre les deux modules : depuis l'affiche générée, l'utilisateur peut basculer l'ensemble des matchs détectés vers Live Score en un clic, avec pré-remplissage automatique de toutes les données.

---

## Objectifs

- Éliminer la double saisie entre GEN_PROG et Live Score.
- Permettre de lier les matchs basculés à un événement TMC existant au moment du transfert.
- Ne pas démarrer les lives automatiquement — chaque match reste en `status = 'pending'` et doit être démarré manuellement depuis Live Score.

---

## Mesure du succès

- L'utilisateur peut transférer tous les matchs d'une affiche vers Live Score en moins de 30 secondes.
- Aucune donnée saisie dans GEN_PROG n'a besoin d'être ressaisie dans Live Score.

---

## Périmètre

**In scope**
- Bouton de basculement global (tous les matchs de l'affiche d'un coup).
- Sélecteur d'événement optionnel avant confirmation.
- Création des entrées `live_matches` en `status = 'pending'`.
- Feedback visuel après transfert (bouton désactivé "Ajoutés ✓").
- Mise à jour de la constante `FAKE_CSV` pour utiliser la date du jour (debug).

**Out of scope**
- Basculement match par match (les matchs sont toujours transférés en bloc).
- Création d'un événement à la volée depuis cette page.
- Démarrage automatique du live.
- Dé-duplication automatique si le même match est transféré deux fois.
- Annulation / rollback d'un basculement.
- Modification des matchs après basculement (se fait dans Live Score).

---

## Parcours utilisateurs

### Parcours nominal

1. L'utilisateur importe un PDF ou colle un CSV dans `/programmation-image`.
2. L'affiche s'affiche avec les N matchs détectés.
3. Une zone **"Basculer vers Live Score"** apparaît sous l'affiche (visible uniquement si `matches.length > 0`).
4. Dans cette zone :
   - Un `<select>` affiche les événements disponibles (chargés depuis la table `events`, triés par date DESC). L'option par défaut est "Aucun événement".
   - Un bouton **"Basculer N match(s) vers Live Score"** est cliquable.
5. L'utilisateur sélectionne un événement (optionnel) puis clique sur le bouton.
6. Pendant l'envoi : le bouton affiche un état de chargement ("Envoi…") et est désactivé.
7. Sur succès : le bouton devient définitivement désactivé avec le label **"N match(s) ajouté(s) ✓"**. Le `<select>` est également désactivé.
8. Les matchs sont visibles dans `/live-score` en section "En attente".

### Parcours alternatifs & edge cases

| Cas | Comportement attendu |
|---|---|
| Erreur Supabase lors de l'insert | Message d'erreur inline sous le bouton. Le bouton reste actif pour permettre une nouvelle tentative. Aucun match partiellement inséré ne doit rester sans les autres (voir Points ouverts #1). |
| Aucun événement disponible dans la table `events` | Le `<select>` affiche uniquement "Aucun événement". Le transfert reste possible sans `event_id`. |
| Nouvelle importation PDF/CSV après un transfert | L'état du bouton se réinitialise à "idle" (le bouton redevient actif pour la nouvelle série de matchs). |
| 0 match détecté après import | La zone "Basculer vers Live Score" n'est pas affichée. |
| Clic répété sur le bouton (doublon) | Non applicable — le bouton est désactivé après le premier transfert réussi. En cas d'erreur, le clic relance une tentative (les doublons côté base sont possibles — voir Points ouverts #2). |

---

## Spécifications fonctionnelles détaillées

### Zone "Basculer vers Live Score"

**Condition d'affichage :** `matches.length > 0`

**Position :** sous l'affiche (après la zone d'aperçu et le bouton "Télécharger").

**Composants de la zone :**

1. **Titre de section** — ex. "Envoyer vers Live Score"
2. **Sélecteur d'événement** — `<select>` chargé au montage de la page (ou au premier affichage de la zone) :
   - Requête : `supabase.from('events').select('id, title, start_date').order('start_date', { ascending: false })`
   - Option par défaut : `value=""`, label "Aucun événement"
   - Chaque option affiche `[title] — [date formatée JJ/MM/YYYY]`
   - Désactivé pendant le chargement de la liste et après un transfert réussi
3. **Bouton de basculement** — label dynamique :
   - Idle : "Basculer N match(s) vers Live Score"
   - Loading : "Envoi…" (désactivé)
   - Done : "N match(s) ajouté(s) ✓" (désactivé, style succès)
   - Error : "Basculer N match(s) vers Live Score" (actif, message d'erreur visible à côté)

### Mapping Match → LiveMatch

Pour chaque match de `matches[]`, insérer un enregistrement dans `live_matches` avec les valeurs suivantes :

| Champ `live_matches` | Source | Valeur |
|---|---|---|
| `match_date` | `match.date` | `"YYYY-MM-DD"` |
| `start_time` | `match.heure` | `"HH:MM"` ou `null` si vide |
| `match_type` | — | `'simple'` (toujours) |
| `j1_prenom` | `match.j1_prenom` | |
| `j1_nom` | `match.j1_nom` | |
| `j1_classement` | `match.j1_classement` | |
| `j1_club` | `match.j1_club` | `""` si absent |
| `j2_prenom` | `match.j2_prenom` | |
| `j2_nom` | `match.j2_nom` | |
| `j2_classement` | `match.j2_classement` | |
| `j2_club` | `match.j2_club` | `""` si absent |
| `j3_*`, `j4_*` | — | tous `null` |
| `event_id` | Sélecteur | UUID sélectionné ou `null` |
| `status` | — | `'pending'` |
| `scored_by` | — | `null` |
| `winner` | — | `null` |
| `finished_at` | — | `null` |
| `set*` | — | tous `null` |

**Stratégie d'insert :** `supabase.from('live_matches').insert([...allMatches])` — un seul appel avec tous les matchs.

### Réinitialisation de l'état

L'état de transfert (`transferStatus`) se réinitialise à `'idle'` à chaque fois que la liste `matches` change (nouveau PDF/CSV importé). Cela permet de re-transférer après une nouvelle importation.

### Mise à jour du FAKE_CSV (debug)

La constante `FAKE_CSV` dans `ProgrammationImagePage.tsx` utilise actuellement des dates hardcodées (février). Pour permettre de tester le basculement sans avoir à modifier manuellement le CSV, la date doit être générée dynamiquement à l'exécution :

```ts
const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
```

Remplacer toutes les dates hardcodées de `FAKE_CSV` par cette valeur.

---

## Brief Design

### Contraintes visuelles & UX

- La zone de basculement ne doit pas interférer avec l'affiche ni avec le bouton "Télécharger". Elle se situe après ces éléments, clairement séparée.
- Le bouton doit refléter l'état du transfert : neutral → loading → success (vert ou icône check) / error.
- En état "done", le style doit signaler clairement que l'action a déjà été effectuée (pas seulement le label — couleur, icône).
- Le sélecteur d'événement doit être visible mais non intrusif : le transfert sans événement est un cas valide et fréquent.

### Contraintes techniques impactant le design

- Le chargement de la liste des événements est asynchrone. Prévoir un état de chargement sur le `<select>` (désactivé + label "Chargement…") et un état d'erreur si la requête échoue.
- L'insert Supabase peut prendre quelques centaines de ms pour N matchs. L'état "loading" sur le bouton est nécessaire.
- Le `type_tournoi` (catégorie + type du match, ex. `"30 15/5 SM Senior"`) n'est pas stocké dans `live_matches`. Il n'est pas affiché dans cette zone — à ne pas créer d'attente visuelle sur ce point.

### Patterns UI existants à respecter

- Suivre les patterns de `LiveMatchForm.tsx` pour le `<select>` d'événement (même logique de chargement depuis `events`, même option vide par défaut).
- Suivre les conventions de style Tailwind existantes dans `ProgrammationImagePage.tsx`.
- Les états loading/error/success utilisent des patterns déjà présents dans d'autres formulaires du BO (ex. `EventForm.tsx`, `ActuForm.tsx`).

---

<details>
<summary>💡 Impact sur la codebase (pistes — à affiner avec l'équipe)</summary>

**Fichier principal à modifier :** `src/pages/ProgrammationImagePage.tsx`

Nouvelles variables de state à envisager :
- `transferStatus: 'idle' | 'loading' | 'done' | 'error'` — piloter l'état du bouton
- `transferError: string | null` — message d'erreur à afficher
- `selectedEventId: string | null` — valeur du sélecteur
- `events: { id: string; title: string; start_date: string }[]` — liste pour le `<select>`
- `eventsLoading: boolean` — pour désactiver le `<select>` pendant le fetch

`transferStatus` devrait se réinitialiser à `'idle'` dans le `useEffect` ou le handler qui met à jour `matches`.

**Pas de migration SQL nécessaire** — la table `live_matches` existe et `event_id` est déjà nullable.

**Pas de nouveau composant** — la zone peut être inline dans `ProgrammationImagePage.tsx`, sauf si elle dépasse ~80 lignes (à juger au moment de l'implémentation).

</details>

<details>
<summary>💡 Découpage en sous-tâches suggéré (proposition — à retravailler avec les devs)</summary>

1. **FAKE_CSV date dynamique** — Remplacer les dates hardcodées par `new Date().toISOString().split('T')[0]`. Rapide, permet de tester dès le début.
2. **Chargement des events** — Ajouter le fetch `events` dans `ProgrammationImagePage` et le `<select>` conditionnel. Peut se baser sur le code de `LiveMatchForm.tsx`.
3. **Zone de basculement + état** — Ajouter les états `transferStatus` / `selectedEventId`, le bouton avec ses états visuels, et la logique de reset quand `matches` change.
4. **Fonction de transfert** — Implémenter le mapping Match → LiveMatch et l'insert Supabase en un seul appel.
5. **Tests manuels** — Importer un CSV de test (avec date du jour), basculer, vérifier dans `/live-score`.

</details>

---

## Plan de tests

| Scénario | Vérification |
|---|---|
| Import CSV avec matchs à la date du jour | La zone "Basculer" apparaît, le bouton indique le bon nombre de matchs |
| Clic sur "Basculer" sans événement sélectionné | Les matchs sont créés dans `live_matches` avec `event_id = null`, status `pending` |
| Clic sur "Basculer" avec un événement sélectionné | Les matchs sont créés avec le bon `event_id` |
| Vérification dans `/live-score` | Les matchs apparaissent dans la section "En attente" avec les bonnes données (joueurs, horaire, club) |
| Import d'un nouveau CSV après basculement | Le bouton repasse à l'état "idle" |
| Bouton "Charger des données de test" | Les matchs apparaissent avec la date du jour (non plus février) |
| Erreur réseau simulée | Un message d'erreur s'affiche, le bouton reste actif |

---

## Points ouverts

| # | Question | Origine | À trancher avec |
|---|----------|---------|-----------------|
| 1 | En cas d'erreur partielle (ex. 3 matchs insérés sur 8), faut-il rollback ou garder les inserts réussis ? L'approche la plus simple est "tout ou rien" via un seul `insert([...])` — si Supabase rejette un item, toute la transaction échoue. À confirmer. | Spec | Dev |
| 2 | Rien n'empêche de transférer deux fois la même affiche (si l'utilisateur re-importe le même PDF). Faut-il ajouter un guard (ex. détection de doublons par `match_date + start_time + j1_nom + j2_nom`) ? En v1, pas de dé-duplication — à surveiller en usage réel. | Spec | PM + Dev |
| 3 | Le `type_tournoi` (catégorie du tableau) n'est pas stocké dans `live_matches`. Si ce besoin remonte plus tard, une migration sera nécessaire. | Choix fonctionnel | PM |
