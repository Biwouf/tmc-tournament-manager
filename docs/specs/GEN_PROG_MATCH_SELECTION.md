# Sélection des matchs à basculer vers Live Score

> Module : `src/pages/ProgrammationImagePage.tsx`
> Dépend de : `docs/specs/GEN_PROG.md` (section « Basculement vers Live Score »)

---

## Contexte & motivations

Le basculement GEN_PROG → Live Score insère actuellement **tous** les matchs complets détectés en une seule opération. En pratique, certains matchs d'une feuille FFT/TEN'UP sont déjà terminés, annulés ou ne concernent pas le live du jour — les inclure génère des entrées parasites dans Live Score qu'il faut ensuite supprimer manuellement.

La feature donne à l'utilisateur la possibilité de cocher/décocher les matchs individuellement avant de lancer le transfert, tout en conservant le comportement actuel (tous sélectionnés) comme état initial.

---

## Objectifs

- Permettre à l'utilisateur de sélectionner un sous-ensemble de matchs complets avant le transfert.
- Conserver « tout sélectionné » comme état par défaut — aucun clic supplémentaire requis pour le cas nominal.
- Afficher en temps réel le nombre de matchs qui seront transférés dans le libellé du bouton.

---

## Mesure du succès

L'utilisateur peut exclure un ou plusieurs matchs du transfert sans avoir à supprimer les entrées manuellement dans Live Score après coup. Le cas nominal (tout transférer) ne nécessite pas d'action supplémentaire par rapport à aujourd'hui.

---

## Périmètre

**In scope**
- Affichage d'une liste de cases à cocher dans la zone « Envoyer vers Live Score », une ligne par match complet.
- Case à cocher maître « Tout sélectionner / Tout désélectionner ».
- Mise à jour dynamique du compteur dans le bouton en fonction de la sélection.
- Désactivation du bouton si aucun match n'est sélectionné.
- Réinitialisation de la sélection à « tout coché » à chaque nouveau chargement (PDF ou CSV).

**Out of scope**
- Réordonner les matchs dans la liste.
- Modifier les données d'un match depuis cette vue (joueurs, heure, etc.).
- Mémoriser la sélection entre deux imports.
- Sélection des matchs incomplets (exclusion inchangée : les matchs avec `j2_nom === ""` restent ignorés).

---

## Parcours utilisateurs

### Parcours nominal

1. L'utilisateur importe un PDF ou colle un CSV.
2. La zone « Envoyer vers Live Score » apparaît avec la liste des matchs complets, **tous cochés**.
3. L'utilisateur décoche un ou plusieurs matchs qu'il ne souhaite pas transférer.
4. Le libellé du bouton se met à jour : `"Basculer N match(s) vers Live Score"` où N = nombre de cases cochées.
5. L'utilisateur clique sur le bouton → seuls les matchs cochés sont insérés dans `live_matches`.
6. Les états post-transfert (`done` / `error`) s'appliquent comme avant.

### Parcours alternatifs & edge cases

| Cas | Comportement |
|---|---|
| Tous les matchs sont décochés | Bouton désactivé ; libellé `"Basculer 0 match(s) vers Live Score"`. |
| Un seul match complet dans la liste | Case maître et case individuelle se comportent de façon identique. |
| Nouveau PDF/CSV importé après une sélection partielle | `selectedMatchIndices` se réinitialise à « tout coché » (même logique que `transferStatus`). |
| Transfert effectué avec sélection partielle, puis nouvel import | Retour à l'état initial : tous cochés, bouton actif. |
| Erreur Supabase sur un transfert partiel | Comportement inchangé : message d'erreur inline, bouton reste actif pour retry. |
| Tous les matchs sont incomplets (`j2_nom === ""`) | La zone n'est pas affichée (condition `matches.filter(isComplete).length > 0` inchangée). |

---

## Spécifications fonctionnelles détaillées

### Zone « Envoyer vers Live Score » — structure révisée

La zone est affichée si `completeMatches.length > 0` (matchs avec `j2_nom !== ""`). Elle contient, dans l'ordre :

1. **Titre** — « Envoyer vers Live Score » (inchangé).
2. **`<select>` événement** — inchangé.
3. **Liste de sélection des matchs** — nouvelle section, décrite ci-dessous.
4. **Bouton de transfert** — libellé et état mis à jour.

### Liste de sélection

La liste est un composant inline (pas de modale, pas de popover) affiché entre le `<select>` événement et le bouton de transfert.

**En-tête de liste :**
- Case à cocher maître à gauche, libellé `"Tout sélectionner"` à droite.
- État de la case maître : cochée si toutes les cases individuelles sont cochées, décochée si aucune n'est cochée, indéterminée (`indeterminate`) si sélection partielle.
- Clic sur la case maître : si état coché ou indéterminé → tout décocher ; si état décoché → tout cocher.

**Lignes de matchs :**
- Une ligne par match complet, dans l'ordre d'apparition dans `matches`.
- Chaque ligne contient : case à cocher individuelle · heure du match (`match.heure` ou « — » si vide) · type de tournoi (`match.type_tournoi` ou « — » si vide) · nom des joueurs (`match.j1_prenom match.j1_nom vs match.j2_prenom match.j2_nom`).
- Clic sur une ligne (n'importe où, pas seulement la case) → toggle la case.

### État React — ajouts

| State | Type | Rôle |
|---|---|---|
| `selectedMatchIndices` | `Set<number>` | Indices (dans `matches`) des matchs complets sélectionnés pour le transfert. Initialisé avec tous les indices de matchs complets. Réinitialisé à chaque changement de `matches`. |

Le calcul du payload de transfert filtre `matches` pour ne conserver que les entrées dont l'index figure dans `selectedMatchIndices` **et** dont `j2_nom !== ""`.

### Bouton de transfert — libellé mis à jour

| État | Libellé |
|---|---|
| Idle, N > 0 | `"Basculer N match(s) vers Live Score"` |
| Idle, N = 0 | `"Basculer 0 match(s) vers Live Score"` (bouton désactivé) |
| Loading | `"Envoi…"` (désactivé) |
| Done | `"N match(s) ajouté(s) ✓"` (désactivé, style succès) |
| Error | Libellé idle réactivé + message d'erreur inline |

N correspond à `selectedMatchIndices.size` (avant transfert) ou au nombre de matchs effectivement envoyés (état done).

---

## Brief Design

### Contraintes visuelles & UX

La liste de sélection s'insère dans la zone déjà existante « Envoyer vers Live Score » (`ProgrammationImagePage`). Elle doit rester compacte pour ne pas pousser l'aperçu de l'affiche trop bas. Chaque ligne de match doit être lisible d'un coup d'œil — heure + joueurs suffisent ; les classements et clubs ne sont pas nécessaires ici. (déduit — à confirmer)

### Contraintes techniques impactant le design

La liste peut contenir jusqu'à 8 matchs par page d'affiche (constante `MAX_PER_PAGE`), et jusqu'à 16 si deux pages sont générées. Dans tous les cas courants (1 journée de tournoi), la liste tient en hauteur sans scroll. (codebase)

### Patterns UI existants à respecter

Le projet utilise Tailwind CSS. Les cases à cocher doivent suivre le style natif ou la convention Tailwind déjà en place dans les formulaires (`LiveMatchForm`, `EventForm`). La zone « Envoyer vers Live Score » est une `div` avec un fond légèrement distinct — la liste doit s'y intégrer visuellement sans introduire de nouveau niveau de profondeur. (codebase)

### Points ouverts design

- Le clic sur la ligne entière (au lieu de la seule case) est recommandé pour l'ergonomie mobile/tactile — à valider avec l'implémentation.

---

<details>
<summary>💡 Impact sur la codebase (pistes — à affiner avec l'équipe)</summary>

Le changement est entièrement confiné à `src/pages/ProgrammationImagePage.tsx`. Aucun autre fichier ni aucune table Supabase n'est impacté.

Pistes d'implémentation :
- Ajouter le state `selectedMatchIndices: Set<number>` dans la page.
- Calculer `completeMatches` avec `useMemo` à partir de `matches` (filtre `j2_nom !== ""`).
- Réinitialiser `selectedMatchIndices` dans le même `useEffect` / gestionnaire qui réinitialise `transferStatus` lors d'un changement de `matches`.
- La liste de sélection pourrait être extraite dans un sous-composant `MatchSelectionList` si la page devient trop longue, mais ce n'est pas obligatoire.
- Les indices dans `selectedMatchIndices` référencent **`completeMatches`** (le tableau dérivé), pas `matches`. Travailler uniquement sur `completeMatches` du début à la fin évite tout risque de désalignement : la liste est rendue en itérant sur `completeMatches`, et le payload du `insert` est simplement `completeMatches.filter((_, i) => selectedMatchIndices.has(i))`. Ne pas mélanger avec les indices de `matches`.

</details>

<details>
<summary>💡 Découpage en sous-tâches suggéré (proposition — à retravailler avec les devs)</summary>

1. Ajouter le state `selectedMatchIndices` et son initialisation/reset dans `ProgrammationImagePage`.
2. Implémenter la liste de sélection (case maître + lignes individuelles).
3. Brancher le filtre sur le payload de transfert.
4. Mettre à jour le libellé et l'état désactivé du bouton.
5. Tester les edge cases (0 sélectionné, 1 seul match, reset après nouvel import).

</details>

---

## Plan de tests

| Scénario | Vérification |
|---|---|
| Import CSV — état initial | Tous les matchs complets sont cochés, bouton actif avec le bon N |
| Décocher un match | N décrémenté dans le bouton |
| Tout décocher manuellement | Case maître décochée, bouton désactivé |
| Clic sur case maître (état décoché) | Tous les matchs cochés |
| Clic sur case maître (état coché) | Tous les matchs décochés |
| Clic sur case maître (état indéterminé) | Tous les matchs décochés |
| Transférer une sélection partielle | Seuls les matchs cochés apparaissent dans `/live-score` section "En attente" |
| Nouvel import après sélection partielle | Tous les matchs du nouvel import sont cochés, compteur correct |
| Nouvel import après transfert réussi | État initial rétabli (tout coché, bouton idle) |
| 0 match sélectionné → clic bouton | Impossible — bouton désactivé |

---

## Plan de tag analytics

Outil de tracking non défini pour cette application (usage interne club). Pas de tracking prévu sur cette feature.

---

## Points de vigilance légaux & RGPD

Application back-office interne, accès authentifié uniquement. Aucune donnée personnelle supplémentaire n'est collectée par cette feature. La sélection est purement locale (state React, pas de persistance). Aucune implication RGPD identifiée.

---

## Points ouverts

| # | Question | Origine | À trancher avec |
|---|---|---|---|
| 1 | Le clic sur la ligne entière (pas seulement la case) pour toggle est recommandé pour l'ergonomie tactile — à confirmer ou infirmer selon les choix d'accessibilité. | Déduit | Dev |
| 2 | Si `MAX_PER_PAGE = 8` et qu'une feuille PDF contient 16 matchs complets, la liste peut atteindre 16 lignes. Faut-il une hauteur max avec scroll, ou laisser la liste s'étendre ? | Déduit | PM + Dev |
