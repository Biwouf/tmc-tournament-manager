import { TENNIS_RANKINGS } from '../../../shared/tennisRankings';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import { useCourseAction, useCourseContext } from '../hooks/useCourses';
import { courseError, type Profile, type Sex } from '../lib/courses';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { coursePushSupported, disableCoursePush } from '../lib/coursePush';
import { returnPath } from '../components/layout/headerConfig';
import CoursePushSettings from '../components/courses/CoursePushSettings';
import { LivePushSettings } from '../components/live/LivePush';
import '../components/courses/courses.css';

function ProfileForm({
  profile,
  clubId,
  onSaved,
}: {
  profile: Profile | null;
  clubId: string;
  onSaved: () => void;
}) {
  const [prenom, setPrenom] = useState(profile?.prenom ?? '');
  const [nom, setNom] = useState(profile?.nom ?? '');
  const [sex, setSex] = useState<Sex | ''>(profile?.sex ?? '');
  const [classement, setClassement] = useState(profile?.classement ?? '');
  const action = useCourseAction();
  const [revision, setRevision] = useState(profile?.revision ?? 0);
  return (
    <form
      className="booking-profile"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await action.run('course_save_my_profile', {
            p_club: clubId,
            p_prenom: prenom.trim(),
            p_nom: nom.trim(),
            p_sex: sex,
            p_classement: classement || null,
            p_revision: revision,
          })
        )
          onSaved();
      }}
    >
      <p>Renseignez votre prénom, nom et sexe pour demander une place.</p>
      <label>
        Prénom
        <input
          autoComplete="given-name"
          required
          maxLength={100}
          value={prenom}
          onChange={(e) => setPrenom(e.target.value)}
        />
      </label>
      <label>
        Nom
        <input
          autoComplete="family-name"
          required
          maxLength={100}
          value={nom}
          onChange={(e) => setNom(e.target.value)}
        />
      </label>
      <label>
        Sexe
        <select
          required
          value={sex}
          onChange={(e) => setSex(e.target.value as Sex)}
        >
          <option value="">Choisir…</option>
          <option value="female">Femme</option>
          <option value="male">Homme</option>
        </select>
      </label>
      <label>Classement (facultatif)<select value={classement} onChange={e => setClassement(e.target.value)}><option value="">Je ne sais pas / non classé·e</option>{TENNIS_RANKINGS.map(r => <option key={r}>{r}</option>)}</select></label>
      <p className="booking-note">
        Ces informations s’appliquent à tous vos clubs. Une modification du sexe
        ne change pas le quota de vos demandes existantes.
      </p>
      {action.error && (
        <div className="booking-error" role="alert">
          {action.error}
          <button
            type="button"
            className="booking-button secondary booking-wide"
            onClick={() => {
              setPrenom(profile?.prenom ?? '');
              setNom(profile?.nom ?? '');
              setSex(profile?.sex ?? '');
              setClassement(profile?.classement ?? '');
              setRevision(profile?.revision ?? 0);
            }}
          >
            Recharger le profil actuel
          </button>
        </div>
      )}
      <button
        className="booking-button primary booking-wide"
        disabled={action.busy || !prenom.trim() || !nom.trim() || !sex}
      >
        {action.busy ? 'Enregistrement…' : 'Enregistrer mon profil'}
      </button>
    </form>
  );
}
export default function ProfilePage() {
  const { clubId } = useClub();
  const context = useCourseContext();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const returnTo = returnPath(params.get('returnTo')) ?? '/actu';
  const backLabel = returnTo.startsWith('/cours') ? 'Revenir aux cours' : 'Retour';
  async function logout() {
    setLoggingOut(true);
    setLogoutError('');
    try {
      if (clubId) await disableCoursePush(clubId);
      // Leave the protected page first, otherwise RequireAuth redirects to /login.
      navigate(returnTo, { replace: true });
      await supabase.auth.signOut();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Déconnexion impossible. Réessayez.');
      setLoggingOut(false);
    }
  }
  return (
    <div className="booking-page">
      <h1 className="booking-profile-title">Mon profil</h1>
      {saved ? (
        <div className="booking-info success">
          <p role="status">Profil enregistré.</p>
          <button
            className="booking-button primary booking-wide"
            onClick={() => navigate(returnTo)}
          >
            {backLabel}
          </button>
        </div>
      ) : context.isError ? (
        <div className="booking-error" role="alert">
          {courseError(context.error)}
          <button
            className="booking-button secondary"
            onClick={() => void context.refetch()}
          >
            Actualiser
          </button>
        </div>
      ) : context.isPending ? (
        <p role="status">Chargement du profil…</p>
      ) : !context.data.is_member ? (
        <p className="booking-info">
          Votre compte doit être rattaché à ce club. Contactez un administrateur
          du club.
        </p>
      ) : (
        clubId && (
          <ProfileForm
            profile={context.data.profile}
            clubId={clubId}
            onSaved={() => setSaved(true)}
          />
        )
      )}
      {user && clubId && context.data?.is_member && (
        <section aria-labelledby="profile-notifications">
          <h2 id="profile-notifications" className="booking-profile-title">Notifications</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            <CoursePushSettings clubId={clubId} userId={user.id} />
            <LivePushSettings clubId={clubId} userId={user.id} />
          </ul>
          {!coursePushSupported() && (
            <p className="booking-note">Indisponible ici. Sur iPhone ou iPad, ajoutez l’application à l’écran d’accueil.</p>
          )}
        </section>
      )}
      <button
        className="booking-button secondary booking-wide"
        onClick={() => navigate(returnTo)}
      >
        {backLabel}
      </button>
      {logoutError && <p className="booking-error" role="alert">{logoutError}</p>}
      <button
        type="button"
        className="booking-button secondary booking-wide"
        disabled={loggingOut}
        onClick={() => void logout()}
      >
        {loggingOut ? 'Déconnexion…' : 'Se déconnecter'}
      </button>
    </div>
  );
}
