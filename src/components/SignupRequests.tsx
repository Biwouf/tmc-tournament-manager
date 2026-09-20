import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
type Request = { user_id: string; email: string; prenom: string; nom: string; sex: string | null; classement: string | null; status: 'pending' | 'denied' | 'revoked'; created_at: string };
export default function SignupRequests({ clubId, onChanged }: { clubId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<Request[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const [success, setSuccess] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('club_signup_admin_list', { p_club: clubId });
      if (error) throw error;
      setRows(data ?? []); setError(null);
    } catch { setError('Chargement des demandes impossible. Réessayez.'); }
    finally { setLoading(false); }
  }, [clubId]);
  useEffect(() => { void load(); }, [load]);
  async function decide(row: Request, status: 'approved' | 'denied') {
    if (lock.current) return;
    lock.current = true; setBusy(row.user_id); setError(null); setSuccess(null);
    try {
      const { error } = await supabase.rpc('club_signup_decide', { p_club: clubId, p_user: row.user_id, p_status: status });
      if (error) throw error;
      setSuccess(status === 'approved' ? 'Demande acceptée : l’accès Membre est accordé.' : 'Demande refusée.');
      await load(); onChanged();
    } catch { setError('Décision impossible. Actualisez la liste : la demande a peut-être déjà été traitée.'); }
    finally { lock.current = false; setBusy(null); }
  }
  return <section>
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Demandes d’inscription ({rows.filter(r => r.status === 'pending').length})</h2><button type="button" className="course-button" disabled={loading || !!busy} onClick={() => void load()}>Actualiser</button></div>
    {error && <p role="alert" className="mb-3 text-destructive">{error}</p>}
    {success && <p role="status" className="mb-3 text-foreground">{success}</p>}
    {loading ? <p role="status">Chargement des demandes…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucune demande d’inscription.</p> : <div className="space-y-3">{rows.map(r => <div key={r.user_id} className="rounded-2xl border bg-card p-6 shadow-sm">
      <h3 className="font-semibold">{r.prenom} {r.nom}</h3><p className="text-sm text-muted-foreground">{r.email}</p>
      <p className="my-2 text-sm">{r.sex === 'female' ? 'Femme' : r.sex === 'male' ? 'Homme' : 'Sexe non renseigné'} · Classement : {r.classement ?? 'Non renseigné'} · {new Date(r.created_at).toLocaleDateString('fr-FR')}</p>
      {r.status === 'pending' ? <div className="flex flex-wrap gap-2"><button type="button" className="course-button primary" disabled={!!busy} onClick={() => void decide(r, 'approved')}>{busy === r.user_id ? 'Traitement…' : 'Accepter comme membre'}</button><button type="button" className="course-button" disabled={!!busy} onClick={() => void decide(r, 'denied')}>Refuser</button></div> : <p className="text-sm text-muted-foreground">{r.status === 'denied' ? 'Demande refusée' : 'Accès retiré'}. Pour rétablir l’accès, utilisez l’invitation existante.</p>}
    </div>)}</div>}
  </section>;
}
