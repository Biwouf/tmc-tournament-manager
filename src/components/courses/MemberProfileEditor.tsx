import { useEffect, useState } from "react";
import {
  courseError,
  readCourses,
  type CourseMember,
  type Sex,
} from "../../lib/courses";
import { useCourseAdmin } from "../../hooks/useCourseAdmin";
import { CourseError } from "./CourseUI";
export default function MemberProfileEditor({
  clubId,
  userId,
  onClose,
  onSaved,
}: {
  clubId: string;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [profile, setProfile] = useState<CourseMember | null>(null);
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [sex, setSex] = useState<Sex | "">("");
  const { run, error, busy, setError } = useCourseAdmin(clubId);
  useEffect(() => {
    let ignore = false;
    readCourses<CourseMember>(clubId, "members", userId)
      .then((rows) => {
        if (ignore) return;
        const p = rows[0];
        if (!p) throw new Error("NOT_MEMBER");
        setProfile(p);
        setPrenom(p.prenom ?? "");
        setNom(p.nom ?? "");
        setSex(p.sex ?? "");
      })
      .catch((e) => {
        if (!ignore) setError(courseError(e));
      });
    return () => {
      ignore = true;
    };
  }, [clubId, userId, setError]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    if (
      await run("profile", {
        user_id: userId,
        prenom,
        nom,
        sex,
        revision: profile.revision,
      })
    ) {
      onSaved();
      onClose();
    }
  }
  return (
    <section aria-label="Modifier le profil" className="course-panel space-y-4">
      <h2 className="text-xl font-semibold">Modifier le profil</h2>
      <p className="text-sm text-muted-foreground">
        Ce profil est partagé entre les clubs de ce membre. Modifier son sexe ne
        change pas les quotas des inscriptions existantes.
      </p>
      <CourseError message={error} />
      {!profile ? (
        <p>Chargement…</p>
      ) : (
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={save}>
          <label>
            Prénom
            <input
              className="course-field"
              autoComplete="given-name"
              required
              maxLength={100}
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
            />
          </label>
          <label>
            Nom
            <input
              className="course-field"
              autoComplete="family-name"
              required
              maxLength={100}
              value={nom}
              onChange={(e) => setNom(e.target.value)}
            />
          </label>
          <label>
            Sexe
            <select
              className="course-field"
              required
              value={sex}
              onChange={(e) => setSex(e.target.value as Sex)}
            >
              <option value="">Choisir…</option>
              <option value="female">Féminin</option>
              <option value="male">Masculin</option>
            </select>
          </label>
          <button className="course-primary" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer le profil"}
          </button>
        </form>
      )}
      <button className="course-button" disabled={busy} onClick={onClose}>
        Fermer
      </button>
    </section>
  );
}
