import { Fragment, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useClub } from '../contexts/ClubContext';
import { useAuth } from '../hooks/useAuth';
import { useHeaderAction } from '../components/layout/HeaderActionContext';
import { supabase } from '../lib/supabase';
import {
  courseDay,
  courseError,
  getCoursePage,
  profileComplete,
  type CourseView,
} from '../lib/courses';
import {
  useCourseAction,
  useCourseContext,
  useCourseNow,
} from '../hooks/useCourses';
import CourseCard from '../components/courses/CourseCard';
import CourseInteraction, {
  type SheetMode,
} from '../components/courses/CourseInteraction';
import CourseSheet from '../components/courses/CourseSheet';
import '../components/courses/courses.css';

export default function CoursesPage() {
  const { clubId } = useClub();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedView = params.get('view');
  const view: CourseView =
    user && (requestedView === 'mine' || requestedView === 'manage')
      ? requestedView
      : 'all';
  const offset = Math.max(0, Math.floor(Number(params.get('page')) || 0)) * 20;
  const selected = params.get('course');
  const [mode, setMode] = useState<SheetMode>('detail');
  const [toast, setToast] = useState('');
  const context = useCourseContext();
  const action = useCourseAction();
  const page = useQuery({
    queryKey: ['courses', clubId, user?.id, 'page', view, offset],
    enabled: !!clubId,
    queryFn: () => getCoursePage(clubId!, !!user, view, offset),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60000,
  });
  const detail = useQuery({
    queryKey: ['courses', clubId, user?.id, 'detail', selected],
    enabled: !!clubId && !!selected,
    queryFn: () => getCoursePage(clubId!, !!user, 'all', 0, selected!),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60000,
  });
  const now = useCourseNow(selected && detail.data ? detail.data : page.data);
  useHeaderAction({
    kind: 'text',
    label: user ? 'Déconnexion' : 'Connexion',
    onClick: () => {
      if (user) void supabase.auth.signOut();
      else navigate('/login', { state: { from: `/cours${window.location.search}` } });
    },
  });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  const changeView = (next: CourseView) => {
    if (!user && next !== 'all') {
      navigate('/login', { state: { from: '/cours?view=mine' } });
      return;
    }
    setParams(next === 'all' ? {} : { view: next });
  };
  const open = (id: string, next: SheetMode) => {
    setMode(next);
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('course', id);
      return p;
    });
  };
  const close = () => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete('course');
      return p;
    });
    setMode('detail');
  };
  const course = detail.data?.items[0];
  return (
    <div className="booking-page">
      <div className="booking-tabs">
        <div className="booking-segments">
          <button
            aria-pressed={view === 'all'}
            onClick={() => changeView('all')}
          >
            Tous les cours
          </button>
          <button
            aria-pressed={view === 'mine'}
            onClick={() => changeView('mine')}
          >
            Mes cours{context.data ? ` (${context.data.mine_count})` : ''}
          </button>
        </div>
        {context.data?.can_manage && (
          <button
            className={`booking-management-tab ${view === 'manage' ? 'active' : ''}`}
            aria-pressed={view === 'manage'}
            onClick={() => changeView(view === 'manage' ? 'all' : 'manage')}
          >
            Encadrement
            {context.data.attention_count > 0 && (
              <span>{context.data.attention_count} en attente</span>
            )}
          </button>
        )}
      </div>
      <p className="booking-info">
        Tous les cours sont gratuits. Une demande ne réserve pas de place : le
        club la valide.
      </p>
      {user &&
        context.data?.is_member &&
        !profileComplete(context.data.profile) && (
          <div className="booking-info warning">
            <p>Renseignez votre prénom, nom et sexe pour demander une place.</p>
            <button
              className="booking-button secondary"
              onClick={() => navigate('/profil?returnTo=%2Fcours')}
            >
              Compléter mon profil
            </button>
          </div>
        )}
      <div className="booking-list-heading">
        <h2>
          {view === 'mine'
            ? 'Mes cours'
            : view === 'manage'
              ? 'Mes créneaux à encadrer'
              : 'Les cours du club'}
        </h2>
        <button
          onClick={() => void action.refresh()}
          aria-label="Actualiser les cours"
          className="booking-refresh"
          disabled={page.isFetching}
        >
          ↻
        </button>
      </div>
      {context.isError && (
        <p className="booking-error" role="alert">
          Votre profil n’a pas pu être chargé. {courseError(context.error)}
        </p>
      )}
      {page.isError ? (
        <p className="booking-error" role="alert">
          {courseError(page.error)}
        </p>
      ) : page.isPending ? (
        <div className="booking-empty" role="status">
          Chargement des cours…
        </div>
      ) : (
        <>
          {page.data.items.length === 0 && (
            <div className="booking-empty">
              <strong>
                {view === 'mine'
                  ? 'Aucune inscription à venir'
                  : view === 'manage'
                    ? 'Aucun cours à encadrer'
                    : 'Aucun cours pour le moment'}
              </strong>
              <p>
                {view === 'mine'
                  ? 'Retrouvez les cours disponibles dans Tous les cours.'
                  : 'Les prochains cours apparaîtront ici.'}
              </p>
            </div>
          )}
          {page.data.items.map((c, index, list) => (
            <Fragment key={c.id}>
              {(index === 0 ||
                courseDay(c.starts_at) !==
                  courseDay(list[index - 1].starts_at)) && (
                <h2 className="booking-day">{courseDay(c.starts_at)}</h2>
              )}
              <CourseCard
                course={c}
                now={now}
                onDetail={() => open(c.id, 'detail')}
                onRequest={() => open(c.id, 'request')}
                onCancel={() => open(c.id, 'cancel')}
                onManage={() => open(c.id, 'manage')}
              />
            </Fragment>
          ))}
          {page.data.total > 20 && (
            <div className="booking-actions">
              <button
                className="booking-button secondary"
                disabled={!offset}
                onClick={() =>
                  setParams({ view, page: String(offset / 20 - 1) })
                }
              >
                Précédents
              </button>
              <span className="booking-note">
                {offset / 20 + 1}/{Math.ceil(page.data.total / 20)}
              </span>
              <button
                className="booking-button secondary"
                disabled={offset + 20 >= page.data.total}
                onClick={() =>
                  setParams({ view, page: String(offset / 20 + 1) })
                }
              >
                Suivants
              </button>
            </div>
          )}
        </>
      )}
      {selected &&
        (course && clubId && !detail.isError ? (
          <CourseInteraction
            key={`${course.id}:${user?.id ?? 'anon'}`}
            course={course}
            clubId={clubId}
            authenticated={!!user}
            context={context.data}
            contextError={
              context.isError
                ? 'Votre profil n’a pas pu être chargé. Réessayez pour demander une place.'
                : undefined
            }
            now={now}
            mode={mode}
            setMode={setMode}
            onClose={close}
            onSuccess={(message) => {
              close();
              setToast(message);
            }}
          />
        ) : (
          <CourseSheet title="Cours" onClose={close}>
            <p role={detail.isError ? 'alert' : 'status'}>
              {detail.isError
                ? courseError(detail.error)
                : detail.isPending
                  ? 'Chargement…'
                  : 'Ce cours n’est plus visible.'}
            </p>
            <button
              className="booking-button secondary booking-wide"
              onClick={close}
            >
              Fermer
            </button>
          </CourseSheet>
        ))}
      {toast && (
        <div className="booking-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
