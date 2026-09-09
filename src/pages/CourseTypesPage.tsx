import { useCallback, useEffect, useState } from "react";
import { useClub } from "../contexts/ClubContext";
import { supabase } from "../lib/supabase";
import {
  readCourses,
  courseError,
  courseImage,
  uploadCourseImage,
  type CourseType,
} from "../lib/courses";
import {
  CourseError,
  CoursePager,
  CourseShell,
} from "../components/courses/CourseUI";
import { useCourseAdmin } from "../hooks/useCourseAdmin";
export default function CourseTypesPage() {
  const { clubId } = useClub();
  const [rows, setRows] = useState<CourseType[]>([]);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<CourseType | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPath, setUploadPath] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const { run, busy, error, setError } = useCourseAdmin(clubId);
  const load = useCallback(async () => {
    if (clubId) {
      try {
        setRows(
          await readCourses<CourseType>(clubId, "types", undefined, "", offset),
        );
      } catch (e) {
        setError(courseError(e));
      }
    }
  }, [clubId, offset, setError]);
  useEffect(() => {
    void load();
  }, [load]);
  function edit(t: CourseType | null) {
    setEditing(t);
    setName(t?.name ?? "");
    setPath(t?.image_path ?? null);
    setFile(null);
    setUploadPath(null);
    setFileKey((v) => v + 1);
    setError(null);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!clubId || uploading) return;
    setUploading(true);
    try {
      const imagePath = file
        ? (uploadPath ?? (await uploadCourseImage(clubId, file)))
        : path;
      if (file) setUploadPath(imagePath);
      const result = await run("save_type", {
        ...(editing ? { id: editing.id, revision: editing.revision } : {}),
        name,
        image_path: imagePath,
      });
      if (result) {
        const previous = editing?.image_path;
        edit(null);
        await load();
        if (previous && previous !== imagePath) {
          const { error: cleanup } = await supabase.storage
            .from("course-type-images")
            .remove([previous]);
          if (cleanup)
            setError(
              "Type enregistré. L’ancienne image n’a pas pu être nettoyée.",
            );
        }
      }
    } catch (e) {
      setError(courseError(e));
    } finally {
      setUploading(false);
    }
  }
  async function change(t: CourseType, operation: string) {
    if (
      !window.confirm(
        operation === "archive_type"
          ? `Archiver « ${t.name} » ? Les cours existants le conservent.`
          : `Supprimer « ${t.name} » ? Impossible si un cours l’utilise.`,
      )
    )
      return;
    if (await run(operation, { id: t.id, revision: t.revision })) {
      if (editing?.id === t.id) edit(null);
      await load();
    }
  }
  return (
    <CourseShell title="Types de cours">
      <CourseError message={error} />
      <form onSubmit={save} className="course-panel space-y-4">
        <h2 className="text-lg font-semibold">
          {editing ? "Modifier le type" : "Ajouter un type"}
        </h2>
        <label className="block">
          Nom
          <input
            className="course-field"
            maxLength={80}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          Image facultative · JPEG, PNG, WebP · 5 Mo
          <input
            key={fileKey}
            className="course-field"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setUploadPath(null);
            }}
          />
        </label>
        {path && (
          <div className="flex items-center gap-4">
            <img
              src={courseImage(path)!}
              alt="Illustration du type"
              className="h-24 w-32 rounded-lg object-cover"
            />
            <button
              type="button"
              className="course-button"
              onClick={() => {
                setPath(null);
                setFile(null);
                setFileKey((v) => v + 1);
              }}
            >
              Retirer l’image
            </button>
          </div>
        )}
        <div className="flex gap-3">
          <button className="course-primary" disabled={busy || uploading}>
            {busy || uploading ? "Enregistrement…" : "Enregistrer"}
          </button>
          {editing && (
            <button
              type="button"
              className="course-button"
              onClick={() => edit(null)}
            >
              Nouveau type
            </button>
          )}
        </div>
      </form>
      <div className="space-y-3">
        {rows.length === 0 && <p>Aucun type.</p>}
        {rows.map((t) => (
          <article
            key={t.id}
            className="course-panel flex flex-wrap items-center justify-between gap-3"
          >
            <p className="font-semibold">
              {t.name}
              {t.archived_at ? " — Archivé" : ""}
            </p>
            <div className="flex gap-2">
              <button
                className="course-button"
                disabled={busy || uploading}
                onClick={() => edit(t)}
              >
                Modifier
              </button>
              {!t.archived_at && (
                <button
                  className="course-button"
                  disabled={busy || uploading}
                  onClick={() => change(t, "archive_type")}
                >
                  Archiver
                </button>
              )}
              <button
                className="course-button"
                disabled={busy || uploading}
                onClick={() => change(t, "delete_type")}
              >
                Supprimer
              </button>
            </div>
          </article>
        ))}
      </div>
      <CoursePager offset={offset} count={rows.length} onChange={setOffset} />
    </CourseShell>
  );
}
