import { Link } from 'react-router-dom';
import {
  bookingOpen,
  courseDate,
  courseEnd,
  courseImage,
  courseState,
  profileComplete,
  type Course,
  type CourseContext,
} from '../../lib/courses';
import { useCourseAction } from '../../hooks/useCourses';
import CourseSheet from './CourseSheet';
import CourseQueue from './CourseQueue';
export type SheetMode = 'detail' | 'request' | 'cancel' | 'manage';
export default function CourseInteraction({
  course: c,
  clubId,
  authenticated,
  context,
  contextError,
  now,
  mode,
  setMode,
  onClose,
  onSuccess,
}: {
  course: Course;
  clubId: string;
  authenticated: boolean;
  context?: CourseContext;
  contextError?: string;
  now: number;
  mode: SheetMode;
  setMode: (mode: SheetMode) => void;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const action = useCourseAction();
  const from = `/cours?course=${encodeURIComponent(c.id)}`;
  const image = courseImage(c.image_path);
  const state = courseState(c, now);
  async function submit(operation: 'request' | 'cancel') {
    if (
      await action.run('course_member_command', {
        p_club: clubId,
        p_course: c.id,
        p_operation: operation,
        p_revision: c.registration?.revision ?? null,
      })
    )
      onSuccess(
        operation === 'request'
          ? 'Demande envoyée. Votre place sera confirmée après validation par le club.'
          : 'Votre inscription est annulée.',
      );
  }
  return (
    <CourseSheet
      title={
        mode === 'manage'
          ? 'Gérer les demandes'
          : mode === 'cancel'
            ? 'Annuler mon inscription ?'
            : mode === 'request'
              ? 'Demander une place'
              : c.name
      }
      onClose={onClose}
      busy={action.busy}
    >
      {mode === 'manage' ? (
        c.can_manage ? (
          <CourseQueue
            clubId={clubId}
            course={c}
            onCancelled={() => onSuccess('Le cours a été annulé.')}
          />
        ) : (
          <p className="booking-error">Vous ne gérez plus ce cours.</p>
        )
      ) : (
        <>
          {mode === 'detail' ? (
            <>
              {image && (
                <img
                  className="booking-type-image"
                  src={image}
                  alt={c.type_name}
                />
              )}
              <dl className="booking-detail">
                <div>
                  <dt>Créneau</dt>
                  <dd>
                    {courseDate(c.starts_at)} –{' '}
                    {new Intl.DateTimeFormat('fr-FR', {
                      timeZone: 'Europe/Paris',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(courseEnd(c))}
                  </dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{c.type_name}</dd>
                </div>
                <div>
                  <dt>Encadrant</dt>
                  <dd>{c.owner_first_name || 'À désigner'}</dd>
                </div>
                <div>
                  <dt>Durée</dt>
                  <dd>{c.duration_minutes} minutes</dd>
                </div>
                <div>
                  <dt>Places</dt>
                  <dd>
                    Femmes {c.approved_female}/{c.capacity_female}
                    <br />
                    Hommes {c.approved_male}/{c.capacity_male}
                  </dd>
                </div>
                <div>
                  <dt>Clôture</dt>
                  <dd>{courseDate(Date.parse(c.starts_at) - 4 * 3600000)}</dd>
                </div>
              </dl>
              <p className="booking-note">
                Horaires Europe/Paris · Cours gratuit
              </p>
              <div className={`booking-info ${state.tone}`}>
                <strong>{state.label}</strong>
                <p>{state.note}</p>
                {c.registration?.status === 'denied' &&
                  c.registration.denial_reason && (
                    <p className="booking-reason">
                      {c.registration.denial_reason}
                    </p>
                  )}
              </div>
              {bookingOpen(c, now) &&
                (!c.registration || c.registration.status === 'cancelled') && (
                  <button
                    className="booking-button primary booking-wide"
                    onClick={() => setMode('request')}
                  >
                    Demander une place
                  </button>
                )}
            </>
          ) : (
            <>
              <p className="booking-summary">
                <strong>{c.name}</strong>
                <br />
                {courseDate(c.starts_at)} · {c.duration_minutes} min
              </p>
              {!bookingOpen(c, now) ? (
                <p className="booking-info">
                  Les demandes et désistements sont fermés pour ce cours.
                </p>
              ) : !authenticated ? (
                <>
                  <p className="booking-info">
                    Connectez-vous avec votre compte membre du club pour
                    demander une place.
                  </p>
                  <Link
                    className="booking-button primary booking-wide"
                    to="/login"
                    state={{ from }}
                  >
                    Se connecter
                  </Link>
                </>
              ) : contextError ? (
                <div className="booking-error" role="alert">
                  {contextError}
                  <button
                    className="booking-button secondary booking-wide"
                    onClick={() => void action.refresh()}
                  >
                    Actualiser mon profil
                  </button>
                </div>
              ) : !context ? (
                <p role="status">Chargement de votre profil…</p>
              ) : !context.is_member ? (
                <p className="booking-info">
                  Votre compte n’est pas rattaché à ce club. Contactez un
                  administrateur du club.
                </p>
              ) : !profileComplete(context.profile) && mode === 'request' ? (
                <>
                  <p className="booking-info">
                    Renseignez votre prénom, nom et sexe pour demander une
                    place.
                  </p>
                  <Link
                    className="booking-button primary booking-wide"
                    to={`/profil?returnTo=${encodeURIComponent(from)}`}
                  >
                    Compléter mon profil
                  </Link>
                </>
              ) : (
                <>
                  <p className="booking-info">
                    {mode === 'cancel'
                      ? 'Votre place ou votre demande sera annulée. Vous pourrez refaire une demande avant la clôture, sans garantie de place.'
                      : 'Cours gratuit. Une demande ne réserve pas de place, même si le quota est plein. Consultez votre statut ici après la décision du club.'}
                  </p>
                  {action.error && (
                    <p className="booking-error" role="alert">
                      {action.error}
                    </p>
                  )}
                  <button
                    className={`booking-button ${mode === 'cancel' ? 'danger' : 'primary'} booking-wide`}
                    disabled={action.busy}
                    onClick={() =>
                      void submit(mode === 'cancel' ? 'cancel' : 'request')
                    }
                  >
                    {action.busy
                      ? 'Enregistrement…'
                      : mode === 'cancel'
                        ? 'Confirmer mon désistement'
                        : 'Envoyer ma demande'}
                  </button>
                </>
              )}
            </>
          )}
          <button
            className="booking-button secondary booking-wide"
            disabled={action.busy}
            onClick={onClose}
          >
            Fermer
          </button>
        </>
      )}
    </CourseSheet>
  );
}
