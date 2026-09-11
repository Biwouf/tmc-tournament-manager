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
import MemberAutocomplete from "../components/courses/MemberAutocomplete";
import MemberProfileEditor from "../components/courses/MemberProfileEditor";
import RegistrationHistory from "../components/courses/RegistrationHistory";
export default function CourseRegistrationsPage() {
  const now = useCourseClock();
  const { clubId } = useClub();
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState<Course | null>(null);
  const [rows, setRows] = useState<Registration[]>([]);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [selectedMember, setSelectedMember] = useState<CourseMember | null>(
    null,
  );
  const [notice, setNotice] = useState("");
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
  const reload = useCallback(() => {
    setLoading(true);
    setRefresh((n) => n + 1);
  }, []);
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
            setLoading(false);
          }
        })
        .catch((e) => {
          if (!ignore) {
            setError(courseError(e));
            setLoading(false);
          }
        });
    return () => {
      ignore = true;
    };
  }, [clubId, id, offset, filter, refresh, setError]);
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
      setNotice(
        next === "approved"
          ? "Inscription confirmée."
          : next === "denied"
            ? "Refus enregistré."
            : "Inscription mise à jour.",
      );
      setRefusal(null);
      setReason("");
      reload();
    }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMember?.complete) return;
    if (
      await run("add_registration", {
        course_id: id,
        user_id: selectedMember.user_id,
        status: addStatus,
      })
    ) {
      setSelectedMember(null);
      setNotice("Membre ajouté au cours.");
      reload();
    }
  }
  const closed =
    !course ||
    !!course.cancelled_at ||
    new Date(course.starts_at).getTime() <= now;
  return (
    <CourseShell title="Inscriptions">
      <CourseError message={refusal ? null : error} />
      {notice && (
        <p role="status" className="registration-notice">
          ✓ {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/courses" className="course-back">
          ← Retour aux cours
        </Link>
        <button className="course-button" onClick={reload}>
          Actualiser
        </button>
      </div>
      {course && (
        <section className="course-panel registration-summary">
          <div>
            <span className="registration-eyebrow">{course.type_name}</span>
            <h2>{course.name}</h2>
            <p>
              {formatCourseDate(course.starts_at)} · {course.duration_minutes}{" "}
              min
            </p>
            <p>Responsable : {course.owner_first_name || "À désigner"}</p>
            {closed ? (
              <p className="registration-readonly">
                {course.cancelled_at ? "Cours annulé" : "Cours commencé"} ·
                Consultation uniquement
              </p>
            ) : (
              <Link className="course-button mt-4" to={`/courses/${id}/edit`}>
                Modifier le cours
              </Link>
            )}
          </div>
          <div className="registration-metrics">
            <div>
              <span>Femmes</span>
              <strong>
                {course.approved_female}
                <small> / {course.capacity_female}</small>
              </strong>
              <progress
                aria-label="Places confirmées femmes"
                value={course.approved_female}
                max={course.capacity_female || 1}
              />
            </div>
            <div>
              <span>Hommes</span>
              <strong>
                {course.approved_male}
                <small> / {course.capacity_male}</small>
              </strong>
              <progress
                aria-label="Places confirmées hommes"
                value={course.approved_male}
                max={course.capacity_male || 1}
              />
            </div>
            <div className="pending">
              <span>À valider</span>
              <strong>{course.pending_count}</strong>
              <small>demande(s) en attente</small>
            </div>
          </div>
        </section>
      )}
      {clubId && profileId && (
        <MemberProfileEditor
          key={profileId}
          clubId={clubId}
          userId={profileId}
          onClose={() => setProfileId(null)}
          onSaved={async () => {
            reload();
            if (selectedMember?.user_id === profileId) {
              try {
                const members = await readCourses<CourseMember>(
                  clubId,
                  "members",
                  profileId,
                );
                setSelectedMember((current) =>
                  current?.user_id === profileId
                    ? (members[0] ?? null)
                    : current,
                );
              } catch (e) {
                setSelectedMember(null);
                setError(courseError(e));
              }
            }
          }}
        />
      )}
      {!closed && clubId && (
        <details className="course-panel registration-add" open>
          <summary>
            <span>
              Ajouter un membre au cours
              <small>Inscription manuelle par un administrateur</small>
            </span>
            <span aria-hidden="true">＋</span>
          </summary>
          <form className="registration-add-form" onSubmit={add}>
            <MemberAutocomplete
              clubId={clubId}
              value={selectedMember}
              onChange={setSelectedMember}
              disabled={busy}
            />
            <label>
              Statut initial
              <select
                className="course-field"
                aria-label="Statut initial"
                value={addStatus}
                disabled={busy}
                onChange={(e) =>
                  setAddStatus(e.target.value as RegistrationStatus)
                }
              >
                <option value="pending">En attente de validation</option>
                <option value="approved">Inscription confirmée</option>
              </select>
            </label>
            <button
              className="course-primary"
              disabled={busy || !selectedMember?.complete}
            >
              Ajouter
            </button>
            {selectedMember && (
              <div className="registration-selected">
                <p>
                  {selectedMember.complete
                    ? "Ce membre peut être inscrit."
                    : "Complétez le prénom, le nom et le sexe de ce membre avant de l’inscrire."}
                </p>
                <button
                  type="button"
                  className="course-button"
                  disabled={busy}
                  onClick={() => setProfileId(selectedMember.user_id)}
                >
                  Modifier le profil
                </button>
              </div>
            )}
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Seules les inscriptions confirmées occupent une place. Le membre
            consulte son statut dans la PWA.
          </p>
        </details>
      )}
      <section className="registration-list-heading">
        <div>
          <h2>Demandes et inscriptions</h2>
          <p>Validez une place ou indiquez au membre le motif du refus.</p>
        </div>
        <div
          className="registration-filters"
          role="group"
          aria-label="Filtrer les inscriptions"
        >
          {[
            ["", "Toutes"],
            ["pending", "En attente"],
            ["approved", "Confirmées"],
            ["denied", "Refusées"],
            ["cancelled", "Annulées"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => {
                if (value === filter && offset === 0) return;
                setLoading(true);
                setFilter(value);
                setOffset(0);
                setRefusal(null);
              }}
            >
              {label}
              {value === "pending" && course
                ? ` (${course.pending_count})`
                : ""}
            </button>
          ))}
        </div>
      </section>
      <div className="space-y-3">
        {!loading && rows.length === 0 && (
          <div className="registration-empty">
            <strong>
              Aucune inscription
              {filter ? " dans cette catégorie" : " pour le moment"}.
            </strong>
            <p>Les demandes des membres apparaîtront ici.</p>
          </div>
        )}
        {loading && (
          <p role="status" className="registration-empty">
            Chargement des inscriptions…
          </p>
        )}
        {!loading &&
          rows.map((r) => (
            <article
              className={`course-panel registration-row ${r.status}`}
              key={r.id}
            >
              <div className="registration-row-heading">
                <span className="registration-avatar" aria-hidden="true">
                  {r.prenom?.[0]}
                  {r.nom?.[0]}
                </span>
                <div className="registration-identity">
                  <h3>
                    {r.prenom} {r.nom}
                  </h3>
                  <p>
                    Quota {r.quota_sex === "female" ? "femmes" : "hommes"} ·
                    Demande du {formatCourseDate(r.requested_at)}
                  </p>
                </div>
                <span className={`registration-badge ${r.status}`}>
                  {statusLabels[r.status]}
                </span>
              </div>
              {r.denial_reason && (
                <div className="registration-reason">
                  <strong>Motif du refus</strong>
                  <p>{r.denial_reason}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {!closed && (
                  <>
                    {(r.status === "pending" || r.status === "cancelled") && (
                      <button
                        className="course-primary registration-approve-button"
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
                          className="course-button registration-refuse-button"
                          disabled={busy}
                          onClick={() => {
                            setRefusal(r);
                            setReason("");
                          }}
                        >
                          {r.status === "approved" ? "Révoquer" : "Refuser"}
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
              {!closed && refusal?.id === r.id && (
                <form
                  className="registration-refusal space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (reason.trim())
                      void status(refusal, "denied", reason.trim());
                  }}
                >
                  <CourseError message={error} />
                  <h2>
                    Refuser la demande de {refusal.prenom} {refusal.nom}
                  </h2>
                  <label className="block">
                    Motif obligatoire (visible par le membre)
                    <textarea
                      className="course-field"
                      autoFocus
                      rows={3}
                      placeholder="Expliquez votre décision au membre…"
                      maxLength={1000}
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button
                    className="course-primary"
                    disabled={busy || !reason.trim()}
                  >
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
              <details className="registration-secondary">
                <summary>Historique et autres actions</summary>
                <div className="flex flex-wrap gap-2">
                  {" "}
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
                      {(r.status === "pending" || r.status === "approved") && (
                        <>
                          {" "}
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
                      )}{" "}
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
              </details>
            </article>
          ))}
      </div>
      <CoursePager
        offset={offset}
        count={rows.length}
        onChange={(value) => {
          setLoading(true);
          setOffset(value);
          setRefusal(null);
        }}
      />
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
