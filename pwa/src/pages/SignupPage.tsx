import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import PasswordInput from '../components/PasswordInput';
import { useClub } from '../contexts/ClubContext';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { isRencontrePath, signupError, signupReturnTo, validateSignup, TENNIS_RANKINGS, type SignupFields } from '../lib/signup';

// Champs de 48 px, texte 16 px : pas de zoom automatique d'iOS au focus.
const inputClass = 'min-h-12 w-full rounded-xl border border-border bg-background px-3.5 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';
const buttonClass = 'min-h-12 w-full rounded-xl bg-primary px-4 text-base font-bold text-primary-foreground shadow-lg disabled:opacity-60';
const labelClass = 'mb-1.5 block text-sm font-semibold';
/**
 * Bandeau d'action fixé en bas : mesure sa hauteur réelle (padding du contenu au-dessus) et,
 * clavier ouvert sur iOS, se cale au-dessus du clavier (`visualViewport`), le layout viewport
 * ne rétrécissant pas. Un champ qui prend le focus sous le bandeau est ramené au centre.
 */
function useStickyCta(active: boolean) {
  const barRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(100);
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const bar = barRef.current;
    if (!active || !bar) return;
    const measure = () => setHeight(Math.ceil(bar.getBoundingClientRect().height));
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(bar);
    const vv = window.visualViewport;
    const follow = () => {
      if (!vv) return;
      setKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    };
    follow();
    vv?.addEventListener('resize', follow);
    vv?.addEventListener('scroll', follow);
    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.matches('input, select, textarea')) return;
      // Après l'ouverture du clavier : le bandeau a déjà été recalé.
      setTimeout(() => {
        const limit = bar.getBoundingClientRect().top - 8;
        if (target.getBoundingClientRect().bottom > limit) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 300);
    };
    document.addEventListener('focusin', onFocus);
    return () => {
      observer?.disconnect();
      vv?.removeEventListener('resize', follow);
      vv?.removeEventListener('scroll', follow);
      document.removeEventListener('focusin', onFocus);
    };
  }, [active]);
  return { barRef, height, keyboard };
}

export default function SignupPage({ confirmed = false }: { confirmed?: boolean }) {
  const { clubId } = useClub();
  const { user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [fields, setFields] = useState<SignupFields>({ prenom: '', nom: '', email: '', sex: '', classement: '', password: '' });
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
        if (!data.session) { setSent(true); setFields(f => ({ ...f, password: '' })); return; }
        created.current = true;
      }
      const { error } = await supabase.rpc('course_signup_my_profile', { p_club: clubId, p_prenom: profile.prenom, p_nom: profile.nom, p_sex: profile.sex, p_classement: profile.classement, p_request_id: requestId.current });
      if (error) throw error;
      await cache.invalidateQueries();
      navigate(returnTo, { replace: true, state: isRencontrePath(returnTo) ? { welcome: 'compo' } : undefined });
    } catch (err) { setError(signupError(err)); }
    finally { busy.current = false; setLoading(false); }
  }
  const formShown = !sent && !confirmed && !(user && !created.current);
  const cta = useStickyCta(formShown);
  // Le titre visible est celui du header (« Créer un compte ») : pas de second titre à l'écran.
  // Bas de page = hauteur réelle du bandeau (+ clavier iOS) + 16 px : rien ne passe dessous.
  return <div className="flex flex-col items-center px-4 pt-4"
    style={{ paddingBottom: formShown ? `${cta.height + cta.keyboard + 16}px` : '32px' }}>
    <h1 className="sr-only">Créer un compte</h1>
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-sm">
      {sent ? <div role="status" className="space-y-4"><p>Vérifiez votre boîte mail pour activer votre compte.</p><p className="text-sm text-muted-foreground">Pensez à vérifier vos spams. Votre accès membre sera ensuite soumis à la validation du club.</p></div>
      : confirmed ? <div role="status" className="space-y-4"><p>{authLoading ? 'Vérification du compte…' : user ? 'Votre demande est enregistrée. Le club doit la valider pour vous accorder un accès membre.' : 'Connectez-vous pour retrouver votre demande. Si le lien a expiré, demandez un nouveau mot de passe.'}</p><Link className="block py-3 text-primary underline" to={user ? returnTo : `/login${returnTo !== '/actu' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`} state={user && isRencontrePath(returnTo) ? { welcome: 'compo' } : undefined}>{user ? 'Continuer' : 'Se connecter'}</Link></div>
      : user && !created.current ? <p role="status">Vous êtes déjà connecté·e. Retrouvez votre accès au club dans votre espace.</p>
      : <form id="signup-form" onSubmit={submit} aria-busy={loading} className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">Réservé aux adhérents. Un administrateur du club validera votre demande avant de vous donner accès aux services membres.</p>
          {/* En tête de carte : jamais recouvert par le bandeau du bas. Le Retour du header mène aussi à la connexion. */}
          <Link to="/login" className="-ml-1 inline-flex min-h-11 items-center px-1 text-sm font-semibold text-primary underline underline-offset-2">J’ai déjà un compte</Link>
        </div>
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}<Link to="/forgot-password" className="block py-3 underline">Mot de passe oublié ?</Link>{created.current && <p>Votre compte est créé. Réessayez pour vérifier la demande.</p>}</div>}
        <fieldset disabled={loading || created.current} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">{(['prenom', 'nom'] as const).map(key => <div key={key}><label className={labelClass} htmlFor={`signup-${key}`}>{key === 'prenom' ? 'Prénom' : 'Nom'} *</label><input id={`signup-${key}`} type="text" className={inputClass} maxLength={100} autoComplete={key === 'prenom' ? 'given-name' : 'family-name'} value={fields[key]} onChange={change(key)} required /></div>)}</div>
          <div><label className={labelClass} htmlFor="signup-email">Email *</label><input id="signup-email" className={inputClass} type="email" autoComplete="email" autoCapitalize="none" value={fields.email} onChange={change('email')} required /></div>
          <div><label className={labelClass} htmlFor="signup-sex">Sexe *</label><select id="signup-sex" className={inputClass} value={fields.sex} onChange={change('sex')} required><option value="">Choisir…</option><option value="female">Femme</option><option value="male">Homme</option></select><p className="mt-1 text-[13px] text-muted-foreground">Utilisé pour les quotas des cours.</p></div>
          <div>
            <label className={labelClass} htmlFor="signup-password">Mot de passe *</label>
            <PasswordInput id="signup-password" className={inputClass} minLength={8} autoComplete="new-password" value={fields.password} onChange={change('password')} required />
            <p className="mt-1 text-sm text-muted-foreground">8 caractères minimum.</p>
          </div>
          <div className="border-t border-border/70 pt-4"><label className={labelClass} htmlFor="signup-classement">Classement <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-accent-foreground">Facultatif</span></label><select id="signup-classement" className={inputClass} value={fields.classement} onChange={change('classement')}><option value="">Je ne sais pas / non classé·e</option>{TENNIS_RANKINGS.map(r => <option key={r}>{r}</option>)}</select></div>
        </fieldset>
      </form>}
    </div>
    {/* Action principale toujours visible en bas d'écran, au-dessus de la zone sûre. */}
    {formShown && <div ref={cta.barRef} style={{ bottom: cta.keyboard }} className="fixed inset-x-0 z-40 bg-gradient-to-t from-background via-background/95 to-background/0 px-4 pt-6 pb-[max(env(safe-area-inset-bottom),12px)]">
      <div className="mx-auto max-w-sm">
        <button form="signup-form" className={buttonClass} disabled={loading || !clubId || authLoading}>{loading ? 'Création du compte…' : created.current ? 'Vérifier ma demande' : 'Créer mon compte'}</button>
      </div>
    </div>}
  </div>;
}
