// Multi-tenant — PR6b : champs de l'écran « Configuration du site » (MULTI_TENANT.md §6.1).
//
// Rendus À PARTIR des specs de `src/lib/clubConfigWrite.ts` : le libellé affiché ici et la
// validation qui refuse la valeur viennent de la même ligne de la même table.
//
// Rien à voir avec `ConfigurationForm.tsx` / `ConfigDropdown.tsx`, qui sont les réglages d'un
// TOURNOI TMC (`GlobalConfig`, `TENNIS_RANKINGS`).
import { useEffect, useMemo, useState } from 'react';
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
      {/* PR7 — les proportions sont une CONTRAINTE (le sélecteur refuse ce qui s'en écarte),
          la taille un MINIMUM : le libellé dit les deux plutôt qu'une définition exacte. */}
      {spec.dimensions && (
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          à partir de {spec.dimensions.width} × {spec.dimensions.height} px
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
          // PR6d — un MONTANT reste un `input[type=text]`. Un `input[type=number]` rend une
          // CHAÎNE VIDE dès que la saisie n'est pas un nombre : un « 15€ / h » collé
          // disparaîtrait, et une saisie invalide passerait pour un champ laissé vide, donc
          // pour une clé omise, au lieu du refus nommé d'`amountSchema`. `inputMode` suffit à
          // ouvrir le pavé numérique sur mobile.
          type={spec.type === 'email' ? 'email' : spec.type === 'tel' ? 'tel' : 'text'}
          inputMode={spec.type === 'number' ? 'decimal' : undefined}
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
 * Ce qui compte est le RATIO, pas la taille exacte — et il se compare avec une TOLÉRANCE.
 *
 * Les deux gabarits d'affiche sont de l'A4 portrait, mais aucune définition en pixels ne tombe
 * juste : 794 × 1123 vaut 0,70703, 1414 × 2000 vaut 0,70700, 595 × 842 vaut 0,70665 — tous de
 * l'A4, aucun égal à l'autre. Un contrôle en produit en croix exact refusait donc un fichier
 * parfaitement utilisable au seul motif qu'il venait d'une autre définition du même format.
 *
 * 2 % de tolérance relative couvre toutes les définitions A4 courantes et refuse toujours ce
 * qui casse vraiment l'affiche : un 4:5 (0,80) est à 13 %, un 3:2 à 94 %. Un écart de 2 % au
 * pire déforme d'un demi-pourcent de hauteur, invisible.
 */
const RATIO_TOLERANCE = 0.02;

/** `0.70703` → `0,71` : c'est ce que lit l'admin, pas une valeur de calcul. */
function formatRatio(width: number, height: number): string {
  return (width / height).toFixed(2).replace('.', ',');
}

/**
 * Contrôle du GABARIT avant tout upload — PR7, les deux fonds d'affiche.
 *
 * REFUSER et non avertir : un avertissement se franchit d'un clic, et l'affiche fausse ne se
 * voit qu'après diffusion. Rend le message d'erreur, ou `null` si le fichier convient.
 *
 * Deux règles, et deux seulement :
 *   - les PROPORTIONS, à 2 % près — le fond des rencontres est rendu en `width/height: 100%`
 *     sans `object-fit`, une image aux mauvaises proportions y serait ÉTIRÉE en silence ;
 *   - une définition AU MOINS égale à celle du rendu — l'affiche est exportée à `pixelRatio: 2`,
 *     une image plus petite serait visiblement floue. Plus grande, elle est bienvenue.
 */
async function checkDimensions(
  file: File,
  expected: { width: number; height: number },
): Promise<string | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return 'Fichier image illisible — choisissez un PNG ou un JPEG.';
  const { width, height } = bitmap;
  bitmap.close();

  const target = expected.width / expected.height;
  if (Math.abs(width / height - target) / target > RATIO_TOLERANCE) {
    return `Proportions incompatibles : attendu un ratio de ${formatRatio(expected.width, expected.height)} (largeur ÷ hauteur), par exemple ${expected.width} × ${expected.height} px — reçu ${width} × ${height} px, soit ${formatRatio(width, height)}.`;
  }
  if (width < expected.width) {
    return `Image trop petite : l’affiche est rendue en ${expected.width} × ${expected.height} px, une image de ${width} × ${height} px y serait floue.`;
  }
  return null;
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
  /** Refus de gabarit (PR7). Purement local : le fichier refusé n'atteint jamais l'état du
   *  panneau, donc encore moins le Storage. */
  const [formatError, setFormatError] = useState<string | null>(null);

  const handlePick = async (picked: File) => {
    const error = spec.dimensions ? await checkDimensions(picked, spec.dimensions) : null;
    setFormatError(error);
    if (!error) onPick(picked);
  };

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
              if (picked) void handlePick(picked);
              // Permet de re-choisir le même fichier après un « Annuler ».
              e.target.value = '';
            }}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-muted-foreground hover:file:bg-muted"
          />
          {formatError && (
            <p className="text-xs font-medium text-destructive">{formatError}</p>
          )}
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
