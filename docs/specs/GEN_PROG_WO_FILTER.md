# GEN_PROG — Filtrage des matchs WO (walkover)

> Module : `src/pages/ProgrammationImagePage.tsx`
> Spec parent : `docs/specs/GEN_PROG.md`

---

## Contexte & motivations

La feuille de pointage Ten'Up / FFT comporte une colonne dédiée indiquant si un match s'est conclu sur un walkover (WO). Un match WO signifie qu'un joueur a déclaré forfait — il n'y a pas de match à jouer. Ces matchs ne doivent pas figurer sur l'affiche de programmation, qui représente uniquement les matchs à disputer.

La même logique s'applique au transfert vers Live Score : un match WO ne génère aucune activité live.

---

## Objectifs

- Exclure les matchs marqués WO du rendu de l'affiche (aucune cellule affichée, aucun emplacement réservé).
- Exclure les matchs WO du compteur et du payload de transfert vers Live Score.
- Prendre en charge le flag WO dans les deux modes d'import (PDF et CSV).

---

## Périmètre

**In scope**
- Détection du flag WO au parsing PDF (colonne dédiée Ten'Up).
- Ajout d'un champ `wo` optionnel dans le modèle `Match`.
- Ajout d'une colonne `wo` optionnelle dans le schéma CSV (rétrocompatible).
- Filtrage des matchs WO avant rendu de l'affiche.
- Filtrage des matchs WO dans le compteur et le payload « Basculer vers Live Score ».

**Out of scope**
- Affichage des matchs WO dans un encart ou tableau séparé.
- Toute modification du modèle `live_matches` Supabase.
- Modification de la PWA.

---

## Modèle de données

Ajouter un champ `wo` au type `Match` **local** à `src/pages/ProgrammationImagePage.tsx` (le `Match` de `src/types.ts` est celui du TMC Planner — shape distincte, sans rapport avec ce module) :

```ts
interface Match {
  // ... champs existants
  wo: boolean;  // true si le match est un walkover
}
```

**Valeur par défaut :** `false`. Tous les matchs parsés sans information WO reçoivent `wo: false`.

---

## Spécifications fonctionnelles détaillées

### 1. Mode PDF — détection du flag WO

La feuille Ten'Up comporte une colonne « Score » dans le bloc de chaque match. Sur un match WO, le token `"WO"` remplace les `... / ...` (3 sets) habituellement affichés à cet emplacement.

Calibration faite sur `public/feuille_de_pointage_wo.pdf` : le token `"WO"` apparaît à y ≈ 668 (zone score, juste sous le label `"Score"` à y ≈ 670), à un offset X compris dans la slice de colonne déjà utilisée par le parser (`[nc.x - 15, nc.x + 50]` autour de l'ancre `N° Court`). Le token n'apparaît jamais ailleurs dans la page.

Implémentation : pour chaque colonne-match isolée par l'ancre `N° Court`, on scanne tous les items de la slice et on positionne `wo: true` si l'un d'eux est `"WO"` (insensible à la casse). Aucune contrainte Y supplémentaire n'est nécessaire.

### 2. Mode CSV — colonne `wo` optionnelle

Ajout d'une colonne optionnelle au schéma CSV existant :

```
date,heure,type_tournoi,j1_prenom,j1_nom,j1_classement,j2_prenom,j2_nom,j2_classement,wo
```

| Colonne | Format | Valeurs acceptées | Défaut si absent |
|---------|--------|-------------------|-----------------|
| `wo` | Texte | `"WO"`, `"wo"`, `"1"`, `"true"`, `"oui"` (insensible à la casse) → `true` ; toute autre valeur ou colonne absente → `false` | `false` |

La colonne est **optionnelle** : les CSV existants sans colonne `wo` continuent de fonctionner sans modification.

Le `FAKE_CSV` (données de test) ne doit **pas** inclure de matchs WO. Aucune modification requise.

### 3. Filtrage à l'affichage

Avant de découper les matchs en pages, appliquer un filtre :

```ts
const displayMatches = matches.filter(m => !m.wo);
```

`displayMatches` est la liste utilisée pour la pagination et le rendu des `MatchCell`. `matches` (état React) conserve tous les matchs parsés, WO inclus — ce filtrage est uniquement applicatif, pas sur l'état source.

Conséquences :
- Un match WO n'occupe aucune cellule sur l'affiche. La grille se remplit avec les matchs non-WO uniquement.
- La pagination (MAX_PER_PAGE = 8) est recalculée sur `displayMatches`.
- Si tous les matchs sont WO, l'affiche est vide (comportement identique à `matches.length === 0` pour la zone d'aperçu — à gérer si applicable).

### 4. Filtrage pour le transfert vers Live Score

Le compteur et le payload du bouton « Basculer vers Live Score » se basent déjà sur les matchs complets (`j2_nom !== ""`). Étendre ce filtre pour exclure aussi les matchs WO :

```ts
const transferableMatches = matches.filter(m => !m.wo && m.j2_nom !== "");
```

- Le libellé du bouton reflète `transferableMatches.length`.
- Le payload `insert` ne contient que `transferableMatches`.
- Si `transferableMatches.length === 0`, le bouton reste visible mais désactivé (cohérent avec le comportement existant pour les matchs incomplets).

---

## Plan de tests

| Scénario | Vérification |
|----------|-------------|
| Import CSV sans colonne `wo` | Tous les matchs ont `wo: false`, rien ne change à l'affichage |
| Import CSV avec `wo = "WO"` sur un match | Le match WO n'apparaît pas sur l'affiche ; le compteur Live Score l'exclut |
| Import CSV avec `wo = "1"` et `wo = "oui"` | Même comportement que `"WO"` |
| Import CSV avec `wo = ""` ou valeur inconnue | `wo: false`, match affiché normalement |
| Match WO + match complet | L'affiche contient uniquement le match complet |
| Tous les matchs WO | Affiche vide, bouton Live Score désactivé (0 match) |
| Match WO incomplet (`j2_nom === ""` et `wo: true`) | Exclu de l'affiche et du transfert (les deux filtres s'appliquent) |
| Import PDF avec colonne WO renseignée | Match WO détecté, `wo: true`, absent de l'affiche |

---

<details>
<summary>💡 Impact sur la codebase (pistes — à affiner avec l'équipe)</summary>

- **`src/types.ts`** — ajouter `wo: boolean` à l'interface `Match`.
- **`src/pages/ProgrammationImagePage.tsx`** — deux zones à modifier :
  - Le parser CSV : détecter la colonne `wo` et normaliser la valeur en `boolean`.
  - Le parser PDF : détecter le token WO dans la plage X/Y dédiée (coordonnées à confirmer — voir Point ouvert #1).
  - Le calcul de `displayMatches` (filtrage avant pagination/rendu).
  - Le calcul de `transferableMatches` (filtrage avant le `insert` Supabase).
- **Aucune migration Supabase requise** : `wo` est un filtre purement côté client.
- **`src/types.ts` PWA** : le type `Match` de la PWA n'est pas consommé dans ce flux — pas de modification requise.

</details>

<details>
<summary>💡 Découpage en sous-tâches suggéré (proposition — à retravailler avec les devs)</summary>

1. Ajouter `wo: boolean` dans `src/types.ts` + valeur par défaut `false` partout où un `Match` est construit.
2. Parser CSV : détecter et normaliser la colonne `wo`.
3. Parser PDF : détecter la colonne WO (après confirmation des coordonnées — Point ouvert #1).
4. Filtrer `displayMatches` dans le rendu de l'affiche.
5. Étendre le filtre `transferableMatches` pour le transfert Live Score.
6. Tests manuels selon le plan de tests ci-dessus.

</details>

---

## Points ouverts

| # | Question | Origine | À trancher avec | Statut |
|---|----------|---------|-----------------|--------|
| 1 | **Coordonnées PDF de la colonne WO** : quelle est la plage X/Y (relative à l'ancre `N° Court`) où le token `"WO"` apparaît sur la feuille Ten'Up ? | Brief — information manquante | Dev + Maxime | ✅ Résolu — calibré sur `public/feuille_de_pointage_wo.pdf` (token `"WO"` à y≈668, dans la slice X de colonne déjà utilisée). Voir §1. |
| 2 | **Matchs WO sur l'affiche** : doit-on afficher un compteur ou une mention « N match(s) WO ignoré(s) » dans l'interface, ou silencieusement les ignorer ? | Non spécifié | Maxime | ✅ Tranché — ignorés silencieusement (pas de compteur dédié). |
| 3 | **`FAKE_CSV`** : souhaite-t-on un match WO dans les données de test pour faciliter le développement ? | Pratique de dev | Dev | ✅ Tranché — non, `FAKE_CSV` inchangé. |
