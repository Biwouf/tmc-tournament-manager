import { useState, type DragEvent } from 'react';

interface Props {
  /** Même syntaxe que l'attribut `accept` ; appliqué aussi aux fichiers glissés-déposés. */
  accept: string;
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  /**
   * Fichier(s) déjà retenu(s) — nom, « Image actuelle », « 3 images »… : affiché à la place de
   * l'invite ; le bouton devient « Remplacer » (« Ajouter des fichiers » en `multiple`).
   */
  fileName?: string | null;
  /** Avec `fileName`, affiche « Retirer ». */
  onClear?: () => void;
  ariaLabel?: string;
  compact?: boolean;
  /** `false` quand un parent est déjà la zone de dépôt (`SiteConfigFields`) : il garde la main. */
  ownDropZone?: boolean;
}

function matchesAccept(file: File, accept: string): boolean {
  const rules = accept.split(',').map((rule) => rule.trim().toLowerCase()).filter(Boolean);
  if (rules.length === 0) return true;
  const type = file.type.toLowerCase();
  return rules.some((rule) =>
    rule.startsWith('.')
      ? file.name.toLowerCase().endsWith(rule)
      : rule.endsWith('/*')
        ? type.startsWith(rule.slice(0, -1))
        : type === rule,
  );
}

/**
 * Champ fichier en français : remplace le rendu natif (« Choose File / No file chosen »),
 * qui suit la langue du navigateur et non celle du BO. Accepte aussi le glisser-déposer.
 */
export default function FileDrop({
  accept,
  onFiles,
  multiple = false,
  disabled = false,
  fileName,
  onClear,
  ariaLabel,
  compact = false,
  ownDropZone = true,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState(false);

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const kept = files.filter((file) => matchesAccept(file, accept));
    setRejected(kept.length < files.length);
    if (kept.length > 0) onFiles(multiple ? kept : kept.slice(0, 1));
  };

  const onDragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (disabled || !ownDropZone) return;
    event.preventDefault();
    setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    if (disabled || !ownDropZone) return;
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files);
  };

  const text = compact ? 'text-xs' : 'text-sm';

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label
          onDragOver={onDragOver}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex min-w-0 max-w-full flex-1 items-center gap-3 rounded-lg border border-dashed px-3 ${
            compact ? 'py-1.5' : 'py-2.5'
          } ${text} transition focus-within:ring-2 focus-within:ring-ring ${
            dragging ? 'border-primary bg-muted/60' : 'border-border bg-card hover:bg-muted/40'
          } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        >
          <input
            type="file"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            aria-label={ariaLabel}
            className="sr-only"
            onChange={(event) => {
              take(event.target.files);
              // Permet de re-choisir le même fichier juste après.
              event.target.value = '';
            }}
          />
          <span className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 font-medium text-foreground">
            {/* En multiple, de nouveaux fichiers s'AJOUTENT à ceux déjà là : pas de « Remplacer ». */}
            {fileName
              ? multiple ? 'Ajouter des fichiers' : 'Remplacer'
              : multiple ? 'Choisir des fichiers' : 'Choisir un fichier'}
          </span>
          {/* Sur téléphone, on ne glisse pas de fichier : l'invite n'y occupe pas de place. */}
          <span className={`min-w-0 truncate text-muted-foreground ${fileName ? '' : 'hidden sm:inline'}`}>
            {fileName ?? 'ou glisser-déposer'}
          </span>
        </label>
        {fileName && onClear && (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className={`${text} min-h-11 px-2 font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline`}
          >
            Retirer
          </button>
        )}
      </div>
      {rejected && (
        <p role="alert" className="text-xs font-medium text-destructive">
          Format non accepté.
        </p>
      )}
    </div>
  );
}
