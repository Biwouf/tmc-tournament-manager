import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useClub } from "../contexts/ClubContext";
import {
  readCourses,
  courseError,
  parisInput,
  parisCandidates,
  type Course,
  type CourseType,
} from "../lib/courses";
import { CourseError, CourseShell } from "../components/courses/CourseUI";
import { useCourseAdmin } from "../hooks/useCourseAdmin";
import CourseOwnerPicker from "../components/courses/CourseOwnerPicker";
export default function CourseFormPage() {
  const { clubId } = useClub();
  const { id } = useParams();
  const navigate = useNavigate();
  const [types, setTypes] = useState<CourseType[]>([]);
  const [course, setCourse] = useState<Course | null>(null);
  const [ready, setReady] = useState(false);
  const [fields, setFields] = useState({
    name: "",
    type_id: "",
    owner_id: "",
    local: "",
    duration_minutes: "60",
    capacity_female: "4",
    capacity_male: "4",
  });
  const [ambiguous, setAmbiguous] = useState("");
  const { run, busy, error, setError } = useCourseAdmin(clubId);
  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!clubId) return;
      const allTypes: CourseType[] = [];
      for (let offset = 0; ; offset += 50) {
        const page = await readCourses<CourseType>(
          clubId,
          "types",
          undefined,
          "",
          offset,
        );
        allTypes.push(...page);
        if (page.length < 50) break;
      }
      const c = id
        ? (await readCourses<Course>(clubId, "courses", id))[0]
        : null;
      if (id && !c) throw new Error("NOT_FOUND");
      if (ignore) return;
      setTypes(allTypes);
      setCourse(c ?? null);
      if (c) {
        setFields({
          name: c.name,
          type_id: c.type_id,
          owner_id: c.owner_id ?? "",
          local: parisInput(c.starts_at),
          duration_minutes: String(c.duration_minutes),
          capacity_female: String(c.capacity_female),
          capacity_male: String(c.capacity_male),
        });
        setAmbiguous(new Date(c.starts_at).toISOString());
      }
      setReady(true);
    }
    void load().catch((e) => {
      if (!ignore) setError(courseError(e));
    });
    return () => {
      ignore = true;
    };
  }, [clubId, id, setError]);
  const candidates = parisCandidates(fields.local);
  const update = (key: keyof typeof fields, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const date =
      candidates.length === 1
        ? candidates[0]
        : candidates.find((c) => c === ambiguous);
    if (!date) {
      setError(
        candidates.length
          ? "Choisissez le décalage horaire pour cette heure ambiguë."
          : "Cette heure est invalide ou inexistante en Europe/Paris.",
      );
      return;
    }
    const result = await run("save_course", {
      ...(course ? { id: course.id, revision: course.revision } : {}),
      name: fields.name,
      type_id: fields.type_id,
      owner_id: fields.owner_id || null,
      starts_at: date,
      duration_minutes: Number(fields.duration_minutes),
      capacity_female: Number(fields.capacity_female),
      capacity_male: Number(fields.capacity_male),
    });
    if (result) navigate("/courses");
  }
  return (
    <CourseShell title={id ? "Modifier le cours" : "Créer un cours"}>
      <CourseError message={error} />
      {!ready ? (
        <p>Chargement…</p>
      ) : (
        <form
          className="course-panel grid max-w-3xl gap-4 sm:grid-cols-2"
          onSubmit={submit}
        >
          {clubId && <CourseOwnerPicker clubId={clubId} value={fields.owner_id} required={!course} onChange={(value) => update("owner_id", value)} />}
          <label>
            Nom du cours
            <input
              className="course-field"
              required
              maxLength={120}
              value={fields.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>
          <label>
            Type
            <select
              className="course-field"
              required
              value={fields.type_id}
              onChange={(e) => update("type_id", e.target.value)}
            >
              <option value="">Choisir…</option>
              {types
                .filter((t) => !t.archived_at || t.id === course?.type_id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.archived_at ? " (archivé)" : ""}
                  </option>
                ))}
            </select>
          </label>
          {!types.some((t) => !t.archived_at) && (
            <Link className="text-primary" to="/courses/types">
              Créer un type de cours
            </Link>
          )}
          <label>
            Date et heure · Europe/Paris
            <input
              className="course-field"
              type="datetime-local"
              required
              value={fields.local}
              disabled={course?.has_registrations}
              onChange={(e) => {
                update("local", e.target.value);
                setAmbiguous("");
              }}
            />
          </label>
          {candidates.length === 2 && (
            <label>
              Heure d’hiver : préciser le décalage
              <select
                className="course-field"
                required
                disabled={course?.has_registrations}
                value={ambiguous}
                onChange={(e) => setAmbiguous(e.target.value)}
              >
                <option value="">Choisir…</option>
                {candidates.map((c, i) => (
                  <option key={c} value={c}>
                    UTC+{i === 0 ? "2 (été)" : "1 (hiver)"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Durée (minutes)
            <input
              className="course-field"
              type="number"
              min={1}
              max={1440}
              required
              disabled={course?.has_registrations}
              value={fields.duration_minutes}
              onChange={(e) => update("duration_minutes", e.target.value)}
            />
          </label>
          <label>
            Places femmes
            <input
              className="course-field"
              type="number"
              min={0}
              max={1000}
              required
              value={fields.capacity_female}
              onChange={(e) => update("capacity_female", e.target.value)}
            />
          </label>
          <label>
            Places hommes
            <input
              className="course-field"
              type="number"
              min={0}
              max={1000}
              required
              value={fields.capacity_male}
              onChange={(e) => update("capacity_male", e.target.value)}
            />
          </label>
          <p className="self-end py-2">
            Total :{" "}
            {Number(fields.capacity_female) + Number(fields.capacity_male)}{" "}
            places
          </p>
          {course?.has_registrations && (
            <p className="text-sm sm:col-span-2">
              Des demandes existent : pour changer l’horaire ou la durée,
              annulez puis recréez le cours.
            </p>
          )}
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Le cours est publié dès sa création. Aucun email ou push n’est
            envoyé.
          </p>
          <div className="flex gap-3 sm:col-span-2">
            <button
              className="course-primary"
              disabled={busy || !!course?.cancelled_at}
            >
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <Link to="/courses" className="course-button">
              Retour
            </Link>
          </div>
        </form>
      )}
    </CourseShell>
  );
}
