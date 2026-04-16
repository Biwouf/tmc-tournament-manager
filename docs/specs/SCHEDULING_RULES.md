# Règles fonctionnelles — Algorithme de planification TMC

## 1. Contexte

Un tournoi TMC (Tournoi Multi-Chances) garantit que **chaque joueur joue le même nombre de matchs**, quel que soit son parcours (gagner ou perdre ne met pas fin à son tournoi).

---

## 2. Structure des matchs par tournoi

### 4 joueurs — 4 matchs, chaque joueur joue 2 fois

```
Tour 1 : 2 demi-finales (SF1, SF2)
Tour 2 : 1 finale (vainqueurs SF1 + SF2)
         1 match 3e place (perdants SF1 + SF2)
```

### 8 joueurs — 12 matchs, chaque joueur joue 3 fois

```
Tour 1 : 4 quarts de finale (QF1, QF2, QF3, QF4)
Tour 2 : 2 demi-finales (vainqueurs QF1+QF2, QF3+QF4)
         2 matchs consolante 5-8 tour 1 (perdants QF1+QF2, QF3+QF4)
Tour 3 : 1 finale
         1 match 3e place
         2 matchs consolante 5-8 tour 2
```

### 12 joueurs — 20 matchs (cas asymétrique)

4 joueurs sont exemptés du 1er tour. Le nombre de matchs par joueur varie :
- Joueur **exempté** : **3 matchs** (quel que soit son parcours)
- Joueur **non-exempté, perd au T1** : **3 matchs**
- Joueur **non-exempté, gagne au T1** : **4 matchs**

```
Tour 1 : 4 matchs (1/8 de finale — 8 joueurs non-exemptés)
  → 4 vainqueurs → tableau principal (1/4 de finale)
  → 4 perdants  → consolante 9-12

Tour 2 : 4 matchs (1/4 de finale — 4 vainqueurs T1 + 4 exemptés)
         2 matchs (1/2 finale consolante 9-12)
  → 4 vainqueurs QF → demi-finales
  → 4 perdants QF  → consolante 5-8

Tour 3 : 2 matchs (1/2 finale principale)
         2 matchs (finale + 3e place consolante 9-12) → places 9, 10, 11, 12
         2 matchs (1/2 finale consolante 5-8)

Tour 4 : 1 finale (1re place)
         1 match 3e place
         2 matchs (finale + 3e place consolante 5-8) → places 5, 6, 7, 8
```

Classement final complet : 1→12.

### 16 joueurs — 32 matchs, chaque joueur joue 4 fois

```
Tableau principal (15 matchs) :
  Tour 1 : 8 matchs (1/8 de finale)
  Tour 2 : 4 matchs (1/4 de finale)
  Tour 3 : 2 matchs (1/2 finale)
  Tour 4 : 1 finale

Consolante 9-16 (perdants des 1/8) — 8 matchs :
  Tour 2 : 4 matchs (1/4 consolante)
  Tour 3 : 2 matchs (1/2 consolante 9-12) + 2 matchs (1/2 consolante 13-16)
  Tour 4 : matchs 9e, 11e, 13e, 15e place

Consolante 5-8 (perdants des 1/4 principaux) — 4 matchs :
  Tour 3 : 2 matchs (1/2 consolante 5-8)
  Tour 4 : matchs 5e et 7e place

Consolante 3-4 (perdants des 1/2 principales) — 1 match :
  Tour 4 : match 3e place
```

**Formule générale (puissances de 2 uniquement) :**
- Matchs par joueur = `log2(numberOfPlayers)`
- Total matchs = `(numberOfPlayers × matchesPerPlayer) / 2`

> ⚠️ Le cas 12 joueurs est asymétrique : la formule ne s'applique pas. Voir section dédiée ci-dessus.

---

## 3. Génération des créneaux horaires

- On itère sur chaque jour entre `startDate` et `endDate`.
- Un jour n'a des créneaux que s'il est configuré dans `dailyTimeSlots`.
- Les créneaux démarrent à `firstMatchStart` et se répètent tous les `matchDuration` minutes.
- Le dernier créneau généré doit avoir son **heure de début ≤ `lastMatchStart`**.
- Un créneau a une durée de `matchDuration` minutes (valeur par défaut : 90 min).

**Exemple :**
> `firstMatchStart=09:00`, `lastMatchStart=18:00`, `matchDuration=90 min`
> → Créneaux : 09:00, 10:30, 12:00, 13:30, 15:00, 16:30, 18:00

---

## 4. Contraintes de planification

### R1 — Capacité des terrains
- Le nombre de matchs simultanés ne peut pas dépasser `numberOfCourts`.
- Chaque créneau horaire peut accueillir au maximum `numberOfCourts` matchs en parallèle.

### R2 — Ordre séquentiel des tours
- Un tournoi ne peut pas jouer son tour `n+1` tant que tous les matchs du tour `n` ne sont pas planifiés.
- Aucun saut de tour n'est autorisé.

### R3 — Délai minimum entre deux tours du même tournoi
- Entre la fin du dernier match d'un tour et le début du premier match du tour suivant du **même tournoi**, il doit y avoir **au moins 4 heures**.
- Valeur codée : `MIN_HOURS_BETWEEN_MATCHES = 240 minutes`
- Le premier tour d'un tournoi est exempt de cette contrainte.

### R4 — Les finales sont des matchs comme les autres
- Les finales ne font l'objet d'aucun traitement spécial.
- Elles respectent les mêmes règles que tous les autres matchs : ordre séquentiel (R2) et délai de 4h par tournoi (R3).
- Conséquence : la finale d'un tournoi est planifiée dès que ses demi-finales sont terminées et que le délai de 4h est écoulé, indépendamment des autres tournois.

### R5 — Les matchs du dernier tour sont de préférence planifiés le dernier jour
- Contrainte **souple** : les matchs du dernier tour de chaque tournoi (finale, petite finale, consolantes finales) sont réservés au dernier jour configuré.
- **Exception (forçage)** : si le nombre de matchs restants ne peut plus tenir dans les créneaux restants (`mustScheduleNow > 0`), un match du dernier tour peut être planifié n'importe quel jour.
- "Dernier tour" = tour avec le `roundIndex` maximum pour ce tournoi (tour 2 pour 4 joueurs, tour 3 pour 8 joueurs, tour 4 pour 16 joueurs).

---

## 5. Algorithme de planification (phase unique)

L'objectif est de **répartir les matchs uniformément** sur les créneaux disponibles (éviter d'entasser tous les matchs au début). Tous les matchs — y compris les finales — sont traités de la même manière.

Pour chaque créneau :
1. Calculer combien de matchs peuvent/doivent être planifiés :
   - `mustScheduleNow` = matchs restants qu'on ne peut plus reporter (sinon on manque de créneaux)
   - `smoothTarget` = cible lissée basée sur la progression dans les créneaux disponibles
   - `allowedThisSlot = min(numberOfCourts, max(mustScheduleNow, smoothTarget))`
2. Pour chaque groupe de matchs (trié par numéro de tour croissant) :
   - Ignorer si le tour n'est pas le suivant logique du tournoi (R2)
   - Ignorer si le délai de 4h n'est pas respecté (R3)
   - Planifier le match, mettre à jour l'heure de fin du tour pour ce tournoi
3. Arrêter quand `allowedThisSlot` terrains sont remplis ou qu'il n'y a plus de matchs valides.

---

## 6. Gestion des cas d'échec

- Un match non planifiable est ajouté à `unscheduledMatches`.
- Un avertissement est émis : `"⚠️ X match(es) n'ont pas pu être planifié(s) par manque de créneaux horaires."`
- Causes possibles :
  - Pas assez de jours/créneaux configurés
  - La contrainte des 4h empêche de caser les tours dans la période disponible
  - Les finales ne tiennent pas dans la période après le délai obligatoire

---

## 7. Configuration requise

| Paramètre | Description |
|---|---|
| `startDate` / `endDate` | Période du tournoi |
| `numberOfCourts` | Terrains disponibles en parallèle |
| `matchDuration` | Durée d'un match (minutes, défaut : 90) |
| `dailyTimeSlots` | Par jour : `firstMatchStart`, `lastMatchStart` |
| `tournaments[].numberOfPlayers` | 4, 8 ou 16 joueurs |
| `tournaments[].gender` | `"homme"` ou `"femme"` |
| `tournaments[].minRanking` / `maxRanking` | Classement tennis (NC → 15) |

---

## 8. Fichiers clés

| Fichier | Rôle |
|---|---|
| `src/tmcLogic.ts` | Génération des matchs TMC (structure des tableaux) |
| `src/scheduler.ts` | Algorithme de planification (créneaux, contraintes, phases 1 & 2) |
| `src/types.ts` | Types de données (Match, ScheduledMatch, GlobalConfig…) |
