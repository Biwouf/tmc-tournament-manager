import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  courseDate,
  courseError,
  getCourseQueue,
  quotaLabel,
  type Course,
  type QueueRow,
} from '../../lib/courses';
import { useCourseAction, useCourseNow } from '../../hooks/useCourses';

export default function CourseQueue({
  clubId,
  course,
  onCancelled,
}: {
  clubId: string;
  course: Course;
  onCancelled: () => void;
}) {
  const [filter, setFilter] = useState<'pending' | 'treated'>('pending');
  const [offset, setOffset] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState('');
  const action = useCourseAction();
  const query = useQuery({
    queryKey: ['courses', clubId, 'queue', course.id, filter, offset],
    queryFn: () => getCourseQueue(clubId, course.id, offset, filter),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60000,
  });
  const now = useCourseNow(query.data);
  const canAct =
    !query.isError &&
    query.data?.can_act &&
    !course.cancelled_at &&
    now < Date.parse(course.starts_at);
  async function decide(r: QueueRow, status: 'approved' | 'denied') {
    if (status === 'denied' && !reason.trim()) return;
    if (
      await action.run('course_manage_command', {
        p_club: clubId,
        p_operation: 'set_status',
        p_data: {
          id: r.id,
          revision: r.revision,
          status,
          ...(status === 'denied' ? { denial_reason: reason.trim() } : {}),
        },
      })
    ) {
      setRefusal(null);
      setReason('');
      setMessage(
        status === 'approved' ? 'Place confirmée.' : 'Refus enregistré.',
      );
    }
  }
  return (
    <div className="booking-queue">
      <p className="booking-note">
        {course.name} · {courseDate(course.starts_at)}
      </p>
      <div className="booking-segments">
        <button
          aria-pressed={filter === 'pending'}
          onClick={() => {
            setFilter('pending');
            setOffset(0);
          }}
        >
          En attente
        </button>
        <button
          aria-pressed={filter === 'treated'}
          onClick={() => {
            setFilter('treated');
            setOffset(0);
          }}
        >
          Traitées
        </button>
      </div>
      <p role="status">{message}</p>
      {action.error && (
        <p className="booking-error" role="alert">
          {action.error}
        </p>
      )}
      {query.isError ? (
        <div className="booking-error" role="alert">
          {courseError(query.error)}
          <button
            className="booking-button secondary"
            onClick={() => void query.refetch()}
          >
            Actualiser
          </button>
        </div>
      ) : query.isPending ? (
        <p role="status">Chargement des demandes…</p>
      ) : (
        <>
          {!canAct && (
            <p className="booking-info">Ce cours est en lecture seule.</p>
          )}
          <p className="booking-note">
            {query.data.total} demande(s)
            {filter === 'pending' ? ' en attente' : ' traitée(s)'}
          </p>
          {query.data.items.length === 0 && (
            <p className="booking-empty">
              {filter === 'pending'
                ? 'Aucune demande en attente.'
                : 'Aucune demande traitée.'}
            </p>
          )}
          {query.data.items.map((r) => (
            <article key={r.id} className={`booking-request ${r.status}`}>
              <div className="booking-request-heading">
                <span className="booking-avatar" aria-hidden="true">
                  {r.prenom?.[0]}
                  {r.nom?.[0]}
                </span>
                <div>
                  <h3>
                    {`${r.prenom ?? ''} ${r.nom ?? ''}`.trim() || 'Membre'}
                  </h3>
                  <p>
                    {quotaLabel(r.quota_sex)} · {courseDate(r.requested_at)}
                  </p>
                </div>
              </div>
              {r.status === 'pending' && canAct ? (
                refusal === r.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void decide(r, 'denied');
                    }}
                  >
                    <label>
                      Motif du refus
                      <textarea
                        autoFocus
                        required
                        maxLength={1000}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Expliquez votre décision au membre…"
                      />
                    </label>
                    <p className="booking-note">
                      Ce motif sera visible par le membre.
                    </p>
                    <div className="booking-actions">
                      <button
                        type="button"
                        className="booking-button secondary"
                        disabled={action.busy}
                        onClick={() => setRefusal(null)}
                      >
                        Retour
                      </button>
                      <button
                        className="booking-button danger"
                        disabled={action.busy || !reason.trim()}
                      >
                        Envoyer le refus
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="booking-actions">
                    <button
                      className="booking-button success"
                      disabled={action.busy}
                      onClick={() => void decide(r, 'approved')}
                    >
                      Valider
                    </button>
                    <button
                      className="booking-button danger"
                      disabled={action.busy}
                      onClick={() => {
                        setRefusal(r.id);
                        setReason('');
                      }}
                    >
                      Refuser
                    </button>
                  </div>
                )
              ) : (
                <p className="booking-decision">
                  {r.status === 'approved'
                    ? '✓ Place confirmée'
                    : r.status === 'denied'
                      ? 'Demande refusée'
                      : r.status === 'cancelled'
                        ? 'Inscription annulée'
                        : 'En attente'}
                  {r.denial_reason && <span>{r.denial_reason}</span>}
                </p>
              )}
            </article>
          ))}
          {query.data.total > 50 && (
            <div className="booking-actions">
              <button
                className="booking-button secondary"
                disabled={offset === 0}
                onClick={() => setOffset(offset - 50)}
              >
                Précédentes
              </button>
              <button
                className="booking-button secondary"
                disabled={offset + 50 >= query.data.total}
                onClick={() => setOffset(offset + 50)}
              >
                Suivantes
              </button>
            </div>
          )}
        </>
      )}
      {canAct &&
        (confirmCancel ? (
          <div className="booking-error">
            <h3>Annuler ce cours ?</h3>
            <p>
              Toutes les demandes et inscriptions actives seront annulées. Les
              membres verront le statut dans la PWA.
            </p>
            <div className="booking-actions">
              <button
                className="booking-button secondary"
                disabled={action.busy}
                onClick={() => setConfirmCancel(false)}
              >
                Conserver le cours
              </button>
              <button
                className="booking-button danger"
                disabled={action.busy}
                onClick={async () => {
                  if (
                    await action.run('course_manage_command', {
                      p_club: clubId,
                      p_operation: 'cancel_course',
                      p_data: { id: course.id, revision: course.revision },
                    })
                  )
                    onCancelled();
                }}
              >
                Confirmer l’annulation
              </button>
            </div>
          </div>
        ) : (
          <button
            className="booking-button danger booking-wide"
            disabled={action.busy}
            onClick={() => setConfirmCancel(true)}
          >
            Annuler le cours
          </button>
        ))}
    </div>
  );
}
