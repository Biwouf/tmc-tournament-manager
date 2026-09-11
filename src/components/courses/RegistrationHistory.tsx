import { useEffect, useState } from "react";
import {
  courseError,
  formatCourseDate,
  readCourses,
  statusLabels,
  type Registration,
  type RegistrationEvent,
} from "../../lib/courses";
import { CourseError, CoursePager } from "./CourseUI";
export default function RegistrationHistory({
  clubId,
  userId,
  name,
  onClose,
}: {
  clubId: string;
  userId: string;
  name: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Registration[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<RegistrationEvent[]>([]);
  const [eventOffset, setEventOffset] = useState(0);
  useEffect(() => {
    let ignore = false;
    readCourses<Registration>(clubId, "history", userId, "", offset)
      .then((data) => {
        if (!ignore) setRows(data);
      })
      .catch((e) => {
        if (!ignore) setError(courseError(e));
      });
    return () => {
      ignore = true;
    };
  }, [clubId, userId, offset]);
  useEffect(() => {
    let ignore = false;
    if (selected)
      readCourses<RegistrationEvent>(
        clubId,
        "events",
        selected,
        "",
        eventOffset,
      )
        .then((data) => {
          if (!ignore) setEvents(data);
        })
        .catch((e) => {
          if (!ignore) setError(courseError(e));
        });
    return () => {
      ignore = true;
    };
  }, [clubId, selected, eventOffset]);
  return (
    <aside className="course-panel space-y-4" aria-label="Historique du membre">
      <div className="flex justify-between gap-3">
        <h2 className="text-xl font-semibold">Historique — {name}</h2>
        <button className="course-button" onClick={onClose}>
          Fermer
        </button>
      </div>
      <CourseError message={error} />
      <p className="text-sm">Inscriptions dans ce club uniquement.</p>
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap justify-between gap-2 border-b py-2"
        >
          <span>
            {r.course_name} · {r.starts_at && formatCourseDate(r.starts_at)} ·{" "}
            {statusLabels[r.status]}
          </span>
          <button
            className="course-button"
            onClick={() => {
              setSelected(r.id);
              setEvents([]);
              setEventOffset(0);
            }}
          >
            Voir les changements
          </button>
        </div>
      ))}
      {!rows.length && <p>Aucun historique.</p>}
      <CoursePager offset={offset} count={rows.length} onChange={setOffset} />
      {selected && (
        <div className="space-y-2 rounded-lg bg-muted p-3">
          <h3 className="font-semibold">Changements</h3>
          {events.map((e) => (
            <p key={e.id} className="text-sm">
              {formatCourseDate(e.occurred_at)} ·{" "}
              {e.from_status ? statusLabels[e.from_status] : "Création"} →{" "}
              {statusLabels[e.to_status]} ·{" "}
              {e.quota_sex === "female" ? "Femmes" : "Hommes"}
              {e.source === "quota_correction"
                ? " · Correction du quota"
                : e.source === "membership_removed"
                  ? " · Retrait du club"
                  : e.source === "course_cancelled"
                    ? " · Cours annulé"
                    : ""}
              {e.denial_reason ? ` · ${e.denial_reason}` : ""}
            </p>
          ))}
          <CoursePager
            offset={eventOffset}
            count={events.length}
            onChange={setEventOffset}
          />
        </div>
      )}
    </aside>
  );
}
