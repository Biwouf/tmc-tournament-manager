import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import PasswordInput from '../components/PasswordInput';
import { useClub } from '../contexts/ClubContext';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { signupError, signupReturnTo, validateSignup, TENNIS_RANKINGS, type SignupFields } from '../lib/signup';

const inputClass = 'min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';
const buttonClass = 'w-full rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60';
const labelClass = 'mb-1.5 block text-sm font-medium';
export default function SignupPage({ confirmed = false }: { confirmed?: boolean }) {
  const { clubId } = useClub();
  const { user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [fields, setFields] = useState<SignupFields>({ prenom: '', nom: '', email: '', sex: '', classement: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const created = useRef(false);
  const change = (key: keyof SignupFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFields(f => ({ ...f, [key]: e.target.value }));
  const returnTo = signupReturnTo(params.get('returnTo'));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const invalid = validateSignup(fields);
    if (invalid) { setError(invalid); return; }
    if (!clubId) { setError('Club indisponible.'); return; }
    busy.current = true; setLoading(true); setError(null);
    const profile = { club_id: clubId, prenom: fields.prenom.trim(), nom: fields.nom.trim(), sex: fields.sex, classement: fields.classement || null };
    try {
      if (!created.current) {
        const { data, error } = await supabase.auth.signUp({ email: fields.email.trim(), password: fields.password,
          options: { emailRedirectTo: `${window.location.origin}/inscription/confirmee?returnTo=${encodeURIComponent(returnTo)}`, data: { club_signup: profile } } });
        if (error) throw error;
        if (data.user?.identities?.length === 0) throw { code: 'user_already_exists' };
        if (!data.session) { setSent(true); setFields(f => ({ ...f, password: '', confirm: '' })); return; }
        created.current = true;
      }
      const { error } = await supabase.rpc('course_signup_my_profile', { p_club: clubId, p_prenom: profile.prenom, p_nom: profile.nom, p_sex: profile.sex, p_classement: profile.classement, p_request_id: requestId.current });
      if (error) throw error;
      await cache.invalidateQueries();
      navigate(returnTo, { replace: true });
    } catch (err) { setError(signupError(err)); }
    finally { busy.current = false; setLoading(false); }
  }
  return <div className="flex min-h-[80vh] items-center justify-center px-4 py-8">
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h1 className="mb-3 text-2xl font-semibold text-foreground">Créer un compte</h1>
      {sent ? <div role="status" className="space-y-4"><p>Vérifiez votre boîte mail pour activer votre compte.</p><p className="text-sm text-muted-foreground">Pensez à vérifier vos spams. Votre accès membre sera ensuite soumis à la validation du club.</p></div>
      : confirmed ? <div role="status" className="space-y-4"><p>{authLoading ? 'Vérification du compte…' : user ? 'Votre demande est enregistrée. Le club doit la valider pour vous accorder un accès membre.' : 'Connectez-vous pour retrouver votre demande. Si le lien a expiré, demandez un nouveau mot de passe.'}</p><Link className="block py-3 text-primary underline" to={user ? returnTo : '/login'}>{user ? 'Continuer' : 'Se connecter'}</Link></div>
      : user && !created.current ? <p role="status">Vous êtes déjà connecté·e. Retrouvez votre accès au club dans votre espace.</p>
      : <form onSubmit={submit} aria-busy={loading} className="space-y-4">
        <p className="text-sm text-muted-foreground">Réservé aux adhérents. Un administrateur du club validera votre demande avant de vous donner accès aux services membres.</p>
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}<Link to="/forgot-password" className="block py-3 underline">Mot de passe oublié ?</Link>{created.current && <p>Votre compte est créé. Réessayez pour vérifier la demande.</p>}</div>}
        <fieldset disabled={loading || created.current} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">{(['prenom', 'nom'] as const).map(key => <div key={key}><label className={labelClass} htmlFor={`signup-${key}`}>{key === 'prenom' ? 'Prénom' : 'Nom'} *</label><input id={`signup-${key}`} type="text" className={inputClass} maxLength={100} autoComplete={key === 'prenom' ? 'given-name' : 'family-name'} value={fields[key]} onChange={change(key)} required /></div>)}</div>
          <div><label className={labelClass} htmlFor="signup-email">Email *</label><input id="signup-email" className={inputClass} type="email" autoComplete="email" autoCapitalize="none" value={fields.email} onChange={change('email')} required /></div>
          <div><label className={labelClass} htmlFor="signup-sex">Sexe *</label><select id="signup-sex" className={inputClass} value={fields.sex} onChange={change('sex')} required><option value="">Choisir…</option><option value="female">Femme</option><option value="male">Homme</option></select></div>
          {(['password', 'confirm'] as const).map(key => <div key={key}><label className={labelClass} htmlFor={`signup-${key}`}>{key === 'password' ? 'Mot de passe' : 'Confirmer le mot de passe'} *</label><PasswordInput id={`signup-${key}`} className={inputClass} minLength={8} autoComplete="new-password" value={fields[key]} onChange={change(key)} required />{key === 'password' && <p className="mt-1 text-sm text-muted-foreground">8 caractères minimum.</p>}</div>)}
          <div className="border-t border-border/70 pt-4"><label className={labelClass} htmlFor="signup-classement">Classement <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-accent-foreground">Facultatif</span></label><select id="signup-classement" className={inputClass} value={fields.classement} onChange={change('classement')}><option value="">Je ne sais pas / non classé·e</option>{TENNIS_RANKINGS.map(r => <option key={r}>{r}</option>)}</select></div>
        </fieldset>
        <button className={buttonClass} disabled={loading || !clubId || authLoading}>{loading ? 'Création du compte…' : created.current ? 'Vérifier ma demande' : 'Créer mon compte'}</button>
      </form>}
      <Link to="/login" className="mt-4 block py-3 text-center text-sm text-primary underline">J’ai déjà un compte</Link>
    </div>
  </div>;
}
