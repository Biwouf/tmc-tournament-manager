# Brief — Prise de contrôle forcée d'un live

## Contexte

Aujourd'hui, quand un user BO démarre un live, il en devient le gestionnaire (`scored_by = user.id`). Le problème :

- **Dans le BO** : n'importe quel autre user peut cliquer "Reprendre" sur un live en cours et accéder à la saisie — pas de guard, deux users peuvent saisir en même temps.
- **Dans la PWA** : le live est verrouillé pour les autres users (aucun bouton visible, guard dans `LiveMatchPage` qui redirige avec flash). Le seul déblocage possible est que le gestionnaire actuel clique "Libérer".

### Objectif

Implémenter une **prise de contrôle forcée avec warning** sur BO et PWA :

1. Un second user voit qui gère le live (prénom + nom).
2. Il peut prendre le contrôle après confirmation — pas besoin d'attendre que le premier se libère.
3. Le premier user, s'il est encore sur la page de saisie, voit un bandeau l'informant qu'il a été remplacé et passe en lecture seule.

---

## Périmètre

Fichiers touchés (vérifier le rôle de chacun dans `docs/CODEBASE.md` avant de commencer) :

| Couche | Fichier |
|---|---|
| Migration SQL | `supabase/migrations/20260521_profiles.sql` |
| Types BO | `src/types.ts` |
| Types PWA | `pwa/src/types.ts` |
| BO liste | `src/pages/LiveScorePage.tsx` |
| BO carte | `src/components/LiveMatchCard.tsx` |
| BO saisie | `src/pages/LiveMatchPage.tsx` |
| PWA liste | `pwa/src/pages/MatchesPage.tsx` |
| PWA carte | `pwa/src/components/matches/MatchCard.tsx` |
| PWA saisie | `pwa/src/pages/LiveMatchPage.tsx` |

---

## 1. Migration Supabase — table `profiles`

Fichier : `supabase/migrations/20260521_profiles.sql`

```sql
CREATE TABLE profiles (
  id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prenom TEXT NOT NULL DEFAULT '',
  nom    TEXT NOT NULL DEFAULT ''
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Lecture libre pour authenticated et anon (noms affichés dans warnings et PWA publique)
CREATE POLICY "profiles_select_authenticated"
  ON profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_select_anon"
  ON profiles FOR SELECT TO anon USING (true);

-- Écriture : uniquement son propre profil
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Trigger : crée un profil vide à chaque nouvel utilisateur Supabase Auth
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

**Après application de la migration :** insérer manuellement les profils des users existants via le dashboard Supabase (SQL Editor) :

```sql
-- Exemple (adapter avec les vrais prénoms/noms)
INSERT INTO profiles (id, prenom, nom)
VALUES
  ('<uuid-user-1>', 'Prénom', 'NOM')
ON CONFLICT DO NOTHING;
```

**Important :** si un profil n'existe pas (prenom/nom vides ou profil absent), le warning affiche "un autre utilisateur" comme fallback — ne pas crasher.

---

## 2. Types TypeScript

Ajouter dans `src/types.ts` **et** `pwa/src/types.ts` (les deux fichiers, ils sont maintenus séparément) :

```ts
export interface Profile {
  id: string;
  prenom: string;
  nom: string;
}
```

Pas de modification du type `LiveMatch` — `scored_by` reste un UUID, les profils sont chargés séparément.

---

## 3. BO — `LiveScorePage.tsx`

### 3a. Charger le user courant et les profils des gestionnaires

Au montage (dans `useEffect` au côté du fetch des matches), récupérer également :

```ts
// User courant
const { data: sessionData } = await supabase.auth.getSession();
const currentUserId = sessionData.session?.user.id ?? null;
```

Après le fetch des matches, construire la liste des `scored_by` non-null distincts et faire un batch fetch des profils :

```ts
const scoredByIds = [...new Set(matches.filter(m => m.scored_by).map(m => m.scored_by!))];
if (scoredByIds.length > 0) {
  const { data } = await supabase.from('profiles').select('*').in('id', scoredByIds);
  // Stocker dans un state : profilesMap: Record<string, Profile>
}
```

Stocker dans le state local : `currentUserId: string | null` et `profilesMap: Record<string, Profile>`.

### 3b. Nouveau dialog — prise de contrôle forcée

Ajouter un second dialog state (distinct du dialog "Démarrer le live") :

```ts
const [takeoverDialog, setTakeoverDialog] = useState<{ matchId: string } | null>(null);
```

### 3c. Modifier `handlePrimary` (ou l'équivalent dans `LiveMatchCard`)

Actuellement, cliquer "Reprendre" sur un match `live` redirige directement. Il faut distinguer :

- `status === 'live'` et `scored_by === currentUserId` → redirection directe (inchangé, c'est son live)
- `status === 'live'` et `scored_by !== currentUserId` → ouvrir `takeoverDialog` avec le `matchId`
- `status === 'pending'` → inchangé (dialog court existant)
- `status === 'finished'` → inchangé (redirection directe)

### 3d. Rendu du dialog takeover

```tsx
{takeoverDialog && (() => {
  const m = matches.find(x => x.id === takeoverDialog.matchId);
  const profile = m?.scored_by ? profilesMap[m.scored_by] : null;
  const managerName = profile && (profile.prenom || profile.nom)
    ? `${profile.prenom} ${profile.nom}`.trim()
    : 'un autre utilisateur';
  return (
    <div className="...overlay...">
      <div className="...dialog...">
        <h2>Prendre le contrôle du live ?</h2>
        <p>Ce live est actuellement géré par <strong>{managerName}</strong>.</p>
        <p>Si vous prenez le contrôle, cette personne passera en lecture seule.</p>
        <div className="...actions...">
          <button onClick={() => setTakeoverDialog(null)}>Annuler</button>
          <button onClick={confirmTakeover}>Prendre le contrôle</button>
        </div>
      </div>
    </div>
  );
})()}
```

### 3e. `confirmTakeover`

```ts
const confirmTakeover = async () => {
  if (!takeoverDialog || !currentUserId) return;
  const { error } = await supabase
    .from('live_matches')
    .update({ scored_by: currentUserId })
    .eq('id', takeoverDialog.matchId);
  if (error) { alert(`Erreur : ${error.message}`); return; }
  setTakeoverDialog(null);
  navigate(`/live-score/${takeoverDialog.matchId}`);
};
```

### 3f. Mise à jour du libellé bouton dans `LiveMatchCard`

`LiveMatchCard` reçoit déjà une prop `onPrimary`. Il faut qu'elle reçoive aussi `isOwnLive: boolean` pour afficher le bon libellé dans le menu kebab :

- `isOwnLive === true` (live du user courant) → libellé **"Reprendre"**
- `isOwnLive === false` (live d'un autre) → libellé **"Prendre le contrôle"**

Passer `isOwnLive={m.status === 'live' && m.scored_by === currentUserId}` depuis `LiveScorePage`.

---

## 4. BO — `LiveMatchPage.tsx`

### 4a. Récupérer le user courant

`LiveMatchPage` n'utilise pas actuellement `useAuth` (le BO n'a pas ce hook). Récupérer le user via :

```ts
const [currentUserId, setCurrentUserId] = useState<string | null>(null);

useEffect(() => {
  supabase.auth.getSession().then(({ data }) => {
    setCurrentUserId(data.session?.user.id ?? null);
  });
}, []);
```

### 4b. Abonnement Realtime sur le match courant

Ajouter dans le `useEffect` de chargement du match un abonnement Realtime filtré sur l'ID du match :

```ts
const channel = supabase
  .channel(`live_match_bo_${id}`)
  .on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'live_matches', filter: `id=eq.${id}` },
    (payload) => {
      const updated = payload.new as LiveMatch;
      setMatch(updated);
      // Si scored_by a changé vers quelqu'un d'autre → on détecte dans le rendu
    }
  )
  .subscribe();

return () => { supabase.removeChannel(channel); };
```

### 4c. Bandeau "Vous avez perdu le contrôle"

Dans le rendu, après que `match` et `currentUserId` sont chargés :

```ts
const hasLostControl =
  match.status === 'live' &&
  currentUserId !== null &&
  match.scored_by !== currentUserId;
```

Si `hasLostControl` est vrai :
- Afficher un bandeau d'alerte **au-dessus** du composant `LiveScoreEntry` : 
  > ⚠️ Ce live a été repris par quelqu'un d'autre. Vous êtes en lecture seule.
- Passer `disabled={true}` (ou bloquer les appels `applyPatch`) à `LiveScoreEntry`.

`LiveScoreEntry` du BO accepte déjà une prop ou vérifie `status !== 'live'` pour se désactiver — vérifier l'implémentation et adapter si nécessaire pour also bloquer sur `hasLostControl`.

---

## 5. PWA — `MatchesPage.tsx`

### 5a. Charger les profils des gestionnaires

Même logique que pour le BO. Après le fetch des matches via TanStack Query, faire un fetch séparé des profils :

```ts
const { data: matches } = useQuery({ queryKey: ['matches'], queryFn: fetchMatches, ... });

const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});

useEffect(() => {
  if (!matches) return;
  const ids = [...new Set(matches.filter(m => m.scored_by).map(m => m.scored_by!))];
  if (ids.length === 0) return;
  supabase.from('profiles').select('*').in('id', ids).then(({ data }) => {
    if (!data) return;
    const map: Record<string, Profile> = {};
    for (const p of data) map[p.id] = p;
    setProfilesMap(map);
  });
}, [matches]);
```

Passer `profilesMap` à chaque `MatchCard` : `<MatchCard ... profilesMap={profilesMap} />`.

Mettre aussi à jour les profils si le Realtime invalide les matches (les nouveaux `scored_by` pourraient ne pas être dans le map courant) — relancer le fetch des profils dans le handler Realtime existant.

---

## 6. PWA — `MatchCard.tsx`

### 6a. Nouvelle prop

```ts
interface Props {
  match: LiveMatch;
  userId: string | null;
  profilesMap: Record<string, Profile>;  // ← nouveau
}
```

### 6b. Nouveau state — modale de confirmation

```ts
const [showTakeoverModal, setShowTakeoverModal] = useState(false);
```

### 6c. Nouvelle branche d'actions

Actuellement, si `isLive && !isOwner` → pas de boutons. Remplacer par :

```tsx
} else if (isLive && isAuth && !isOwner) {
  actions = (
    <button
      type="button"
      onClick={() => setShowTakeoverModal(true)}
      disabled={busy}
      className="min-h-11 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
    >
      Prendre le contrôle
    </button>
  );
}
```

### 6d. Modale de confirmation

```tsx
{showTakeoverModal && (() => {
  const profile = match.scored_by ? profilesMap[match.scored_by] : null;
  const managerName = profile && (profile.prenom || profile.nom)
    ? `${profile.prenom} ${profile.nom}`.trim()
    : 'un autre utilisateur';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-xl flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">Prendre le contrôle ?</h2>
        <p className="text-sm text-muted-foreground">
          Ce live est actuellement géré par{' '}
          <span className="font-medium text-foreground">{managerName}</span>.
          Si vous prenez le contrôle, cette personne passera en lecture seule.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleTakeover}
            disabled={busy}
            className="min-h-11 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            Prendre le contrôle
          </button>
          <button
            type="button"
            onClick={() => setShowTakeoverModal(false)}
            disabled={busy}
            className="min-h-11 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
})()}
```

### 6e. `handleTakeover`

```ts
const handleTakeover = async () => {
  if (!userId) return;
  setBusy(true);
  setActionError(null);
  const { error } = await supabase
    .from('live_matches')
    .update({ scored_by: userId })
    .eq('id', match.id);
  if (error) {
    setActionError(error.message);
    setBusy(false);
    return;
  }
  setShowTakeoverModal(false);
  refresh();
  navigate(`/matches/${match.id}/score`);
};
```

### 6f. Supprimer le guard dans `pwa/src/pages/LiveMatchPage.tsx`

Le guard actuel redirige si `scored_by !== user.id`. Il doit rester — mais uniquement pour empêcher l'accès direct par URL sans passer par la modale. Un user qui vient de faire un takeover aura déjà `scored_by = user.id` au moment d'arriver sur la page.

Le guard est donc **inchangé** — il protège les accès directs par URL, la modale dans `MatchCard` gère le cas normal.

---

## 7. PWA — `LiveMatchPage.tsx`

### 7a. Abonnement Realtime sur le match courant

La page charge le match au montage mais ne s'abonne à aucun canal en temps réel. Ajouter :

```ts
useEffect(() => {
  if (!id || !user) return;
  const channel = supabase
    .channel(`live_match_pwa_${id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'live_matches', filter: `id=eq.${id}` },
      (payload) => {
        setMatch(payload.new as LiveMatch);
      }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [id, user]);
```

### 7b. Détection de perte de contrôle

```ts
const hasLostControl =
  match !== null &&
  match.status === 'live' &&
  user !== null &&
  match.scored_by !== user.id;
```

Si `hasLostControl` est vrai :
- Afficher un bandeau d'alerte (style `bg-red-50 border-red-200 text-red-700`) au-dessus de `LiveScoreEntry` :
  > Ce live a été repris par quelqu'un d'autre. Vous êtes en lecture seule.
- Passer `disabled` à `LiveScoreEntry` (ou conditionner le rendu du composant).

Vérifier comment `LiveScoreEntry` gère le disabled — il se base sur `match.status !== 'live'` pour se désactiver. Ajouter une prop `forceDisabled?: boolean` si nécessaire.

---

## Résumé des changements par couche

| Couche | Ce qui change |
|---|---|
| SQL | Nouvelle table `profiles` + RLS + trigger new_user |
| Types | Nouveau type `Profile` (BO + PWA) |
| BO liste | Fetch user courant + profils ; dialog takeover ; libellé bouton conditionnel |
| BO carte | Prop `isOwnLive` pour libellé kebab |
| BO saisie | Abonnement Realtime ; bandeau "lecture seule" si `scored_by` change |
| PWA liste | Fetch profils après matches ; passer `profilesMap` aux cartes |
| PWA carte | Modale warning + `handleTakeover` ; bouton "Prendre le contrôle" |
| PWA saisie | Abonnement Realtime ; bandeau "lecture seule" si `scored_by` change |

---

## Ce qui est hors scope

- UI pour qu'un user modifie son propre profil (prenom/nom). Les profils sont renseignés manuellement en base pour l'instant.
- Notification push quand on se fait "prendre" le live.
- Page de gestion des profils dans le BO.
