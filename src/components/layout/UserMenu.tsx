import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import type { ClubRole } from '../../contexts/ClubRoleContext';
import PasswordDialog from '../dashboard/PasswordDialog';

const ROLE_LABEL: Record<ClubRole, string> = {
  admin: 'Administrateur',
  manager: 'Gestionnaire',
  member: 'Membre',
};

// PR-BO1 — remplace les « Se déconnecter » posés dans chaque en-tête de page (brief N5).
export default function UserMenu({ user, role, isSuperAdmin }: { user: User; role: ClubRole | null; isSuperAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const [profile, setProfile] = useState<{ prenom: string; nom: string } | null>(null);

  // Nom affiché : « Prénom N. » depuis `profiles` ; l'e-mail seulement si le profil est vide.
  useEffect(() => {
    let cancelled = false;
    supabase.from('profiles').select('prenom, nom').eq('id', user.id).maybeSingle().then(({ data }) => {
      if (!cancelled && data) setProfile({ prenom: (data.prenom ?? '').trim(), nom: (data.nom ?? '').trim() });
    });
    return () => { cancelled = true; };
  }, [user.id]);

  const email = user.email ?? '';
  const prenom = profile?.prenom ?? '';
  const nom = profile?.nom ?? '';
  const name = prenom ? `${prenom}${nom ? ` ${nom[0].toUpperCase()}.` : ''}` : email;
  const initials = (prenom
    ? `${prenom[0]}${nom[0] ?? ''}`
    : (email.split('@')[0].match(/[a-z0-9]/gi) ?? ['?']).slice(0, 2).join('')
  ).toUpperCase();
  const roleLabel = role ? ROLE_LABEL[role] : isSuperAdmin ? 'Support plateforme' : '';

  useEffect(() => {
    if (!open) return;
    // Clavier du motif « menu » (WAI-ARIA APG) : Échap, flèches haut/bas en boucle, Début, Fin.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); return; }
      const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'ArrowDown' ? items[(index + 1) % items.length]
        : event.key === 'ArrowUp' ? items[(index - 1 + items.length) % items.length]
        : event.key === 'Home' ? items[0]
        : event.key === 'End' ? items[items.length - 1]
        : null;
      if (next) { event.preventDefault(); next.focus(); }
    };
    const onClick = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const item = 'flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm font-medium transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none';

  return (
    <div ref={box} className="relative">
      {open && (
        <div role="menu" aria-label="Mon compte" className="absolute inset-x-0 bottom-full mb-2 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {/* `tabIndex={-1}` : on circule aux flèches, Tab sort du menu (motif APG). */}
          <button type="button" role="menuitem" tabIndex={-1} className={item} onClick={() => { setOpen(false); setPassword(true); }}>
            Mon mot de passe
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className={item} onClick={() => supabase.auth.signOut()}>
            Se déconnecter
          </button>
        </div>
      )}
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={email}
        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-muted"
      >
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-foreground">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{name}</span>
          {roleLabel && <span className="block truncate text-xs text-muted-foreground">{roleLabel}</span>}
        </span>
        <span aria-hidden className="text-muted-foreground">⋯</span>
      </button>
      {password && <PasswordDialog onClose={() => setPassword(false)} onDone={() => setPassword(false)} />}
    </div>
  );
}
