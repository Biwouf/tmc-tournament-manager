// Multi-tenant — PR4 : rôle de l'utilisateur courant dans le club courant.
//
// Même patron que ClubContext.tsx : un provider monté une seule fois au-dessus des
// routes (après résolution de l'auth ET du club), une requête par session, pas de
// useEffect par composant consommateur.
//
// La RLS reste la source de vérité (MULTI_TENANT.md §4) : ce hook ne sert qu'à
// masquer l'UI et à garder les routes.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useClub } from './ClubContext';

export type ClubRole = 'admin' | 'manager' | 'member';

type ClubRoleContextValue = {
  role: ClubRole | null;
  isMember: boolean;
  isSuperAdmin: boolean;
  loading: boolean;
};

const ClubRoleContext = createContext<ClubRoleContextValue>({
  role: null,
  isMember: false,
  isSuperAdmin: false,
  loading: true,
});

export function ClubRoleProvider({ children }: { children: ReactNode }) {
  const { clubId } = useClub();
  const [state, setState] = useState<{
    role: ClubRole | null;
    isSuperAdmin: boolean;
    loading: boolean;
  }>({ role: null, isSuperAdmin: false, loading: true });

  // Clé (user + club) en cours de chargement : onAuthStateChange se déclenche aussi
  // sur TOKEN_REFRESHED, inutile de refaire les deux requêtes à chaque refresh.
  // `undefined` = jamais chargé, `null` = chargé sans session.
  //
  // ⚠️ Cette clé est aussi le test de péremption à l'écriture (cf. plus bas). Ne pas
  // la doubler d'un drapeau `cancelled` posé au nettoyage de l'effet : en StrictMode
  // React rejoue l'effet, le 2ᵉ passage dédupliquerait sur la clé du 1er sans relancer
  // de requête, et l'écriture du 1er serait annulée → `loading` bloqué à `true` et
  // page blanche (App.tsx ne rend rien pendant le chargement du rôle).
  const loadedKey = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const load = async (userId: string | null) => {
      const key = userId && clubId ? `${userId}:${clubId}` : null;
      if (loadedKey.current === key) return;
      loadedKey.current = key;

      if (!key || !userId) {
        setState({ role: null, isSuperAdmin: false, loading: false });
        return;
      }

      // Sans ça, une session qui s'ouvre après un état « déconnecté » déjà résolu
      // ferait clignoter l'écran de refus (role null, loading false) le temps des
      // requêtes.
      setState((s) => (s.loading ? s : { ...s, loading: true }));

      try {
        const [{ data: membership }, { data: profile }] = await Promise.all([
          supabase
            .from('club_members')
            .select('role')
            .eq('club_id', clubId)
            .eq('user_id', userId)
            .maybeSingle(),
          supabase.from('profiles').select('is_super_admin').eq('id', userId).maybeSingle(),
        ]);
        // Péremption : une autre session (ou un autre club) a pris le relais pendant
        // les requêtes — c'est lui qui écrira.
        if (loadedKey.current !== key) return;

        setState({
          role: (membership?.role as ClubRole | undefined) ?? null,
          isSuperAdmin: profile?.is_super_admin === true,
          loading: false,
        });
      } catch (err) {
        // Ne jamais rester bloqué sur `loading` : App.tsx ne rend rien pendant ce
        // temps, ce qui donnerait une page blanche sans issue. On sort en « non
        // membre » → écran de refus, qui porte au moins un bouton de déconnexion.
        console.error('[ClubRoleContext] lecture du rôle impossible', err);
        if (loadedKey.current !== key) return;
        setState({ role: null, isSuperAdmin: false, loading: false });
      }
    };

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => load(session?.user?.id ?? null))
      .catch((err) => {
        console.error('[ClubRoleContext] session illisible', err);
        setState({ role: null, isSuperAdmin: false, loading: false });
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      load(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, [clubId]);

  return (
    <ClubRoleContext.Provider
      value={{
        role: state.role,
        isMember: state.role !== null,
        isSuperAdmin: state.isSuperAdmin,
        loading: state.loading,
      }}
    >
      {children}
    </ClubRoleContext.Provider>
  );
}

export function useClubRole() {
  return useContext(ClubRoleContext);
}
