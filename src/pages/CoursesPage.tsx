import { useCourseClock } from "../hooks/useCourseClock";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useClub } from "../contexts/ClubContext";
import {
  courseError,
  formatCourseDate,
  readCourses,
  type Course,
} from "../lib/courses";
import {
  CourseError,
  CoursePager,
  CourseShell,
} from "../components/courses/CourseUI";
import { useCourseAdmin } from "../hooks/useCourseAdmin";
export default function CoursesPage() {
  const now = useCourseClock();
  const { clubId } = useClub();
  const [rows, setRows] = useState<Course[] | null>(null);
  const [filter, setFilter] = useState("upcoming");
  const [offset, setOffset] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { run, busy, error } = useCourseAdmin(clubId);
  const load = useCallback(async () => {
    if (!clubId) return;
    try {
      const data = await readCourses<Course>(
        clubId,
        "courses",
        undefined,
        "",
        offset,
        filter,
      );
      setRows(data);
      setLoadError(null);
    } catch (e) {
      setLoadError(courseError(e));
    }
  }, [clubId, offset, filter]);
  useEffect(() => {
    let ignore = false;
    if (clubId)
      readCourses<Course>(clubId, "courses", undefined, "", offset, filter)
        .then((data) => {
          if (!ignore) {
            setRows(data);
            setLoadError(null);
          }
        })
        .catch((e) => {
          if (!ignore) setLoadError(courseError(e));
        });
    return () => {
      ignore = true;
    };
  }, [clubId, offset, filter]);
  async function remove(course: Course) {
    const operation = course.has_registrations
      ? "cancel_course"
      : "delete_course";
    if (
      !window.confirm(
        course.has_registrations
          ? `Annuler « ${course.name} » et toutes ses inscriptions actives ? Aucun message ne sera envoyé aux membres.`
          : `Supprimer définitivement « ${course.name} » ?`,
      )
    )
      return;
    if (await run(operation, { id: course.id, revision: course.revision }))
      await load();
  }
  return (
    <CourseShell title="Cours">
      <div className="flex flex-wrap gap-3">
        <Link to="/courses/new" className="course-primary">
          Créer un cours
        </Link>
        <select
          aria-label="Période"
          className="course-button"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setOffset(0);
            setRows(null);
          }}
        >
          <option value="upcoming">À venir</option>
          <option value="past">Passés</option>
        </select>
        <button className="course-button" onClick={load}>
          Actualiser
        </button>
      </div>
      <CourseError message={error || loadError} />
      {!rows ? (
        <p>Chargement…</p>
      ) : rows.length === 0 ? (
        <p>Aucun cours pour cette période.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((c) => (
            <article className="course-panel space-y-3" key={c.id}>
              <p className="text-sm text-muted-foreground">
                {formatCourseDate(c.starts_at)} · {c.duration_minutes} min ·
                Europe/Paris
              </p>
              <h2 className="text-xl font-semibold">
                {c.name}
                {c.cancelled_at ? " — Annulé" : ""}
              </h2>
              {!c.owner_id && <p className="text-sm text-amber-700">Responsable à désigner</p>}
              <p>
                {c.type_name} · {c.owner_first_name || 'À désigner'}
              </p>
              <p>
                Femmes : {c.approved_female}/{c.capacity_female} · Hommes :{" "}
                {c.approved_male}/{c.capacity_male}
              </p>
              <p className="text-sm">
                {c.pending_count} demande(s) en attente
                {c.approved_female >= c.capacity_female &&
                c.approved_male >= c.capacity_male
                  ? " · Complet"
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  className="course-button"
                  to={`/courses/${c.id}/registrations`}
                >
                  Inscriptions
                </Link>
                {!c.cancelled_at && new Date(c.starts_at).getTime() > now && (
                  <>
                    <Link
                      className="course-button"
                      to={`/courses/${c.id}/edit`}
                    >
                      Modifier
                    </Link>
                    <button
                      className="course-button"
                      disabled={busy}
                      onClick={() => remove(c)}
                    >
                      {c.has_registrations ? "Annuler le cours" : "Supprimer"}
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <CoursePager
        offset={offset}
        count={rows?.length ?? 0}
        onChange={(n) => {
          setOffset(n);
          setRows(null);
        }}
      />
    </CourseShell>
  );
}
