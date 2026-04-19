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

Un bouton « Charger des données de test » pré-remplit le textarea avec `FAKE_CSV` (8 matchs hardcodés).

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

---

## Points ouverts / évolutions possibles

- Stratégie de pagination alternative : par type de tournoi ou par moment de la journée (vs. découpage séquentiel actuel)
- Permettre de **réordonner** les matchs avant export
- Support multi-dates (actuellement, tous les matchs sont supposés partager la même date)
