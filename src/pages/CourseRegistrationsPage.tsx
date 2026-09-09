import { useCourseClock } from "../hooks/useCourseClock";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useClub } from "../contexts/ClubContext";
import {
  courseError,
  formatCourseDate,
  readCourses,
  statusLabels,
  type Course,
  type CourseMember,
  type Registration,
  type RegistrationStatus,
} from "../lib/courses";
import { useCourseAdmin } from "../hooks/useCourseAdmin";
import {
  CourseError,
  CoursePager,
  CourseShell,
} from "../components/courses/CourseUI";
import MemberProfileEditor from "../components/courses/MemberProfileEditor";
import RegistrationHistory from "../components/courses/RegistrationHistory";
export default function CourseRegistrationsPage() {
  const now = useCourseClock();
  const { clubId } = useClub();
  const { id } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [rows, setRows] = useState<Registration[]>([]);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [members, setMembers] = useState<CourseMember[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [memberOffset, setMemberOffset] = useState(0);
  const [target, setTarget] = useState("");
  const [addStatus, setAddStatus] = useState<RegistrationStatus>("pending");
  const [history, setHistory] = useState<{
    userId: string;
    name: string;
  } | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Registration | null>(null);
  const [reason, setReason] = useState("");
  const [refresh, setRefresh] = useState(0);
  const { run, busy, error, setError } = useCourseAdmin(clubId);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  useEffect(() => {
    let ignore = false;
    if (clubId && id)
      Promise.all([
        readCourses<Course>(clubId, "courses", id),
        readCourses<Registration>(
          clubId,
          "registrations",
          id,
          "",
          offset,
          filter,
        ),
      ])
        .then(([courses, registrations]) => {
          if (!ignore) {
            if (!courses[0]) throw new Error("NOT_FOUND");
            setCourse(courses[0]);
            setRows(registrations);
          }
        })
        .catch((e) => {
          if (!ignore) setError(courseError(e));
        });
    return () => {
      ignore = true;
    };
  }, [clubId, id, offset, filter, refresh, setError]);
  useEffect(() => {
    let ignore = false;
    if (clubId)
      readCourses<CourseMember>(
        clubId,
        "members",
        undefined,
        query,
        memberOffset,
      )
        .then((data) => {
          if (!ignore) setMembers(data);
        })
        .catch((e) => {
          if (!ignore) setError(courseError(e));
        });
    return () => {
      ignore = true;
    };
  }, [clubId, query, memberOffset, refresh, setError]);
  async function status(
    r: Registration,
    next: RegistrationStatus,
    denialReason?: string,
  ) {
    if (
      await run("set_status", {
        id: r.id,
        revision: r.revision,
        status: next,
        ...(denialReason !== undefined ? { denial_reason: denialReason } : {}),
      })
    ) {
      setRefusal(null);
      setReason("");
      reload();
    }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (
      await run("add_registration", {
        course_id: id,
        user_id: target,
        status: addStatus,
      })
    ) {
      setTarget("");
      reload();
    }
  }
  const closed =
    !course ||
    !!course.cancelled_at ||
    new Date(course.starts_at).getTime() <= now;
  return (
    <CourseShell
      title={course ? `Inscriptions — ${course.name}` : "Inscriptions"}
    >
      <CourseError message={error} />
      <button className="course-button" onClick={reload}>
        Actualiser
      </button>
      {course && (
        <div className="course-panel space-y-2">
          <p>
            {formatCourseDate(course.starts_at)} · {course.coach_name}
          </p>
          <p>
            Femmes {course.approved_female}/{course.capacity_female} · Hommes{" "}
            {course.approved_male}/{course.capacity_male} ·{" "}
            {course.pending_count} en attente
          </p>
          {closed ? (
            <p>
              {course.cancelled_at ? "Cours annulé" : "Cours commencé"} —
              consultation de l’historique.
            </p>
          ) : (
            <Link className="text-primary" to={`/courses/${id}/edit`}>
              Modifier le cours
            </Link>
          )}
        </div>
      )}
      {clubId && profileId && (
        <MemberProfileEditor
          key={profileId}
          clubId={clubId}
          userId={profileId}
          onClose={() => setProfileId(null)}
          onSaved={reload}
        />
      )}
      {!closed && (
        <section className="course-panel space-y-3">
          <h2 className="text-xl font-semibold">Ajouter un membre</h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search);
              setMemberOffset(0);
              setTarget("");
            }}
          >
            <input
              className="course-field"
              aria-label="Rechercher un membre par nom"
              placeholder="Rechercher par nom"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="course-button">Rechercher</button>
          </form>
          <form className="flex flex-wrap gap-2" onSubmit={add}>
            <select
              required
              aria-label="Membre à inscrire"
              className="course-field"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choisir un membre…</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {`${m.prenom ?? ""} ${m.nom ?? ""}`.trim() ||
                    `Profil sans nom (${m.user_id.slice(0, 8)})`}
                  {m.complete ? "" : " — profil incomplet"}
                </option>
              ))}
            </select>
            <select
              className="course-button"
              aria-label="Statut initial"
              value={addStatus}
              onChange={(e) =>
                setAddStatus(e.target.value as RegistrationStatus)
              }
            >
              <option value="pending">En attente de validation</option>
              <option value="approved">Inscription confirmée</option>
            </select>
            <button
              className="course-primary"
              disabled={
                busy ||
                !target ||
                !members.find((m) => m.user_id === target)?.complete
              }
            >
              Ajouter
            </button>
            {target && (
              <button
                type="button"
                className="course-button"
                onClick={() => setProfileId(target)}
              >
                Modifier le profil
              </button>
            )}
          </form>
          <CoursePager
            offset={memberOffset}
            count={members.length}
            onChange={(n) => {
              setMemberOffset(n);
              setTarget("");
            }}
          />
          <p className="text-sm text-muted-foreground">
            Seules les inscriptions confirmées occupent une place. Aucun email
            ou push n’est envoyé.
          </p>
        </section>
      )}
      <label>
        Statut{" "}
        <select
          className="course-button"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">Tous</option>
          {Object.entries(statusLabels).map(([v, label]) => (
            <option value={v} key={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="space-y-3">
        {rows.length === 0 && <p>Aucune inscription.</p>}
        {rows.map((r) => (
          <article className="course-panel space-y-3" key={r.id}>
            <div className="flex flex-wrap justify-between gap-3">
              <h2 className="font-semibold">
                {r.prenom} {r.nom}
              </h2>
              <span>
                {statusLabels[r.status]} · quota{" "}
                {r.quota_sex === "female" ? "femmes" : "hommes"}
              </span>
            </div>
            <p className="text-sm">
              Demande du {formatCourseDate(r.requested_at)}
              {r.denial_reason ? ` · ${r.denial_reason}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="course-button"
                onClick={() =>
                  setHistory({
                    userId: r.user_id,
                    name: `${r.prenom} ${r.nom}`,
                  })
                }
              >
                Historique
              </button>
              {!closed && (
                <>
                  {(r.status === "pending" || r.status === "cancelled") && (
                    <button
                      className="course-primary"
                      disabled={busy}
                      onClick={() => status(r, "approved")}
                    >
                      Approuver
                    </button>
                  )}
                  {(r.status === "denied" || r.status === "cancelled") && (
                    <button
                      className="course-button"
                      disabled={busy}
                      onClick={() => status(r, "pending")}
                    >
                      Réexaminer
                    </button>
                  )}
                  {(r.status === "pending" || r.status === "approved") && (
                    <>
                      <button
                        className="course-button"
                        disabled={busy}
                        onClick={() => {
                          setRefusal(r);
                          setReason("");
                        }}
                      >
                        {r.status === "approved" ? "Révoquer" : "Refuser"}
                      </button>
                      <button
                        className="course-button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Annuler l’inscription de ce membre ?",
                            )
                          )
                            void status(r, "cancelled");
                        }}
                      >
                        Désinscrire
                      </button>
                    </>
                  )}
                  <button
                    className="course-button"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        window.confirm(
                          "Aligner le quota sur le sexe actuel du profil ? La capacité sera vérifiée.",
                        )
                      ) {
                        if (
                          await run("correct_quota", {
                            id: r.id,
                            revision: r.revision,
                          })
                        )
                          reload();
                      }
                    }}
                  >
                    Corriger le quota
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {refusal && (
        <form
          className="course-panel space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void status(refusal, "denied", reason);
          }}
        >
          <h2>
            Refuser la demande de {refusal.prenom} {refusal.nom}
          </h2>
          <label className="block">
            Motif facultatif (visible par le membre)
            <textarea
              className="course-field"
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button className="course-primary" disabled={busy}>
            Confirmer le refus
          </button>{" "}
          <button
            type="button"
            className="course-button"
            onClick={() => setRefusal(null)}
          >
            Retour
          </button>
        </form>
      )}
      <CoursePager offset={offset} count={rows.length} onChange={setOffset} />
      {clubId && history && (
        <RegistrationHistory
          key={history.userId}
          clubId={clubId}
          userId={history.userId}
          name={history.name}
          onClose={() => setHistory(null)}
        />
      )}
    </CourseShell>
  );
}
