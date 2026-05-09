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

**Déclenchement :** toujours visible au-dessus du textarea (onglet "Écrire"). Les boutons inline (B/I/U) sont désactivés (`opacity-40`, `cursor-not-allowed`) si aucun texte n'est sélectionné. Les boutons titres (H1/H2/H3), liste (`•≡`) et image (`🖼`) agissent sur la ligne entière ou au curseur — toujours actifs.

#### Boutons

| Bouton | Label | Shortcut clavier | Syntaxe appliquée |
|--------|-------|-----------------|-------------------|
| Gras | **B** | Ctrl/Cmd+B | `**texte**` |
| Italique | *I* | Ctrl/Cmd+I | `*texte*` |
| Souligné | U | — | `<u>texte</u>` |
| H1 | H1 | — | `# ` en début de ligne |
| H2 | H2 | — | `## ` en début de ligne |
| H3 | H3 | — | `### ` en début de ligne |
| Liste | `•≡` | — | `- ` en début de ligne |
| Image | `🖼` | — | `![alt](url)` au curseur (ouvre un formulaire inline) |

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
2. Lire le préfixe existant (`# `, `## `, `### `, `- `, ou rien).
3. Si préfixe = titre cliqué → retirer (toggle off). Si autre titre ou `- ` → remplacer par le nouveau préfixe titre. Sinon → préfixer.
4. Placer le curseur en fin de ligne.

Pour la **liste à puces** (`•≡`) — même logique que les titres :
1. Trouver le début de la ligne courante.
2. Si la ligne commence par `- ` → retirer (toggle off).
3. Si la ligne commence par un préfixe titre (`# `, `## `, `### `) → remplacer par `- ` (une seule syntaxe de début de ligne à la fois).
4. Sinon → préfixer par `- `.
5. Placer le curseur en fin de ligne.

#### Insertion d'images inline

Au clic sur le bouton `🖼`, ouverture d'un formulaire inline sous la toolbar avec deux modes accessibles via deux onglets : **"Depuis ma machine"** (défaut) et **"Via une URL"**. Un champ « Texte alternatif » optionnel est partagé.

**Mode fichier (défaut)**
- `<input type="file" accept="image/jpeg,image/png">` — mêmes types que les images principales.
- Limite : 5 Mo (même règle que `EventForm`).
- Dès qu'un fichier valide est sélectionné, spinner pendant l'upload vers Supabase Storage (bucket `content-images`, chemin `inline/{Date.now()}-{sanitizedFilename}`).
- En cas de succès → insertion automatique de `![alt](url)` et fermeture du formulaire.
- En cas d'erreur → message d'erreur, formulaire reste ouvert.

**Mode URL**
- Input text URL (placeholder `https://...`).
- Bouton `Insérer` désactivé si URL vide. Pas de validation de format.

**Règles d'insertion**
- Insertion à la position du curseur capturée à l'ouverture du formulaire.
- Le bloc `![alt](url)` est isolé sur sa propre ligne : ajout de `\n` avant si la position n'est pas en début de ligne, `\n` après si pas en fin de ligne.
- Curseur placé après le bloc.
- Formulaire fermé automatiquement après insertion (succès fichier ou clic Insérer en mode URL).
- Bouton `✕` ou clic en dehors du formulaire → annule et referme.

Le composant importe `supabase` depuis `../lib/supabase` et gère l'upload lui-même — aucune prop supplémentaire à passer depuis `ActuForm` / `EventForm`. Le helper `sanitizeFilename` est dupliqué localement (mêmes règles que `EventForm` / `ActuForm`).

> **Orphelines acceptées** : si l'utilisateur uploade une image puis abandonne le formulaire, le fichier reste dans le bucket. Comportement connu et accepté, sans mécanisme de nettoyage prévu pour l'instant.

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
┌────────────────────────────────────────────────────────────┐
│ Écrire │ Aperçu      B  I  U │ H1  H2  H3 │ •≡  🖼         │
├────────────────────────────────────────────────────────────┤
│  (formulaire image inline si ouvert)                       │
├────────────────────────────────────────────────────────────┤
│  textarea / preview                                        │
└────────────────────────────────────────────────────────────┘
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

### Compatibilité PWA — rendu Markdown

La PWA est sur Tailwind v4 sans `@tailwindcss/typography`. Les classes `prose prose-sm` posées sur les wrappers `<div>` des pages détail sont sans effet, et le preflight Tailwind v4 supprime les styles navigateur par défaut sur `<ul>` et `<img>`. Pour que les listes à puces et les images inline soient correctement rendues, on utilise une classe utilitaire dédiée `markdown-body` définie dans `pwa/src/index.css` :

```css
.markdown-body ul {
  list-style: disc;
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}
.markdown-body li {
  margin: 0.25rem 0;
}
.markdown-body img {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  margin: 0.5rem 0;
}
```

`ActuDetailPage.tsx` et `EventDetailPage.tsx` consomment `markdown-body text-foreground` à la place de `prose prose-sm max-w-none text-foreground` sur le wrapper de `ReactMarkdown`.

### Infrastructure Supabase

Bucket dédié pour les images insérées dans le corps Markdown :
- **Bucket** : `content-images` (public, mêmes ACL que `actu-images` / `event-images`).
- **Création** : via le dashboard Supabase Storage. Aucune migration SQL.
- **Chemin de stockage** : `inline/{Date.now()}-{sanitizedFilename}` — pas d'ID d'entité (le bucket est partagé entre actus et events).

### Fichiers

| Action | Fichier |
|--------|---------|
| Créer | `src/components/MarkdownEditor.tsx` |
| Modifier | `src/components/ActuForm.tsx` |
| Modifier | `src/components/EventForm.tsx` |
| Créer (infra) | Bucket Supabase `content-images` — via dashboard |
| Modifier (PWA) | `pwa/src/index.css` — classe `.markdown-body` |
| Modifier (PWA) | `pwa/src/pages/ActuDetailPage.tsx` + `EventDetailPage.tsx` — `markdown-body` (au lieu de `prose`) + `rehype-raw` |

### Critères d'acceptation

- [ ] Sélectionner du texte puis cliquer "B" entoure de `**...**`, re-cliquer retire les `**`
- [ ] Cliquer "H2" sur ligne vide préfixe avec `## `, re-cliquer retire le préfixe
- [ ] Cliquer "H1" sur ligne `## ` remplace par `# `
- [ ] Souligné visible dans l'aperçu (rendu `<u>`)
- [ ] Ctrl+B / Ctrl+I fonctionnent depuis le textarea
- [ ] Le textarea garde le focus après un clic toolbar
- [ ] Cliquer `•≡` sur ligne vide préfixe `- `, re-cliquer retire
- [ ] Cliquer `•≡` sur ligne `## Titre` → `- Titre`
- [ ] Cliquer `🖼` ouvre un formulaire inline en mode "Depuis ma machine" par défaut
- [ ] Fichier > 5 Mo ou non JPEG/PNG → message d'erreur, pas d'upload
- [ ] Fichier valide → spinner pendant l'upload puis `![alt](url)` inséré et formulaire fermé
- [ ] Mode URL : bouton Insérer désactivé si URL vide
- [ ] PWA : liste à puces visible avec puce + indentation, image inline sans débordement mobile
- [ ] `ActuForm` et `EventForm` compilent sans erreur TypeScript
