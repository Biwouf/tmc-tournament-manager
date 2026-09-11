import {
  bookingOpen,
  courseDay,
  courseEnd,
  coursePhase,
  courseState,
  courseTime,
  type Course,
} from '../../lib/courses';
export default function CourseCard({
  course: c,
  now,
  onDetail,
  onRequest,
  onCancel,
  onManage,
}: {
  course: Course;
  now: number;
  onDetail: () => void;
  onRequest: () => void;
  onCancel: () => void;
  onManage: () => void;
}) {
  const state = courseState(c, now);
  const active =
    c.registration?.status === 'pending' ||
    c.registration?.status === 'approved';
  const phase = coursePhase(c, now);
  const confirmed = !c.cancelled_at && c.registration?.status === 'approved';
  return (
    <article
      className={`booking-card ${state.tone}`}
      aria-label={`${c.name}, ${courseDay(c.starts_at)}, ${courseTime(c.starts_at)}`}
    >
      {confirmed && (
        <div className="booking-confirmed">✓ Votre place est confirmée</div>
      )}
      <div className="booking-card-main">
        <div className={`booking-time ${c.cancelled_at ? 'cancelled' : ''}`}>
          <strong>{courseTime(c.starts_at)}</strong>
          <span>{courseTime(courseEnd(c))}</span>
        </div>
        <div className="booking-card-title">
          <p>{c.type_name}</p>
          <h3>{c.name}</h3>
          <span>Encadrant : {c.owner_first_name || 'À désigner'}</span>
        </div>
      </div>
      <div className="booking-card-footer">
        <div className="booking-badges">
          <span className={`booking-badge ${state.tone}`}>{state.label}</span>
          {phase && phase !== state.label && (
            <span className="booking-badge neutral">{phase}</span>
          )}
        </div>
        <p className="booking-quotas">
          Femmes {c.approved_female}/{c.capacity_female} · Hommes{' '}
          {c.approved_male}/{c.capacity_male}
        </p>
        <p className="booking-note">{state.note}</p>
        <div className="booking-actions">
          <button className="booking-button secondary" onClick={onDetail}>
            {c.registration?.denial_reason && c.registration.status === 'denied'
              ? 'Voir le motif'
              : 'Détails'}
          </button>
          {bookingOpen(c, now) &&
            (active ? (
              <button className="booking-button secondary" onClick={onCancel}>
                {c.registration?.status === 'approved'
                  ? 'Me désister'
                  : 'Annuler ma demande'}
              </button>
            ) : (
              c.registration?.status !== 'denied' && (
                <button className="booking-button primary" onClick={onRequest}>
                  Demander une place
                </button>
              )
            ))}
        </div>
        {c.can_manage && (
          <button className="booking-manage" onClick={onManage}>
            Gérer les demandes{c.pending_count ? ` · ${c.pending_count}` : ''}
            <span aria-hidden="true"> →</span>
          </button>
        )}
      </div>
    </article>
  );
}
