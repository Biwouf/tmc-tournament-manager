# GEN_PROG — Spec module Programmation Image

> Module : `src/pages/ProgrammationImagePage.tsx`  
> Route : `/programmation-image`

---

## Objectif

Générer une affiche JPEG de la programmation d'un jour de tournoi à partir d'une feuille FFT/TEN'UP (PDF ou CSV), en appliquant le template graphique du club.

---

## Entrées

Deux modes d'import sont disponibles, tous les deux aboutissent à la même liste de matchs en mémoire.

### Mode PDF — feuille de pointage FFT/TEN'UP

Upload d'un PDF exporté depuis Ten'Up / FFT. Le parsing est géré par `pdfjs-dist`.

**Format attendu** : feuille de pointage au format **portrait**. Chaque match correspond à un **bloc de lignes** ancré par le texte `"N° Court"`.

#### Structure d'un bloc match (coordonnées Y relatives à `N° Court`)

Chaque `N° Court` apparaît à position X ≈ 556, Y variable (`Ync`). Tous les éléments du bloc sont relatifs à `Ync` :

| Offset Y | Plage X | Contenu |
|----------|---------|---------|
| `Ync − 7` | x ≈ 60–90 | Catégorie du tournoi (ex : `"30 15/5"`, `"4eme serie"`, `"30/1"`) |
| `Ync − 7` | x ≈ 150–280 | Nom + Prénom joueur 1 (tokens mixtes) |
| `Ync − 7` | x ≈ 323 | Classement joueur 1 |
| `Ync + 0` | x ≈ 556–567 | `N° Court` (ancre) + numéro de téléphone |
| `Ync + 7` | x ≈ 60–77 | Type de tournoi (ex : `"SM Senior"`, `"SD Senior"`) |
| `Ync + 7` | x ≈ 150–480 | **Club joueur 1** (tokens tout en majuscules) |
| `Ync + 16` | x ≈ 738–780 | Infos prochain match (date + heure) — ignoré pour l'affiche |
| `Ync + 23` | x ≈ 150–280 | Nom + Prénom joueur 2 (tokens mixtes) |
| `Ync + 23` | x ≈ 323 | Classement joueur 2 |
| `Ync + 30` | x ≈ 363–419 | Numéro de téléphone — ignoré |
| `Ync + 34` | x ≈ 65 | **Heure du match** (format `HH:MM`) |
| `Ync + 37` | x ≈ 150–480 | **Club joueur 2** (tokens tout en majuscules) |

Tolérance Y : ± 12 px sur tous les offsets.

#### Extraction du nom complet (`parseFullName`)

Les tokens nom+prénom sont groupés par Y. Le nom de famille est formé des mots consécutifs entièrement en majuscules ; le prénom démarre au premier mot avec des minuscules.

Exemples :
- `"VAN MEENEN Vincent"` → nom : `VAN MEENEN`, prénom : `Vincent`
- `"LAFLORENTIE Romain"` → nom : `LAFLORENTIE`, prénom : `Romain`

#### Extraction du club

Les clubs sont composés de **plusieurs tokens** au même Y, tous en majuscules. Il faut collecter tous les tokens dans la plage X 150–480 à l'offset Y correspondant et les concaténer avec un espace.

Exemples :
- `"VALENCE D'AGEN TENNIS CLUB"` → 4 tokens à y≈Ync+7
- `"TENNIS THEOPOLITAIN LAGARDAIS"` → 3 tokens à y≈Ync+7
- `"SAINT CLAR T.C SAINT CLARAIS"` → 5 tokens à y≈Ync+37

La borne x < 480 permet d'exclure les informations de paiement (ex : `"Chq, Esp, CB"`) qui peuvent apparaître à droite sur la même ligne que club2.

#### Extraction de la date

Ligne d'en-tête de chaque page : texte contenant `"PROGRAMMATION"`, ex. `"PROGRAMMATION DU MARDI 24 FÉVRIER 2026"`. Parsing des mois avec dénormalisation des accents (`stripAccents`).

#### Construction de `type_tournoi`

Deux informations sont disponibles dans le bloc :
- **Catégorie** (y≈Ync−7, x≈60–90) : plage de classement du tableau (ex. `"30 15/5"`, `"4eme serie"`)
- **Type** (y≈Ync+7, x≈60–77) : genre + niveau (ex. `"SM Senior"`, `"SD Senior"`)

La valeur `type_tournoi` concatène les deux : `[catégorie, type].filter(Boolean).join(' ')` → ex. `"30 15/5 SM Senior"`.

#### Gestion des erreurs

Si aucun match n'est trouvé, un message d'erreur est affiché à l'utilisateur. Chaque page est traitée indépendamment.

---

### Mode CSV — saisie manuelle

Copier-coller d'un CSV dans une zone de texte, puis clic sur « Générer l'aperçu ».

**Schéma attendu** (ligne d'en-tête obligatoire) :

```
date,heure,type_tournoi,j1_prenom,j1_nom,j1_classement,j2_prenom,j2_nom,j2_classement
```

| Colonne | Format | Exemple |
|---|---|---|
| `date` | `YYYY-MM-DD` | `2026-05-30` |
| `heure` | `HH:MM` | `09:00`, `14:30` |
| `type_tournoi` | Texte libre | `Hommes 3ème série`, `Femmes 30/3 15/2` |
| `j1_prenom` | Texte | `Jean` |
| `j1_nom` | Texte | `Dupont` |
| `j1_classement` | Classement FFT | `15/4`, `30`, `NC` |
| `j2_prenom` | Texte | `Pierre` |
| `j2_nom` | Texte | `Martin` |
| `j2_classement` | Classement FFT | `15/2` |

> Le club n'est **pas** dans le schéma CSV. Les champs `j1_club` / `j2_club` resteront vides (`""`) pour les matchs importés via CSV.

Un bouton « Charger des données de test » pré-remplit le textarea avec `FAKE_CSV` (8 matchs). La date des matchs de test est générée à l'exécution (`new Date().toISOString().split('T')[0]`) afin de pouvoir tester le basculement vers Live Score sans modifier le CSV manuellement.

---

## Modèle de donnée interne

```ts
interface Match {
  date: string;           // "YYYY-MM-DD"
  heure: string;          // "HH:MM"
  type_tournoi: string;   // catégorie + type concaténés
  j1_prenom: string;
  j1_nom: string;
  j1_classement: string;
  j1_club: string;        // vide si import CSV
  j2_prenom: string;
  j2_nom: string;
  j2_classement: string;
  j2_club: string;        // vide si import CSV
}
```

---

## Rendu de l'affiche

### Template

Image de fond : `/public/tmcs_pentecote.png`  
Dimensions : **794 × 1123 px** (A4 portrait, 96 dpi)  
Le template intègre un header (logos) et un footer (sponsors) ; la zone centrale est occupée dynamiquement par la grille de cellules.

### Date

Affichée en haut de chaque page :  
`"Programme du <jour> <numéro> <mois>"` — ex. `"Programme du samedi 28 mars"`  
La date est celle du premier match de la page (`matches[0].date`).

### Cellule match (`MatchCell`)

Chaque cellule affiche :

1. **Heure** — badge rouge arrondi, format condensé :
   - `"09:00"` → `"9h"`
   - `"10:30"` → `"10h30"`
2. **Type de tournoi** — texte rouge à côté du badge heure
3. Pour chaque joueur (disposition symétrique autour de l'icône VS) :
   - Prénom
   - Nom
   - Classement (rouge, gras)
   - **Club** — affiché sous le classement

#### Affichage du club

- Position : sous le classement, dans la continuité de la fiche joueur
- Style : texte gris (muted), taille réduite par rapport au classement
- Noms longs : **taille de police adaptative** (`font-size` réduit automatiquement) pour tenir sur une ligne — pas de troncature, pas de retour à la ligne forcé
- Si `club` est vide (import CSV) : ne rien afficher (pas de ligne vide)

#### Icône VS

SVG inline entre les deux joueurs, avec effet "éclair" masqué.

### Highlight par club

Quand un PDF est importé, les matchs portent `j1_club` / `j2_club`. L'utilisateur peut sélectionner un club « hôte » dans un `<select>` (« Mettre en valeur un club ») positionné juste au-dessus de la zone « Envoyer vers Live Score ».

**Condition d'affichage du sélecteur** : `availableClubs.length > 0`. Pour un import CSV, les clubs sont vides → le sélecteur n'apparaît pas.

`availableClubs` est calculé via `useMemo` à partir des `j1_club` / `j2_club` non vides, dédupliqués puis triés alphabétiquement. La valeur `""` du sélecteur correspond à `highlightedClub = null` (option « Aucun »).

À chaque changement de `matches` (nouveau PDF/CSV), `highlightedClub` est réinitialisé à `null` (même logique que `transferStatus`).

#### Trois états par cellule

Dans `MatchCell`, à partir de `highlightedClub` :

```ts
const j1Home = !!highlightedClub && match.j1_club === highlightedClub;
const j2Home = !!highlightedClub && match.j2_club === highlightedClub;
const bothHome = j1Home && j2Home;
const anyHome  = j1Home || j2Home;
```

| Condition | Couronne d'étoiles | Ruban « CLUB » | Bandeau « DERBY » | ClubLabel rouge |
|---|:---:|:---:|:---:|:---:|
| Aucun joueur du club | — | — | — | — |
| 1 joueur du club | ✓ | ✓ | — | Côté joueur local uniquement |
| 2 joueurs du club (derby) | ✓ | — | ✓ | Les deux côtés |

Les matchs hors club sélectionné restent strictement inchangés.

#### Effets visuels

- **Couronne d'étoiles** (`anyHome`) : 12 étoiles blanches `#ffffff` débordant à l'extérieur de la cellule, sur le fond rouge de l'affiche. Tailles : 11 px de base, 13 px pour les indices 0/3/6/9 (légère respiration). Opacités : 1 pour les indices 0/4/8, sinon 0.85. Positions : 4 coins, 4 milieux haut/bas (`32%` et `62%`), 4 milieux gauche/droite (`38%` et `68%`). Implémentation : composant `StarsRing` posé sur un **wrapper externe** `position: relative` (sans `overflow: hidden`) qui enveloppe la cellule. La cellule elle-même garde `overflow: hidden` pour clipper le ruban.
- **Ruban diagonal « CLUB »** (`anyHome && !bothHome`) : `div` en `position: absolute` dans le coin supérieur droit de la cellule, `transform: rotate(45deg)`, fond `#C8102E`.
- **Bandeau « ★ DERBY \<club\> ★ »** (`bothHome`) : `div` en `position: absolute` en pied de cellule, `left/right: 16`, `bottom: 6`, `height: 16`. Le padding bas de la cellule passe de `16` à `26` quand `bothHome` pour laisser la place. Le nom du club (`highlightedClub`) est inséré dans le texte.
- **`ClubLabel`** accepte une prop `home?: boolean` : rouge `#C8102E`, `font-weight: 700`, `font-size: 9.5` quand `home`, sinon gris `#6b6b6b`.
- **Box-shadow / bordure** : **aucun changement** entre cellule highlight et cellule standard. Le `box-shadow` reste constant (`5px 6px 0px rgba(200, 16, 46, 0.3)`). Une bordure rouge avait été envisagée mais se fond dans le fond rouge de l'affiche → écartée.

Tous les effets sont du CSS / SVG pur → exportables par `html-to-image`.

### Pagination

- **MAX_PER_PAGE = 8** (grille 2 colonnes × 4 lignes)
- Les matchs sont découpés séquentiellement : page 1 = matchs 1–8, page 2 = matchs 9–16, etc.
- Toutes les pages partagent la même date (celle du premier match importé).

### Layout de la grille

```
GRID_TOP   = 305 px  (depuis le haut de l'affiche)
GRID_LEFT  = 18 px
GRID_RIGHT = 18 px
GRID_GAP   = 20 px   (entre les cellules)
```

---

## Export

Clic sur « Télécharger » → une image JPEG par page est générée via `html-to-image` (`toJpeg`, qualité 0.92, pixelRatio 2).

- 1 page → fichier nommé `programmation.jpg`
- N pages → fichiers nommés `programmation-page-1.jpg`, `programmation-page-2.jpg`, etc.

Les téléchargements sont déclenchés séquentiellement.

---

## État React (local, pas de persistance)

| State | Type | Rôle |
|---|---|---|
| `csvText` | `string` | Contenu de la zone de texte CSV |
| `matches` | `Match[]` | Liste des matchs parsés (PDF ou CSV) |
| `isGenerating` | `boolean` | Désactive le bouton pendant l'export |
| `isParsing` | `boolean` | Désactive l'input pendant la lecture PDF |
| `pdfError` | `string` | Message d'erreur PDF |
| `events` | `{ id, titre, date_debut }[]` | Liste des événements pour le sélecteur de basculement |
| `eventsLoading` | `boolean` | Désactive le `<select>` d'événement pendant le fetch |
| `selectedEventId` | `string` | UUID de l'événement choisi (`""` = aucun) |
| `transferStatus` | `'idle'\|'loading'\|'done'\|'error'` | État du bouton « Basculer vers Live Score » |
| `transferError` | `string \| null` | Message d'erreur du transfert |
| `highlightedClub` | `string \| null` | Club sélectionné dans le sélecteur « Mettre en valeur un club ». `null` = aucun. Repassé à `null` à chaque changement de `matches`. |

---

## Basculement vers Live Score

### Contexte & objectif

Le module GEN_PROG structure les matchs en mémoire (joueurs, classements, clubs, horaires) mais les isole de Live Score, où la création est manuelle champ par champ. Ce bridge permet de basculer tous les matchs détectés vers Live Score en un clic.

**Mesure de succès :** l'utilisateur transfère N matchs en moins de 30 secondes, sans aucune ressaisie.

### Périmètre

**In scope**
- Basculement global (tous les matchs d'un coup).
- Sélecteur d'événement optionnel avant confirmation.
- Création des entrées `live_matches` avec `status = 'pending'`.
- Feedback visuel après transfert (bouton désactivé "Ajoutés ✓").
- `FAKE_CSV` avec date dynamique (`new Date().toISOString().split('T')[0]`) pour pouvoir tester sans modifier le CSV.

**Out of scope**
- Basculement match par match.
- Création d'un événement à la volée.
- Démarrage automatique du live.
- Dé-duplication automatique, rollback.

### Interface — zone "Envoyer vers Live Score"

**Condition d'affichage :** `matches.length > 0`. Positionnée au-dessus de l'affiche, avant le rendu des pages.

Composants :
1. **Titre** "Envoyer vers Live Score"
2. **`<select>` événement** — chargé au montage depuis `events` (tri `start_date` DESC). Option par défaut : "Aucun événement". Désactivé pendant le chargement et après transfert réussi.
3. **Bouton** avec états :
   - Idle : "Basculer N match(s) vers Live Score"
   - Loading : "Envoi…" (désactivé)
   - Done : "N match(s) ajouté(s) ✓" (désactivé, style succès)
   - Error : label idle réactivé + message d'erreur inline

L'état `transferStatus` se réinitialise à `'idle'` à chaque changement de la liste `matches` (nouveau PDF/CSV importé).

### Mapping Match → LiveMatch

Pour chaque `Match`, insérer dans `live_matches` :

| Champ `live_matches` | Valeur |
|---|---|
| `match_date` | `match.date` |
| `start_time` | `match.heure` (ou `null` si vide) |
| `match_type` | `'simple'` |
| `j1_*` / `j2_*` | depuis `match` |
| `j1_club` / `j2_club` | `""` si absent (import CSV) |
| `j3_*` / `j4_*` | tous `null` |
| `event_id` | UUID sélectionné ou `null` |
| `type_tournoi` | `match.type_tournoi` (ou `null` si vide) |
| `status` | `'pending'` |
| `winner`, `scored_by`, `finished_at`, `set*` | tous `null` |

**Stratégie :** `supabase.from('live_matches').insert([...allMatches])` — un seul appel pour tous les matchs.

### Cas limites

| Cas | Comportement |
|---|---|
| Erreur Supabase | Message d'erreur inline, bouton reste actif pour retry. |
| Aucun événement disponible | `<select>` affiche "Aucun événement". Transfert possible sans `event_id`. |
| Nouvelle importation après transfert | `transferStatus` repasse à `'idle'`. |
| 0 match après import | La zone n'est pas affichée. |

### Plan de tests

| Scénario | Vérification |
|---|---|
| Import CSV date du jour | Zone apparaît, bouton indique le bon nombre |
| Basculer sans événement | Matchs créés avec `event_id = null`, status `pending` |
| Basculer avec événement | Matchs créés avec le bon `event_id` |
| Vérif dans `/live-score` | Matchs en "En attente" avec bonnes données |
| Nouvelle importation après transfer | Bouton repasse en idle |
| Bouton "Charger données de test" | Matchs avec date du jour |
| Erreur réseau simulée | Message d'erreur, bouton actif |

### Points ouverts

| # | Question |
|---|---|
| 1 | Erreur partielle : tout-ou-rien via un seul `insert([...])` — si Supabase rejette un item, toute la transaction échoue. À confirmer. |
| 2 | Rien n'empêche de transférer deux fois la même affiche (doublons). Pas de dé-duplication en v1 — à surveiller. |

---

## Points ouverts / évolutions possibles

- Stratégie de pagination alternative : par type de tournoi ou par moment de la journée (vs. découpage séquentiel actuel)
- Permettre de **réordonner** les matchs avant export
- Support multi-dates (actuellement, tous les matchs sont supposés partager la même date)
