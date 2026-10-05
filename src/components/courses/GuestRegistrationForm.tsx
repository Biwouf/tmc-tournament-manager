import { useEffect, useState } from "react";
import {
  courseError,
  readCourses,
  type CourseGuest,
  type Sex,
} from "../../lib/courses";
import { useCourseAdmin } from "../../hooks/useCourseAdmin";
import { CourseError } from "./CourseUI";
const sexLabel = (sex: Sex) => (sex === "female" ? "Femmes" : "Hommes");

// Inscription confirmée d'une personne sans compte. Propose les fiches
// existantes du club avant d'en créer une nouvelle.
export default function GuestRegistrationForm({
  clubId,
  courseId,
  onAdded,
}: {
  clubId: string;
  courseId: string;
  onAdded: () => void;
}) {
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [sex, setSex] = useState<Sex | "">("");
  const [selected, setSelected] = useState<CourseGuest | null>(null);
  const [matches, setMatches] = useState<CourseGuest[]>([]);
  const { run, busy, error, setError } = useCourseAdmin(clubId);
  const query = `${prenom.trim()} ${nom.trim()}`.trim();
  useEffect(() => {
    if (selected || query.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      readCourses<CourseGuest>(clubId, "guests", undefined, query)
        .then((rows) => {
          if (current) setMatches(rows.slice(0, 5));
        })
        .catch((e) => {
          if (current) setError(courseError(e));
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [clubId, query, selected, setError]);
  const shown = selected || query.length < 2 ? [] : matches;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let guest = selected;
    if (!guest) {
      if (!sex) return;
      const saved = await run("save_guest", { prenom, nom, sex });
      if (!saved) return;
      // Conservée : une relance après échec n'en crée pas une seconde.
      guest = {
        guest_id: saved.id,
        prenom: prenom.trim(),
        nom: nom.trim(),
        sex,
        revision: saved.revision,
      };
      setSelected(guest);
    }
    if (
      await run("add_registration", {
        course_id: courseId,
        guest_id: guest.guest_id,
        status: "approved",
      })
    ) {
      setSelected(null);
      setPrenom("");
      setNom("");
      setSex("");
      onAdded();
    }
  }
  return (
    <form className="space-y-3" onSubmit={submit}>
      <CourseError message={error} />
      {selected ? (
        <div className="registration-selected">
          <p>
            ✓ {selected.prenom} {selected.nom} · {sexLabel(selected.sex)}
          </p>
          <button
            type="button"
            className="course-button"
            disabled={busy}
            onClick={() => setSelected(null)}
          >
            Changer
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            Prénom
            <input
              className="course-field"
              required
              maxLength={100}
              disabled={busy}
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
            />
          </label>
          <label>
            Nom
            <input
              className="course-field"
              required
              maxLength={100}
              disabled={busy}
              value={nom}
              onChange={(e) => setNom(e.target.value)}
            />
          </label>
          <label>
            Sexe
            <select
              className="course-field"
              required
              disabled={busy}
              value={sex}
              onChange={(e) => setSex(e.target.value as Sex)}
            >
              <option value="">Choisir…</option>
              <option value="female">Féminin</option>
              <option value="male">Masculin</option>
            </select>
          </label>
        </div>
      )}
      {shown.length > 0 && (
        <div className="registration-selected">
          <p>Déjà venu(e) ? Réutilisez sa fiche :</p>
          <div className="flex flex-wrap gap-2">
            {shown.map((g) => (
              <button
                key={g.guest_id}
                type="button"
                className="course-button"
                disabled={busy}
                onClick={() => setSelected(g)}
              >
                {g.prenom} {g.nom} · {sexLabel(g.sex)}
              </button>
            ))}
          </div>
        </div>
      )}
      <button className="course-primary" disabled={busy}>
        Inscrire (confirmé)
      </button>
    </form>
  );
}
