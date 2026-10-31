import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parisCandidates } from '../../../../shared/parisTime';
import {
  activeCourseTypes,
  courseAdminRead,
  courseError,
  memberName,
  type CourseMemberOption,
} from '../../lib/courses';
import { useCourseAction } from '../../hooks/useCourses';
import CourseSheet from './CourseSheet';

// Création admin depuis la PWA : même commande `save_course` que le formulaire du BO.
export default function CourseCreateSheet({
  clubId,
  onClose,
  onCreated,
}: {
  clubId: string;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const action = useCourseAction();
  const types = useQuery({
    queryKey: ['courses', clubId, 'admin-types'],
    queryFn: () => activeCourseTypes(clubId),
    staleTime: 0,
  });
  const [fields, setFields] = useState({
    name: '',
    type_id: '',
    local: '',
    duration_minutes: '60',
    capacity_female: '4',
    capacity_male: '4',
  });
  const [ambiguous, setAmbiguous] = useState('');
  const [owner, setOwner] = useState<CourseMemberOption | null>(null);
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<CourseMemberOption[]>([]);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState('');
  const [formError, setFormError] = useState('');
  const update = (key: keyof typeof fields, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));
  const query = search.trim();
  // Autocomplétion seulement : aucune liste tant que rien n'est saisi.
  const searching = query.length >= 2;
  useEffect(() => {
    if (owner || !searching) return;
    let current = true;
    const timer = setTimeout(() => {
      void courseAdminRead<CourseMemberOption>(clubId, 'members', query)
        .then((rows) => {
          if (!current) return;
          setMembers(rows.slice(0, 6));
          setSearched(query);
          setSearchError('');
        })
        .catch((e) => {
          if (current) setSearchError(courseError(e));
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [clubId, query, owner, searching]);
  const candidates = parisCandidates(fields.local);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!owner) {
      setFormError('Choisissez un responsable membre de ce club.');
      return;
    }
    const date =
      candidates.length === 1
        ? candidates[0]
        : candidates.find((c) => c === ambiguous);
    if (!date) {
      setFormError(
        candidates.length
          ? 'Choisissez le décalage horaire pour cette heure ambiguë.'
          : 'Cette heure est invalide ou inexistante en Europe/Paris.',
      );
      return;
    }
    const ok = await action.run('course_admin_command', {
      p_club: clubId,
      p_operation: 'save_course',
      p_data: {
        name: fields.name,
        type_id: fields.type_id,
        owner_id: owner.user_id,
        starts_at: date,
        duration_minutes: Number(fields.duration_minutes),
        capacity_female: Number(fields.capacity_female),
        capacity_male: Number(fields.capacity_male),
      },
    });
    if (ok) onCreated(`Cours « ${fields.name} » créé et publié.`);
  }
  const error = formError || action.error;
  return (
    <CourseSheet title="Créer un cours" onClose={onClose} busy={action.busy}>
      {types.isPending ? (
        <p role="status">Chargement…</p>
      ) : types.isError ? (
        <p className="booking-error" role="alert">
          {courseError(types.error)}
        </p>
      ) : types.data.length === 0 ? (
        <p className="booking-info">
          Aucun type de cours actif. Créez-en un depuis le back-office avant
          de créer un cours.
        </p>
      ) : (
        <form className="booking-profile booking-create" onSubmit={submit}>
          <label>
            Nom du cours
            <input
              required
              maxLength={120}
              value={fields.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </label>
          <label>
            Type
            <select
              required
              value={fields.type_id}
              onChange={(e) => update('type_id', e.target.value)}
            >
              <option value="">Choisir…</option>
              {types.data.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="booking-create-owner">
            <legend>Responsable du cours</legend>
            {owner ? (
              <div className="booking-create-selected">
                <span>{memberName(owner)}</span>
                <button
                  type="button"
                  className="booking-button secondary"
                  onClick={() => {
                    setOwner(null);
                    setSearch('');
                  }}
                >
                  Changer
                </button>
              </div>
            ) : (
              <>
                <input
                  type="search"
                  aria-label="Rechercher un responsable"
                  placeholder="Tapez au moins 2 lettres du nom"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {searching && searchError && (
                  <p className="booking-error" role="alert">
                    {searchError}
                  </p>
                )}
                {searching && searched === query && members.length === 0 && !searchError && (
                  <p className="booking-note">
                    Aucun membre trouvé. Le responsable doit avoir un compte
                    rattaché au club.
                  </p>
                )}
                <ul className="booking-create-members">
                  {(searching ? members : []).map((m) => (
                    <li key={m.user_id}>
                      <button type="button" onClick={() => setOwner(m)}>
                        {memberName(m)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </fieldset>
          <label>
            Date et heure
            <input
              type="datetime-local"
              required
              value={fields.local}
              onChange={(e) => {
                update('local', e.target.value);
                setAmbiguous('');
              }}
            />
          </label>
          {candidates.length === 2 && (
            <label>
              Heure d’hiver : préciser le décalage
              <select
                required
                value={ambiguous}
                onChange={(e) => setAmbiguous(e.target.value)}
              >
                <option value="">Choisir…</option>
                {candidates.map((c, i) => (
                  <option key={c} value={c}>
                    UTC+{i === 0 ? '2 (été)' : '1 (hiver)'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Durée (minutes)
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              required
              value={fields.duration_minutes}
              onChange={(e) => update('duration_minutes', e.target.value)}
            />
          </label>
          <div className="booking-create-quotas">
            <label>
              Places femmes
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={1000}
                required
                value={fields.capacity_female}
                onChange={(e) => update('capacity_female', e.target.value)}
              />
            </label>
            <label>
              Places hommes
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={1000}
                required
                value={fields.capacity_male}
                onChange={(e) => update('capacity_male', e.target.value)}
              />
            </label>
          </div>
          <p className="booking-note">
            Le cours est publié dès sa création. Aucun email ou push n’est
            envoyé.
          </p>
          {error && (
            <p className="booking-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="booking-button primary booking-wide"
            disabled={action.busy}
          >
            {action.busy ? 'Création…' : 'Créer le cours'}
          </button>
        </form>
      )}
    </CourseSheet>
  );
}
