# Spec — Composants partagés

> Composants réutilisables entre plusieurs modules du back-office.

---

## MarkdownEditor

> Module : composant `MarkdownEditor` partagé entre `ActuForm` et `EventForm`.

### Contexte

Les deux formulaires BO (`ActuForm`, `EventForm`) exposent un `<textarea>` brut pour saisir du Markdown. L'objectif est d'ajouter une barre de formatage contextuelle au-dessus du textarea.

### Nouveau composant : `src/components/MarkdownEditor.tsx`

Ce composant remplace le bloc Write/Preview dans `ActuForm` et `EventForm`.

#### Props

```ts
interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;          // défaut : 12
  placeholder?: string;
}
```

Le composant gère son propre état d'onglet (`'write' | 'preview'`). Il expose uniquement `value` / `onChange` — pas d'état supplémentaire à gérer dans le parent.

### Barre de formatage

**Déclenchement :** toujours visible au-dessus du textarea (onglet "Écrire"). Les boutons sont désactivés (`opacity-50`, `cursor-not-allowed`) si aucun texte n'est sélectionné — sauf les titres (H1/H2/H3) qui agissent sur la ligne entière.

#### Boutons

| Bouton | Label | Shortcut clavier | Syntaxe appliquée |
|--------|-------|-----------------|-------------------|
| Gras | **B** | Ctrl/Cmd+B | `**texte**` |
| Italique | *I* | Ctrl/Cmd+I | `*texte*` |
| Souligné | U | — | `<u>texte</u>` |
| H1 | H1 | — | `# ` en début de ligne |
| H2 | H2 | — | `## ` en début de ligne |
| H3 | H3 | — | `### ` en début de ligne |

> **Note souligné** : le Markdown standard ne supporte pas le souligné. On utilise `<u>texte</u>` rendu par `react-markdown` avec `rehype-raw` (HTML inline activé).

#### Comportement toggle

Pour les formats **inline** (gras, italique, souligné) :
1. Récupérer le texte sélectionné.
2. Vérifier si déjà entouré par la syntaxe correspondante.
3. Si oui → retirer les marqueurs (unwrap). Si non → appliquer (wrap).
4. Reconstruire la valeur et appeler `onChange`.
5. Restaurer la sélection sur le texte transformé via `useEffect` + `ref`.

Pour les **titres** (H1/H2/H3) :
1. Trouver le début de la ligne courante.
2. Lire le préfixe existant (`# `, `## `, `### `, ou rien).
3. Si préfixe = titre cliqué → retirer (toggle off). Sinon → remplacer par le nouveau.
4. Placer le curseur en fin de ligne.

### Gestion du focus et de la sélection

- Utiliser `event.preventDefault()` sur le `mousedown` des boutons (pas sur `click`) pour éviter que le textarea ne perde la sélection.
- Conserver `selectionStart` / `selectionEnd` dans un `ref` mis à jour à chaque `onSelect` et `onChange`.
- Repositionner la sélection après application via `textarea.setSelectionRange(newStart, newEnd)`.

### Rendu Markdown (onglet Aperçu)

```tsx
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';

<ReactMarkdown remarkPlugins={[remarkBreaks]} rehypePlugins={[rehypeRaw]}>
  {expandBlankLines(value)}
</ReactMarkdown>
```

`expandBlankLines` (à définir dans `MarkdownEditor.tsx`, supprimer les copies dans `ActuForm` et `EventForm`) :

```ts
const expandBlankLines = (md: string) =>
  md.replace(/\n{3,}/g, (m) => '\n\n' + '&nbsp;\n\n'.repeat(m.length - 2));
```

**Installation** (les deux projets) :
```bash
npm install rehype-raw            # BO
npm install --prefix pwa rehype-raw  # PWA
```

Côté PWA, `rehype-raw` doit être ajouté dans `ActuDetailPage.tsx` et `EventDetailPage.tsx` pour rendre les `<u>` correctement.

### Layout de la toolbar

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
- Séparateur : `w-px h-4 bg-border mx-1`
- Bouton désactivé : `opacity-40 cursor-not-allowed`
- Textarea : `rounded-b-lg rounded-t-none border-t-0 border-border`

### Intégration dans les formulaires existants

**`ActuForm.tsx`** — remplacer le bloc Write/Preview + supprimer l'état `contenuTab` :

```tsx
<div>
  <label className="block text-sm font-medium text-foreground">Contenu * (Markdown)</label>
  <MarkdownEditor value={contenu} onChange={setContenu} rows={12} placeholder="**gras**, *italique*..." />
  {errors.contenu && <p className="mt-1 text-xs text-red-600">{errors.contenu}</p>}
</div>
```

**`EventForm.tsx`** — même remplacement pour `description` / supprimer `descTab`.

Ce qui ne change pas : logique de sauvegarde, validations, submit Supabase.

### Fichiers

| Action | Fichier |
|--------|---------|
| Créer | `src/components/MarkdownEditor.tsx` |
| Modifier | `src/components/ActuForm.tsx` |
| Modifier | `src/components/EventForm.tsx` |
| Modifier (PWA) | `pwa/src/pages/ActuDetailPage.tsx` + `EventDetailPage.tsx` — ajouter `rehype-raw` |

### Critères d'acceptation

- [ ] Sélectionner du texte puis cliquer "B" entoure de `**...**`, re-cliquer retire les `**`
- [ ] Cliquer "H2" sur ligne vide préfixe avec `## `, re-cliquer retire le préfixe
- [ ] Cliquer "H1" sur ligne `## ` remplace par `# `
- [ ] Souligné visible dans l'aperçu (rendu `<u>`)
- [ ] Ctrl+B / Ctrl+I fonctionnent depuis le textarea
- [ ] Le textarea garde le focus après un clic toolbar
- [ ] `ActuForm` et `EventForm` compilent sans erreur TypeScript
