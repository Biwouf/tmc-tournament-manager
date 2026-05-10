# Spec — Pull-to-Refresh (Actus & Événements)

> Module PWA · `pwa/src/`

---

## Objectif

Ajouter un geste "tirer pour rafraîchir" (pull-to-refresh) sur les sections **Actus** (`/actus`) et **Événements** (`/evenements`) de la PWA. Le geste déclenche un rechargement des données depuis Supabase via TanStack Query.

Aucune librairie externe n'est ajoutée — le comportement est implémenté via un hook natif (Pointer Events).

---

## Comportement attendu

1. L'utilisateur tire vers le bas depuis le haut de la liste alors qu'il est déjà en haut du scroll.
2. Un indicateur visuel (spinner) apparaît progressivement en haut de la zone de contenu.
3. Si le seuil de traction est atteint (~80 px), le spinner se fixe et le rechargement se déclenche.
4. Une fois les données rechargées, le spinner disparaît (animation de sortie vers le haut).
5. Si le seuil n'est pas atteint, le contenu revient à sa position initiale (snap-back).
6. Le geste est ignoré si un rechargement est déjà en cours.
7. Sur desktop (souris), le geste n'a aucun effet visible (pointer events de type `mouse` ignorés).

---

## Fichiers à créer / modifier

### 1. `pwa/src/hooks/usePullToRefresh.ts` — nouveau fichier

Hook générique réutilisable.

**Signature :**
```ts
function usePullToRefresh(options: {
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  containerRef: React.RefObject<HTMLElement>;
}): { pullProgress: number }
```

**Logique :**

- `pointerdown` est écouté **sur `containerRef.current`** (porte d'entrée du geste).
- `pointermove` / `pointerup` / `pointercancel` sont écoutés **au niveau `document`** : insensible à un éventuel arrêt de propagation, drag natif sur enfants, pointer capture implicite, etc.
- Un listener **`touchmove` non-passif (`{ passive: false }`)** est attaché sur `containerRef.current` et appelle `e.preventDefault()` quand `delta > 0`. Indispensable : sans ça, dès que le wrapper est scrollable (contenu plus grand que le wrapper), le moteur de scroll natif consomme le geste et émet un `pointercancel` qui tue notre séquence après ~10–15 px. Sur un wrapper non scrollable (peu de contenu), le bug n'apparaît pas, ce qui peut masquer la régression en dev.
- Ne s'active que si :
  - `event.pointerType === 'touch'`
  - `containerRef.current.scrollTop === 0` au moment du `pointerdown`
  - `isRefreshing === false`
- `pullProgress` : valeur `[0, 1]` représentant la progression du tirage (0 = repos, 1 = seuil atteint). Calculé comme `Math.min(deltaY / THRESHOLD, 1)` avec `THRESHOLD = 80`.
- Au `pointerup` :
  - Si `pullProgress === 1` → appelle `onRefresh()`.
  - Sinon → reset à 0 (snap-back).
- Nettoyage des listeners au démontage.

**Constante interne :** `THRESHOLD = 80` (pixels).

**Note de signature :** le hook retourne aussi `isDragging: boolean`, utilisé par `PullToRefreshWrapper` pour couper la transition CSS pendant le tirage actif (et la garder pendant le snap-back / fin de rechargement).

---

### 2. `pwa/src/components/layout/PullToRefreshWrapper.tsx` — nouveau fichier

Composant wrapper qui englobe le contenu scrollable et affiche l'indicateur.

**Props :**
```ts
interface Props {
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  children: React.ReactNode;
}
```

**Structure JSX (schématique) :**
```tsx
<div ref={containerRef} className="overflow-y-auto h-full relative">
  {/* Indicateur pull-to-refresh */}
  <div style={{ transform: `translateY(...)`, opacity: ... }}>
    <Spinner />
  </div>
  {children}
</div>
```

**Comportement visuel :**

- L'indicateur est positionné en `absolute` en haut du conteneur, centré horizontalement.
- Il se translate verticalement en fonction de `pullProgress` :
  - Au repos : `translateY(-48px)` (caché au-dessus)
  - À `pullProgress = 1` (et pendant le rechargement) : `translateY(12px)` (visible)
- Rotation du spinner : `rotate(${pullProgress * 360}deg)` pendant le tirage ; animation CSS `spin` continue pendant `isRefreshing`.
- Transition CSS `transform 0.2s ease` uniquement pendant le snap-back (pas pendant le tirage actif).
- Le contenu (`children`) se translate aussi vers le bas proportionnellement : `translateY(${pullProgress * 60}px)` pendant le tirage, revient à 0 après.

**Spinner :** SVG inline simple (cercle avec arc manquant), couleur `text-primary` (variable CSS Tailwind). Pas de dépendance icône externe.

---

### 3. `pwa/src/pages/ActusPage.tsx` — modification

**Changements :**

- Extraire `refetch` depuis `useInfiniteQuery`.
- Envelopper le `<div className="p-4 ...">` existant dans `<PullToRefreshWrapper>`.
- `onRefresh` : appelle `refetch()` (qui recharge toutes les pages déjà chargées depuis la page 1).
- `isRefreshing` : `isFetching && !isFetchingNextPage` (distingue le refresh global du chargement de page suivante).

```tsx
const { data, fetchNextPage, isFetching, isFetchingNextPage, isError, hasNextPage, refetch } =
  useInfiniteQuery({ ... });

const isRefreshing = isFetching && !isFetchingNextPage;

const handleRefresh = async () => {
  await refetch();
};

return (
  <PullToRefreshWrapper onRefresh={handleRefresh} isRefreshing={isRefreshing}>
    {/* contenu existant inchangé */}
  </PullToRefreshWrapper>
);
```

---

### 4. `pwa/src/pages/EventsPage.tsx` — modification

**Changements :**

- Extraire `refetch` et `isFetching` depuis `useQuery`.
- Envelopper le `<div className="p-4 ...">` existant dans `<PullToRefreshWrapper>`.
- `onRefresh` : appelle `refetch()`.
- `isRefreshing` : `isFetching`.

```tsx
const { data: events, isLoading, isError, isFetching, refetch } = useQuery({ ... });

const handleRefresh = async () => {
  await refetch();
};

return (
  <PullToRefreshWrapper onRefresh={handleRefresh} isRefreshing={isFetching}>
    {/* contenu existant inchangé */}
  </PullToRefreshWrapper>
);
```

---

## Ce qui ne change pas

- Aucune modification de `AppHeader`, `BottomNav`, ou du routing.
- Aucune modification des composants `ActuCard`, `EventCard`.
- Aucune dépendance npm ajoutée.
- Le comportement "Voir plus" (infinite scroll) de `ActusPage` reste intact.

---

## Contraintes

- `PullToRefreshWrapper` doit prendre `100%` de la hauteur disponible et gérer lui-même le scroll vertical (remplace le scroll natif du conteneur existant). S'assurer que cela n'affecte pas le comportement de `BottomNav` (qui est en `fixed`).
- Le geste ne doit pas interférer avec le scroll horizontal ou les swipes de navigation React Router.
- Tester sur iOS Safari (PWA installée) et Android Chrome, où le pull-to-refresh natif du navigateur peut entrer en conflit → désactiver `overscroll-behavior-y: contain` sur le conteneur si nécessaire.

---

## Critères de succès

- [ ] Tirer vers le bas depuis le haut de la liste déclenche un rechargement visible sur Actus.
- [ ] Tirer vers le bas depuis le haut de la liste déclenche un rechargement visible sur Événements.
- [ ] Un tirage partiel (< seuil) revient à la position initiale sans déclencher de rechargement.
- [ ] Un rechargement en cours empêche un second déclenchement.
- [ ] Le spinner disparaît dès que les données sont rechargées.
- [ ] Sur desktop (souris), le geste n'a aucun effet.
- [ ] Le pull-to-refresh natif du navigateur (iOS/Android) n'entre pas en conflit.
