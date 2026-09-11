import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import { useCourseAction, useCourseContext } from '../hooks/useCourses';
import { courseError, type Profile, type Sex } from '../lib/courses';
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
  const [saved, setSaved] = useState(false);
  const requested = params.get('returnTo');
  const returnTo =
    requested && /^\/cours(?:\?|$)/.test(requested) ? requested : '/cours';
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
            Revenir aux cours
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
      <button
        className="booking-button secondary booking-wide"
        onClick={() => navigate(returnTo)}
      >
        Retour aux cours
      </button>
    </div>
  );
}
