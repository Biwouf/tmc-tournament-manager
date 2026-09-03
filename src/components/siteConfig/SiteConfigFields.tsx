// Multi-tenant — PR6b : champs de l'écran « Configuration du site » (MULTI_TENANT.md §6.1).
//
// Rendus À PARTIR des specs de `src/lib/clubConfigWrite.ts` : le libellé affiché ici et la
// validation qui refuse la valeur viennent de la même ligne de la même table.
//
// Rien à voir avec `ConfigurationForm.tsx` / `ConfigDropdown.tsx`, qui sont les réglages d'un
// TOURNOI TMC (`GlobalConfig`, `TENNIS_RANKINGS`).
import { useEffect, useMemo } from 'react';
import type { FieldSpec } from '../../lib/clubConfigWrite';

const INPUT_CLASS =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring';

function FieldLabel({ spec }: { spec: FieldSpec }) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-foreground">
      {spec.label}
      {/* Le ⬤ du brief §5 est un repère, pas un verrou : un groupe incomplet s'enregistre
          (cf. `fieldSchema`). Le title le dit, pour ne pas promettre un blocage inexistant. */}
      {spec.required && (
        <span className="ml-1 text-primary" title="Attendu par le site vitrine — vous pouvez enregistrer sans.">
          ⬤
        </span>
      )}
    </label>
  );
}

function FieldHelp({ help }: { help?: string }) {
  if (!help) return null;
  return <p className="mt-1.5 text-xs text-muted-foreground">{help}</p>;
}

export function ScalarField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <FieldLabel spec={spec} />
      {spec.type === 'longtext' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          placeholder={spec.placeholder}
          className={`${INPUT_CLASS} resize-y`}
        />
      ) : spec.type === 'color' ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={spec.placeholder}
            className={INPUT_CLASS}
          />
          {/* `input[type=color]` ne sait pas représenter le vide, qui est le défaut du contrat
              et une valeur parfaitement légitime : il assiste la saisie texte, il ne la
              remplace pas. */}
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${spec.label} — sélecteur de couleur`}
            className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-background p-1"
          />
        </div>
      ) : (
        <input
          type={spec.type === 'email' ? 'email' : spec.type === 'tel' ? 'tel' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.placeholder}
          className={INPUT_CLASS}
        />
      )}
      <FieldHelp help={spec.help} />
    </div>
  );
}

/**
 * Case à cocher — les seuls booléens du contrat sont les drapeaux d'affichage de `settings.*`.
 *
 * Décocher écrit le booléen `false` et n'efface PAS la clé : c'est la seule façon de
 * distinguer « masqué explicitement » de « jamais configuré », l'absence de clé valant `true`
 * (web_site_brief §5.10). Pas de ⬤ ici — un drapeau a toujours une valeur, il n'est jamais
 * « vide ».
 */
export function BoolField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-primary"
        />
        <span className="text-sm font-medium text-foreground">{spec.label}</span>
      </label>
      {/* Aligné sur le libellé plutôt que sur la case : la case n'est pas une puce de liste. */}
      <div className="pl-[1.625rem]">
        <FieldHelp help={spec.help} />
      </div>
    </div>
  );
}

/**
 * Upload DIFFÉRÉ : le fichier choisi ici n'atteint le Storage qu'à l'enregistrement du
 * panneau. Uploader à la sélection laisserait un objet orphelin dans le bucket dès qu'on
 * change d'avis, et supprimerait l'ancienne image avant d'être sûr que l'écriture passe.
 */
export function ImageField({
  spec,
  value,
  file,
  onPick,
  onClear,
}: {
  spec: FieldSpec;
  /** URL enregistrée, ou '' si aucune. */
  value: string;
  /** Fichier choisi et pas encore envoyé. */
  file: File | null;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  // Aperçu du fichier en attente. L'URL est révoquée dès qu'un autre fichier est choisi ou
  // que le champ est démonté — sans quoi chaque changement d'image fuit un blob.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const shown = preview ?? (value || null);

  return (
    <div>
      <FieldLabel spec={spec} />
      <div className="flex flex-wrap items-start gap-3">
        {shown && (
          <img
            src={shown}
            alt=""
            className="h-20 w-20 rounded-lg border border-border bg-muted/40 object-contain"
          />
        )}
        <div className="flex min-w-[14rem] flex-1 flex-col gap-2">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) onPick(picked);
              // Permet de re-choisir le même fichier après un « Annuler ».
              e.target.value = '';
            }}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-muted-foreground hover:file:bg-muted"
          />
          {file ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{file.name}</span>
              <span>— sera envoyée à l’enregistrement.</span>
              <button
                type="button"
                onClick={onClear}
                className="rounded-md border border-border bg-card px-2 py-1 font-medium transition hover:bg-muted"
              >
                Annuler
              </button>
            </div>
          ) : (
            value && (
              <button
                type="button"
                onClick={onClear}
                className="self-start rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-destructive transition hover:bg-destructive/10"
              >
                Retirer l’image
              </button>
            )
          )}
        </div>
      </div>
      <FieldHelp help={spec.help} />
    </div>
  );
}
