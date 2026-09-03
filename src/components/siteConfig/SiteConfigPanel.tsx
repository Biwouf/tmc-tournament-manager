// Multi-tenant — PR6b : un panneau = un groupe de config, avec son propre enregistrement.
//
// Un bouton par groupe, et non un pour la page : corriger un numéro de téléphone n'a pas à
// réécrire l'identité du club, une erreur de validation sur un groupe ne bloque pas les
// autres, et l'UPDATE ne touche qu'une clé racine — deux onglets ouverts sur deux panneaux
// différents ne s'écrasent plus (brief §5, §7).
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { STORAGE_BUCKETS, clubPath, extractStoragePath, sanitizeFilename } from '../../lib/storage';
import {
  itemsOf,
  saveClubConfigGroup,
  validateClubConfigGroup,
  type GroupSpec,
  type GroupValue,
  type ListEntry,
  type ItemSpec,
  type ListSpec,
} from '../../lib/clubConfigWrite';
import { BoolField, ImageField, ScalarField } from './SiteConfigFields';

// Décision brief §8, voie (a) : le bucket générique existant, sous `<club_id>/config/…`.
// Zéro migration — c'est ce qui garde PR6b déployable par un simple push. Un bucket dédié
// serait plus lisible, mais PR7-bis le créera quand elle aura elle-même besoin d'y mettre les
// logos et les icônes PWA.
const BUCKET = STORAGE_BUCKETS.contentImages;

/** Chemin d'un champ image dans l'état du panneau : `logo` ou `infra_teaser.1.image`. */
type PendingFiles = Record<string, File>;

function entryPath(listKey: string, index: number, fieldKey: string) {
  return `${listKey}.${index}.${fieldKey}`;
}

/** Toutes les URL d'image portées par une valeur de groupe, listes comprises. */
function imageUrls(group: GroupSpec, value: GroupValue): string[] {
  const urls: string[] = [];
  for (const item of itemsOf(group)) {
    if (item.kind === 'list') {
      const entries = (value[item.key] as ListEntry[] | undefined) ?? [];
      for (const entry of entries) {
        for (const field of item.fields) {
          if (field.type === 'image' && entry[field.key]) urls.push(entry[field.key]);
        }
      }
    } else if (item.type === 'image' && typeof value[item.key] === 'string' && value[item.key]) {
      urls.push(value[item.key] as string);
    }
  }
  return urls;
}

function setAtPath(value: GroupValue, path: string, url: string): GroupValue {
  const [head, index, leaf] = path.split('.');
  if (leaf === undefined) return { ...value, [head]: url };
  const entries = ((value[head] as ListEntry[] | undefined) ?? []).map((entry, i) =>
    i === Number(index) ? { ...entry, [leaf]: url } : entry,
  );
  return { ...value, [head]: entries };
}

/**
 * Marqueur temporaire d'un champ image dont le fichier n'est pas encore envoyé. Il ne sort
 * jamais d'ici : chaque chemin marqué est réécrit par l'URL réelle juste après l'upload.
 * Le type `image` n'a volontairement AUCUN contrôle de format (cf. `FORMATS`), donc rien ne
 * s'oppose à cette valeur le temps de la validation.
 */
const PENDING_IMAGE = '(fichier en attente d’envoi)';

/**
 * Un fichier choisi vit dans `files` jusqu'à l'upload, PAS dans `value`. Valider `value` tel
 * quel refuse donc un champ image ⬤ qu'on vient pourtant de renseigner — le cas de
 * `partners[].logo`, premier champ image obligatoire à l'intérieur d'une entrée de liste (au
 * niveau du GROUPE, un ⬤ vide est accepté, d'où l'absence du problème sur `brand.logo`).
 *
 * On valide donc une PROJECTION où chaque chemin en attente porte une valeur non vide. L'ordre
 * de PR6b est préservé — valider, puis uploader : on n'envoie toujours rien au Storage pour un
 * panneau que l'écriture refusera.
 */
function withPendingImages(value: GroupValue, files: PendingFiles): GroupValue {
  return Object.keys(files).reduce((acc, path) => setAtPath(acc, path, PENDING_IMAGE), value);
}

// `clubPath()` est obligatoire : les policies Storage lisent le premier segment via
// `can_write_club_object(name)`, donc un chemin construit à la main serait refusé par la RLS.
// Le chemin porte l'horodatage ET le champ visé : trois images d'une même liste enregistrées
// ensemble ne peuvent pas se télescoper à la milliseconde près.
async function uploadConfigImage(clubId: string, path: string, file: File): Promise<string> {
  const key = clubPath(
    clubId,
    'config',
    `${Date.now()}-${sanitizeFilename(path)}-${sanitizeFilename(file.name)}`,
  );
  const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
    contentType: file.type,
    cacheControl: '3600',
  });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
}

/** Un sous-titre s'ouvre quand la `section` de la spec change ; un item qui n'en porte pas
 *  reste sous la section en cours. */
function withHeadings(items: ItemSpec[]): { item: ItemSpec; heading: string | null }[] {
  let current: string | undefined;
  return items.map((item) => {
    const heading = item.section && item.section !== current ? item.section : null;
    if (item.section) current = item.section;
    return { item, heading };
  });
}

async function deleteConfigImage(publicUrl: string) {
  const key = extractStoragePath(BUCKET, publicUrl);
  if (!key) return;
  const { error } = await supabase.storage.from(BUCKET).remove([key]);
  // L'écriture est déjà passée : un orphelin dans le bucket ne justifie pas d'annoncer un
  // échec d'enregistrement qui n'a pas eu lieu.
  if (error) console.error('[SiteConfig] suppression de l’ancienne image impossible', error);
}

export default function SiteConfigPanel({
  group,
  initial,
  clubId,
  onSaved,
}: {
  group: GroupSpec;
  initial: GroupValue;
  clubId: string | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<GroupValue>(initial);
  /** Dernier état réellement en base — sert à savoir quelles images ont été remplacées. */
  const [persisted, setPersisted] = useState<GroupValue>(initial);
  const [files, setFiles] = useState<PendingFiles>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const edit = (updater: (prev: GroupValue) => GroupValue) => {
    setErrors([]);
    setSaved(false);
    setValue(updater);
  };

  const entriesOf = (list: ListSpec) => (value[list.key] as ListEntry[] | undefined) ?? [];

  const setEntries = (list: ListSpec, next: ListEntry[]) =>
    edit((prev) => ({ ...prev, [list.key]: next }));

  /** Les fichiers en attente sont indexés par position : toute mutation de la liste doit les
   *  suivre, sinon un fichier choisi atterrit sur la mauvaise entrée. */
  const remapFiles = (listKey: string, moved: (index: number) => number | null) =>
    setFiles((prev) => {
      const next: PendingFiles = {};
      for (const [path, file] of Object.entries(prev)) {
        const [head, index, leaf] = path.split('.');
        if (head !== listKey || leaf === undefined) {
          next[path] = file;
          continue;
        }
        const target = moved(Number(index));
        if (target !== null) next[entryPath(listKey, target, leaf)] = file;
      }
      return next;
    });

  const addEntry = (list: ListSpec) =>
    setEntries(list, [
      ...entriesOf(list),
      Object.fromEntries(list.fields.map((f) => [f.key, ''])) as ListEntry,
    ]);

  const removeEntry = (list: ListSpec, index: number) => {
    setEntries(
      list,
      entriesOf(list).filter((_, i) => i !== index),
    );
    remapFiles(list.key, (i) => (i === index ? null : i > index ? i - 1 : i));
  };

  const moveEntry = (list: ListSpec, index: number, delta: number) => {
    const entries = entriesOf(list);
    const target = index + delta;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    [next[index], next[target]] = [next[target], next[index]];
    setEntries(list, next);
    remapFiles(list.key, (i) => (i === index ? target : i === target ? index : i));
  };

  const pickFile = (path: string, file: File) => {
    setErrors([]);
    setSaved(false);
    setFiles((prev) => ({ ...prev, [path]: file }));
  };

  /** Annule un fichier en attente, ou retire l'image enregistrée si aucun n'est en attente. */
  const clearImage = (path: string) => {
    setErrors([]);
    setSaved(false);
    if (files[path]) {
      setFiles((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      return;
    }
    setValue((prev) => setAtPath(prev, path, ''));
  };

  const handleSave = async () => {
    setErrors([]);
    setSaved(false);
    if (!clubId) {
      setErrors(['Club introuvable — enregistrement impossible.']);
      return;
    }

    // Valider AVANT d'uploader : inutile d'envoyer une image au Storage pour un panneau que
    // l'écriture va refuser — ce serait un orphelin garanti. Les fichiers en attente comptent
    // comme renseignés (`withPendingImages`), sans quoi un logo qu'on vient de choisir serait
    // refusé pour cause de champ vide.
    const validated = validateClubConfigGroup(group, withPendingImages(value, files));
    if (!validated.valid) {
      setErrors(validated.errors);
      return;
    }

    setSaving(true);
    let next = validated.value;
    try {
      for (const [path, file] of Object.entries(files)) {
        next = setAtPath(next, path, await uploadConfigImage(clubId, path, file));
      }
    } catch (error) {
      setSaving(false);
      setErrors([
        `Envoi de l’image impossible : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      ]);
      return;
    }

    const result = await saveClubConfigGroup(clubId, group, next);
    if (!result.success) {
      setSaving(false);
      setErrors(result.errors);
      return;
    }

    // Nettoyage APRÈS écriture réussie, et par URL plutôt que par champ : une entrée de liste
    // déplacée garde son image, seule celle qui n'est plus référencée nulle part est un
    // orphelin. Comparer champ par champ supprimerait l'image d'une entrée simplement
    // réordonnée.
    const kept = new Set(imageUrls(group, next));
    for (const url of imageUrls(group, persisted)) {
      if (!kept.has(url)) await deleteConfigImage(url);
    }

    setValue(next);
    setPersisted(next);
    setFiles({});
    setSaving(false);
    setSaved(true);
    onSaved();
  };

  return (
    <section>
      <div className="mb-3.5 flex items-baseline gap-3.5">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
          {group.label}
        </h2>
        <span
          className="h-px flex-1"
          style={{
            background: 'linear-gradient(to right, hsl(var(--border)), transparent)',
          }}
        />
        <span className="hidden text-xs text-muted-foreground md:inline">{group.hint}</span>
      </div>

      <div className="rounded-2xl border bg-card/90 p-6 shadow-sm">
        {errors.length > 0 && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p className="font-medium">Rien n’a été enregistré :</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}
        {saved && (
          <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
            {group.label} — enregistré.
          </div>
        )}

        <div className="flex flex-col gap-5">
          {withHeadings(itemsOf(group)).map(({ item, heading }) => (
            <div key={item.key} className="flex flex-col gap-5">
              {heading && (
                <h3 className="mt-1 text-sm font-semibold text-card-foreground">{heading}</h3>
              )}

              {item.kind === 'list' ? (
                <RepeatableList
                  list={item}
                  entries={entriesOf(item)}
                  files={files}
                  onChangeEntry={(index, fieldKey, fieldValue) =>
                    setEntries(
                      item,
                      entriesOf(item).map((entry, i) =>
                        i === index ? { ...entry, [fieldKey]: fieldValue } : entry,
                      ),
                    )
                  }
                  onPickFile={pickFile}
                  onClearImage={clearImage}
                  onAdd={() => addEntry(item)}
                  onRemove={(index) => removeEntry(item, index)}
                  onMove={(index, delta) => moveEntry(item, index, delta)}
                />
              ) : item.type === 'bool' ? (
                <BoolField
                  spec={item}
                  // L'absence vaut `true` (web_site_brief §5.10), comme à la lecture.
                  value={value[item.key] !== false}
                  onChange={(checked) => edit((prev) => ({ ...prev, [item.key]: checked }))}
                />
              ) : item.type === 'image' ? (
                <ImageField
                  spec={item}
                  value={(value[item.key] as string) ?? ''}
                  file={files[item.key] ?? null}
                  onPick={(file) => pickFile(item.key, file)}
                  onClear={() => clearImage(item.key)}
                />
              ) : (
                <ScalarField
                  spec={item}
                  value={(value[item.key] as string) ?? ''}
                  onChange={(fieldValue) => edit((prev) => ({ ...prev, [item.key]: fieldValue }))}
                />
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3 border-t border-border/70 pt-5">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60"
          >
            {saving ? '...' : `Enregistrer — ${group.label}`}
          </button>
          <span className="text-xs text-muted-foreground">
            Ce bouton n’enregistre que ce panneau.
          </span>
        </div>
      </div>
    </section>
  );
}

function RepeatableList({
  list,
  entries,
  files,
  onChangeEntry,
  onPickFile,
  onClearImage,
  onAdd,
  onRemove,
  onMove,
}: {
  list: ListSpec;
  entries: ListEntry[];
  files: PendingFiles;
  onChangeEntry: (index: number, fieldKey: string, value: string) => void;
  onPickFile: (path: string, file: File) => void;
  onClearImage: (path: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, delta: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{list.label}</span>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
        >
          Ajouter un {list.singular}
        </button>
      </div>
      {list.help && <p className="mb-2 text-xs text-muted-foreground">{list.help}</p>}

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          Aucun {list.singular} pour l’instant.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry, index) => (
            <div key={index} className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {list.singular} n° {index + 1}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMove(index, -1)}
                    disabled={index === 0}
                    aria-label={`Monter le ${list.singular} n° ${index + 1}`}
                    className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(index, 1)}
                    disabled={index === entries.length - 1}
                    aria-label={`Descendre le ${list.singular} n° ${index + 1}`}
                    className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-destructive transition hover:bg-destructive/10"
                  >
                    Retirer
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {list.fields.map((field) => {
                  const path = entryPath(list.key, index, field.key);
                  return field.type === 'image' ? (
                    <ImageField
                      key={field.key}
                      spec={field}
                      value={entry[field.key] ?? ''}
                      file={files[path] ?? null}
                      onPick={(file) => onPickFile(path, file)}
                      onClear={() => onClearImage(path)}
                    />
                  ) : (
                    <ScalarField
                      key={field.key}
                      spec={field}
                      value={entry[field.key] ?? ''}
                      onChange={(fieldValue) => onChangeEntry(index, field.key, fieldValue)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
