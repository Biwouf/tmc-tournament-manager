# Spec — MarkdownEditor avec barre de formatage

> Module : composant `MarkdownEditor` partagé entre `ActuForm` et `EventForm`.

---

## Contexte

Aujourd'hui les deux formulaires BO (`ActuForm`, `EventForm`) exposent un `<textarea>` brut pour saisir du Markdown. L'utilisateur doit écrire la syntaxe à la main (`**gras**`, `# titre`…). L'objectif est d'ajouter une barre de formatage contextuelle qui s'active à la sélection de texte.

---

## Nouveau composant : `MarkdownEditor`

Créer `src/components/MarkdownEditor.tsx`.  
Ce composant remplace le bloc Write/Preview dans `ActuForm` et `EventForm`.

### Props

```ts
interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;          // défaut : 12
  placeholder?: string;
}
```

### Structure interne

Le composant gère son propre état d'onglet (`'write' | 'preview'`).  
Il expose vers l'extérieur uniquement `value` / `onChange` — pas d'état supplémentaire à gérer dans le parent.

---

## Barre de formatage

### Déclenchement

La barre de formatage est **toujours visible** au-dessus du textarea (en onglet "Écrire"), pas seulement à la sélection. C'est plus prévisible qu'un tooltip flottant et plus simple à implémenter sans positionnement complexe.

Les boutons sont **désactivés visuellement** (`opacity-50`, `cursor-not-allowed`) si aucun texte n'est sélectionné — **sauf** les titres (H1/H2/H3) qui agissent sur la ligne entière et ne nécessitent pas de sélection.

### Boutons

| Bouton | Label | Shortcut clavier | Syntaxe appliquée |
|--------|-------|-----------------|-------------------|
| Gras | **B** | Ctrl/Cmd+B | `**texte**` |
| Italique | *I* | Ctrl/Cmd+I | `*texte*` |
| Souligné | U | — | `<u>texte</u>` |
| H1 | H1 | — | `# ` en début de ligne |
| H2 | H2 | — | `## ` en début de ligne |
| H3 | H3 | — | `### ` en début de ligne |

> **Note souligné** : le Markdown standard ne supporte pas le souligné. On utilise `<u>texte</u>` qui est rendu par `react-markdown` (HTML inline activé, voir section rendu ci-dessous).

### Comportement toggle (appliquer / retirer)

Pour chaque format **inline** (gras, italique, souligné), avant d'appliquer :

1. Récupérer le texte sélectionné (`textarea.value.substring(selectionStart, selectionEnd)`).
2. Vérifier si le texte sélectionné est **déjà entouré** par la syntaxe correspondante.
   - Gras : commence par `**` et finit par `**`
   - Italique : commence par `*` et finit par `*` (et n'est pas du gras)
   - Souligné : commence par `<u>` et finit par `</u>`
3. Si oui → **retirer** les marqueurs (unwrap).
4. Si non → **appliquer** les marqueurs (wrap).
5. Reconstruire la valeur complète et appeler `onChange`.
6. Restaurer la sélection sur le texte transformé (après le `setState`, via `useEffect` + `ref` sur le textarea).

Pour les **titres** (H1/H2/H3) :

1. Trouver le début de la ligne courante (position du curseur ou début de la sélection).
2. Lire le préfixe existant de la ligne (`# `, `## `, `### `, ou rien).
3. Si le préfixe correspond déjà au titre cliqué → **retirer** le préfixe (toggle off).
4. Sinon → **remplacer** le préfixe existant par le nouveau (ex. H1 → H2 remplace `# ` par `## `).
5. Placer le curseur en fin de ligne après modification.

---

## Gestion du focus et de la sélection

Le textarea doit garder le focus après un clic sur un bouton de la barre. Utiliser `event.preventDefault()` sur le `mousedown` des boutons de la toolbar (pas sur le `click`) pour éviter que le textarea ne perde la sélection.

Conserver les positions `selectionStart` / `selectionEnd` dans un `ref` mis à jour à chaque `onSelect` et `onChange` du textarea.

Après application d'un format, repositionner la sélection programmatiquement via `textarea.setSelectionRange(newStart, newEnd)`.

---

## Rendu Markdown (onglet Aperçu)

### remark-breaks

`remark-breaks` est **déjà installé** dans le projet (ajouté dans le commit `a6967cf`). Importer directement :

```tsx
import remarkBreaks from 'remark-breaks';
```

### expandBlankLines

Le même commit a introduit un helper `expandBlankLines` dans `ActuForm` et `EventForm` pour préserver les lignes blanches multiples (le Markdown les collapse par défaut) :

```ts
const expandBlankLines = (md: string) =>
  md.replace(/\n{3,}/g, (m) => '\n\n' + '&nbsp;\n\n'.repeat(m.length - 2));
```

**Ce helper doit être défini dans `MarkdownEditor.tsx`** et appliqué dans l'aperçu. Lors de la migration, supprimer les copies locales dans `ActuForm` et `EventForm`.

### rehype-raw (HTML inline)

`rehype-raw` permet de rendre le `<u>texte</u>` du souligné. À installer dans **les deux projets** (BO et PWA) :

```bash
npm install rehype-raw            # BO
npm install --prefix pwa rehype-raw  # PWA
```

Côté PWA, `rehype-raw` doit être ajouté dans `pwa/src/pages/EventDetailPage.tsx` et `pwa/src/pages/ActuDetailPage.tsx` (composants `<ReactMarkdown>` qui rendent `event.description` / `actu.contenu`). Sinon le `<u>` est échappé en texte brut côté lecture publique.

### Rendu final dans le composant

```tsx
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';

<ReactMarkdown remarkPlugins={[remarkBreaks]} rehypePlugins={[rehypeRaw]}>
  {expandBlankLines(value)}
</ReactMarkdown>
```

---

## Intégration dans les formulaires existants

### `ActuForm.tsx`

Remplacer le bloc complet (label + onglets Écrire/Aperçu + textarea + preview) :

```tsx
// AVANT
<div>
  <div className="flex items-center justify-between">
    <label ...>Contenu * (Markdown)</label>
    <div className="flex gap-1 text-xs">...</div>
  </div>
  {contenuTab === 'write' ? <textarea ... /> : <div className="prose ...">...</div>}
  {errors.contenu && ...}
</div>

// APRÈS
<div>
  <label className="block text-sm font-medium text-foreground">Contenu * (Markdown)</label>
  <MarkdownEditor
    value={contenu}
    onChange={setContenu}
    rows={12}
    placeholder="**gras**, *italique*, - liste, # titre..."
  />
  {errors.contenu && <p className="mt-1 text-xs text-red-600">{errors.contenu}</p>}
</div>
```

Supprimer l'état `contenuTab` et son import dans `ActuForm`.

### `EventForm.tsx`

Même remplacement pour le champ `description` / `descTab`.  
Supprimer l'état `descTab`.

---

## Apparence de la toolbar

Barre compacte au-dessus du textarea, dans le même conteneur (`rounded-t-lg` pour la barre, `rounded-b-lg` pour le textarea, border partagée).

```
┌─────────────────────────────────────────────────────┐
│ Écrire │ Aperçu          B  I  U │ H1  H2  H3       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  textarea / preview                                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Classes Tailwind orientatives :
- Conteneur toolbar : `flex items-center justify-between border border-border rounded-t-lg bg-muted/40 px-2 py-1`
- Séparateur entre groupes de boutons : `w-px h-4 bg-border mx-1`
- Bouton actif/inactif : `rounded px-2 py-0.5 text-xs font-medium`
- Bouton désactivé : `opacity-40 cursor-not-allowed`
- Textarea : `rounded-b-lg rounded-t-none border-t-0 border-border` (le reste des classes déjà présentes)

---

## Ce qui ne change pas

- La logique de sauvegarde dans `ActuForm` et `EventForm` : `contenu` / `description` restent des `string` en state dans le parent.
- Les validations (`validate()`), le submit, Supabase — rien ne change.
- La dépendance `react-markdown` + `remark-breaks` : déjà présente, pas de remplacement.

---

## Fichiers à créer / modifier

| Action | Fichier |
|--------|---------|
| Créer | `src/components/MarkdownEditor.tsx` |
| Modifier | `src/components/ActuForm.tsx` |
| Modifier | `src/components/EventForm.tsx` |
| Mettre à jour | `docs/CODEBASE.md` (ajouter `MarkdownEditor` dans la table Composants) |

---

## Critères d'acceptation

- [ ] Sélectionner du texte puis cliquer "B" entoure le texte de `**...**`
- [ ] Re-cliquer "B" sur un texte déjà gras retire les `**`
- [ ] Cliquer "H2" sur une ligne vide préfixe avec `## `
- [ ] Cliquer "H2" sur une ligne déjà `## ` retire le préfixe
- [ ] Cliquer "H1" sur une ligne déjà `## ` remplace par `# `
- [ ] Cliquer souligné avec texte sélectionné entoure de `<u>...</u>`, visible dans l'aperçu
- [ ] Ctrl+B / Ctrl+I fonctionnent depuis le textarea (raccourcis clavier)
- [ ] Le textarea garde le focus après un clic sur la toolbar
- [ ] La sélection est préservée / repositionnée après application du format
- [ ] `ActuForm` et `EventForm` compilent sans erreur TypeScript
- [ ] L'onglet Aperçu rend le HTML inline (`<u>`) correctement
