# Spec — PWA CAC Tennis

> Statut : prêt pour développement
> Dernière mise à jour : 2026-04-26

---

## Vue d'ensemble

Application web progressive (PWA) publique à destination des membres du club CAC Tennis.
Elle se nourrit de données gérées dans le back-office existant (`tmc-tournament-manager`).

Trois rubriques en v1 : **Actus**, **Événements**, **Matches**.

---

## Architecture

### Monorepo

La PWA vit dans le dossier `/pwa` à la racine du repo existant. C'est un projet Vite autonome — son propre `package.json`, sa propre config — mais dans le même repo Git.

```
tmc-tournament-manager/         ← Back-office (inchangé)
  src/
  docs/
  pwa/                          ← PWA (nouveau projet Vite autonome)
    src/
    public/
    package.json
    vite.config.ts
    ...
```

### Stack technique

| Élément | Choix | Raison |
|---|---|---|
| Framework | React 19 + TypeScript | Cohérent avec le BO |
| Build | Vite | Cohérent avec le BO |
| Style | Tailwind CSS v4 + tokens CSS du BO | Cohérence visuelle |
| PWA | `vite-plugin-pwa` | Plugin officiel Vite, gère manifest + service worker |
| Données | Supabase JS v2 (même instance que le BO, clé `anon`) | Pas de nouveau back |
| Realtime | Supabase Realtime (canal `live_matches`) | Déjà anticipé dans la spec Live Score |
| Navigation | React Router v7 | Cohérent avec le BO |
| Fetching | TanStack Query v5 (`@tanstack/react-query`) | Cache, refetch auto, états loading/error |
| Markdown | `react-markdown` | Rendu des descriptions et contenus Actus/Events |

### Déploiement (Vercel — deux projets, un seul repo)

| Projet Vercel | Root Directory | Description |
|---|---|---|
| `tmc-bo` (existant) | `/` | Back-office admin |
| `tmc-pwa` (à créer) | `pwa/` | PWA publique |

Configuration dans le dashboard Vercel du projet PWA : **Settings → General → Root Directory → `pwa/`**

Variables d'environnement à configurer sur le projet Vercel PWA :
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## Prérequis Supabase avant de démarrer le dev

### 1. Créer la table `actus`

Voir `docs/specs/ACTUS.md` pour le détail complet. Migration à exécuter dans le dashboard Supabase :

```sql
CREATE TABLE actus (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  titre        TEXT        NOT NULL,
  contenu      TEXT        NOT NULL,
  image_url    TEXT,
  published    BOOLEAN     NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TRIGGER actus_updated_at
  BEFORE UPDATE ON actus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE actus ENABLE ROW LEVEL SECURITY;
```

### 2. Policies RLS — lecture publique (rôle `anon`)

```sql
-- Actus : publiques uniquement (brouillons invisibles depuis la PWA)
CREATE POLICY "actus_anon_select"
  ON actus FOR SELECT TO anon USING (published = true);

-- Actus : admins voient tout (brouillons inclus)
CREATE POLICY "actus_authenticated_select"
  ON actus FOR SELECT TO authenticated USING (true);
CREATE POLICY "actus_insert"
  ON actus FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "actus_update"
  ON actus FOR UPDATE TO authenticated USING (true);
CREATE POLICY "actus_delete"
  ON actus FOR DELETE TO authenticated USING (true);

-- Events : lecture publique (actuellement restreinte à authenticated)
CREATE POLICY "events_anon_select"
  ON events FOR SELECT TO anon USING (true);

-- Live matches : lecture publique (actuellement restreinte à authenticated)
CREATE POLICY "live_matches_anon_select"
  ON live_matches FOR SELECT TO anon USING (true);
```

### 3. Supabase Realtime

Activer Realtime sur `live_matches` depuis le dashboard : Table Editor → `live_matches` → Enable Realtime.
(Si ce n'est pas déjà fait — voir spec LIVE_SCORE.md)

### 4. Bucket `actu-images`

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('actu-images', 'actu-images', true);

CREATE POLICY "actu_images_read"
  ON storage.objects FOR SELECT USING (bucket_id = 'actu-images');
CREATE POLICY "actu_images_write"
  ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'actu-images');
CREATE POLICY "actu_images_delete"
  ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'actu-images');
```

---

## Types TypeScript

Copier les types suivants depuis `../src/types.ts` du BO dans `pwa/src/types.ts` :
`ClubEvent`, `EventType`, `LiveMatch`, `LiveMatchStatus`, `LiveMatchType`, `LiveSet3Format`, `LiveMatchWinner`

Ajouter le nouveau type `Actu` :

```ts
export interface Actu {
  id: string;
  titre: string;
  contenu: string;           // Markdown
  image_url: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## Design system

### Couleurs

Copier `src/index.css` du BO dans `pwa/src/index.css` (tokens CSS identiques). Palette :

| Token CSS | Valeur hex | Usage |
|---|---|---|
| `--primary` | `#e51828` | Couleur principale, CTA, badges |
| `--secondary` | `#f1818a` | Accents, hovers |
| `--accent` | `#f9c9cd` | Fonds légers |
| `--background` | `~#ffffff` | Fond principal |

### Typographie

Police **Manrope** — importer depuis Google Fonts dans `pwa/index.html` :
```html
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### Composants spécifiques mobile

- **BottomNav** : `position: fixed; bottom: 0` — hauteur 56px + `padding-bottom: env(safe-area-inset-bottom)` pour iPhone
- **AppHeader** : logo CAC Tennis + nom "CAC Tennis", hauteur 56px, fond blanc, ombre légère
- **Cartes** : `rounded-xl`, ombre légère (`shadow-sm`), zone de tap minimum 44px
- **Badge LIVE** : fond rouge `#e51828`, texte blanc, animation `pulse` CSS
- **États de chargement** : skeleton cards (pas de spinner générique)
- **Layout** : `padding-top: 56px` (header) + `padding-bottom: 70px` (bottom nav) sur le contenu principal

---

## Fonctionnalités — v1

### Navigation

```
[ Actus ]   [ Événements ]   [ Matches ]
        ← bottom navigation →
```

Route racine `/` → redirige vers `/actus`.

---

### Onglet Actus — `/actus`

**Source de données** : table `actus`, filtre `published = true`

**Page liste (`ActusPage.tsx`)** :
- Flux vertical de cartes triées par `published_at` DESC
- Chaque carte : image (si présente), titre, extrait du contenu (2-3 lignes tronquées), date de publication formatée
- Clic → page de détail `/actus/:id`
- Pagination : bouton "Voir plus" (load more, pas de pagination classique)
- État vide : message "Aucune actualité pour l'instant"

**Page détail (`ActuDetailPage.tsx`)** :
- Titre, image full-width (si présente), date, contenu Markdown rendu via `react-markdown`
- Bouton retour vers `/actus`

**Requête Supabase** :
```ts
const { data } = await supabase
  .from('actus')
  .select('*')
  .eq('published', true)
  .order('published_at', { ascending: false })
  .range(offset, offset + 9);
```

---

### Onglet Événements — `/evenements`

**Source de données** : table `events`

**Page liste (`EventsPage.tsx`)** :
- Uniquement les événements à venir :
  - Si `date_fin` renseignée → `date_fin >= now()`
  - Sinon → `date_debut >= now()`
- Tri par `date_debut` ASC (le prochain en premier)
- Chaque carte : badge type coloré, titre, dates formatées, image (si présente), prix (ou "Gratuit")
- Clic → page de détail `/evenements/:id`
- État vide : message "Aucun événement à venir"

**Page détail (`EventDetailPage.tsx`)** :
- Toutes les infos, description Markdown rendue via `react-markdown`
- Bouton retour vers `/evenements`

**Requête Supabase** (filtre date_fin géré côté client pour la logique OR) :
```ts
const { data } = await supabase
  .from('events')
  .select('*')
  .order('date_debut', { ascending: true });
// Filtrer côté client : garder si (date_fin && date_fin >= now) || (!date_fin && date_debut >= now)
```

**Couleurs des badges par type** (cohérent avec le BO) :
- Animation → bleu
- Tournoi → violet
- Match par équipe → vert
- Sortie → orange
- Soirée → rose

---

### Onglet Matches — `/matches`

**Source de données** : table `live_matches`, Supabase Realtime

**Page (`MatchesPage.tsx`)** :
- Affiche : matches du jour (`match_date = today`) + matchs à venir (`match_date > today`), status ≠ `finished`
- Exception : les matches `finished` du jour restent affichés (retirés à minuit)
- Tri : matches `live` en premier (mis en évidence), puis par `match_date` + `start_time` ASC
- Realtime : s'abonner aux changements de `live_matches` → refetch automatique via React Query (`invalidateQueries`)

**Carte match (`MatchCard.tsx`)** :
- Status `live` → badge "LIVE" animé (pulse rouge), score affiché set par set, carte mise en évidence (bordure rouge ou fond légèrement coloré)
- Status `pending` → heure prévue, joueurs, "Commence à HH:MM"
- Status `finished` → score final, badge "Terminé"
- Double : afficher "Équipe 1 : Prenom Nom / Prenom Nom" vs "Équipe 2 : ..."

**Realtime** :
```ts
useEffect(() => {
  const channel = supabase
    .channel('live_matches_pwa')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_matches' }, () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [queryClient]);
```

**Requête Supabase** :
```ts
const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
const { data } = await supabase
  .from('live_matches')
  .select('*')
  .gte('match_date', today)
  .order('match_date', { ascending: true })
  .order('start_time', { ascending: true });
// Filtrer côté client : exclure finished dont match_date < today
```

---

## Structure de fichiers

```
pwa/
├── public/
│   └── icons/
│       ├── icon-192.png        # Généré depuis le logo PNG CAC Tennis
│       └── icon-512.png        # Généré depuis le logo PNG CAC Tennis
├── src/
│   ├── lib/
│   │   └── supabase.ts         # Client Supabase (clé anon publique)
│   ├── types.ts                # Types partagés (copiés/adaptés depuis le BO)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppHeader.tsx   # Header avec logo + "CAC Tennis"
│   │   │   └── BottomNav.tsx   # Navigation bas de page — 3 onglets
│   │   ├── actus/
│   │   │   └── ActuCard.tsx    # Carte d'une actu dans la liste
│   │   ├── events/
│   │   │   └── EventCard.tsx   # Carte d'un événement dans la liste
│   │   └── matches/
│   │       ├── MatchCard.tsx   # Carte d'un match (pending/live/finished)
│   │       └── LiveBadge.tsx   # Badge animé "LIVE"
│   ├── pages/
│   │   ├── ActusPage.tsx       # Liste des actus avec load more
│   │   ├── ActuDetailPage.tsx  # Détail d'une actu (markdown rendu)
│   │   ├── EventsPage.tsx      # Liste des événements à venir
│   │   ├── EventDetailPage.tsx # Détail d'un événement (markdown rendu)
│   │   └── MatchesPage.tsx     # Matches du jour + à venir, realtime
│   ├── App.tsx                 # Router + layout (Header + BottomNav + <Outlet>)
│   ├── main.tsx                # Point d'entrée
│   └── index.css               # Tokens CSS du BO + ajouts mobile (safe-area, etc.)
├── index.html                  # Import Manrope + meta PWA
├── package.json
├── vite.config.ts              # Inclut vite-plugin-pwa
├── tailwind.config.js
└── tsconfig.json
```

---

## Configuration vite-plugin-pwa

Dans `vite.config.ts` :

```ts
import { VitePWA } from 'vite-plugin-pwa';

VitePWA({
  registerType: 'autoUpdate',
  manifest: {
    name: 'CAC Tennis',
    short_name: 'CAC Tennis',
    description: "L'application du club CAC Tennis",
    theme_color: '#e51828',
    background_color: '#ffffff',
    display: 'standalone',
    start_url: '/',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    runtimeCaching: [
      {
        // Cache des appels Supabase REST (stale-while-revalidate)
        urlPattern: ({ url }) => url.hostname.includes('supabase.co'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'supabase-api', expiration: { maxAgeSeconds: 60 * 5 } },
      },
    ],
  },
})
```

---

## Dépendances (`pwa/package.json`)

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.0.0",
    "@tanstack/react-query": "^5.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0",
    "vite-plugin-pwa": "^0.21.0"
  }
}
```

---

## Ordre d'implémentation recommandé

1. **Supabase** : exécuter les migrations SQL (table `actus`, policies RLS anon, bucket `actu-images`), activer Realtime sur `live_matches`
2. **Module Actus BO** : implémenter `docs/specs/ACTUS.md` pour avoir des données de test
3. **PWA setup** : init Vite dans `/pwa`, installer les dépendances, copier les tokens CSS, configurer `vite-plugin-pwa`
4. **PWA layout** : `AppHeader` + `BottomNav` + routing React Router
5. **Onglet Matches** : prioritaire — valide le Realtime + toute la chaîne Supabase `anon`
6. **Onglet Événements** : lecture simple
7. **Onglet Actus** : lecture simple + page détail
8. **Icônes PWA** : redimensionner le logo PNG en 192×192 et 512×512, placer dans `pwa/public/icons/`
9. **Déploiement Vercel** : créer le projet `tmc-pwa`, pointer Root Directory sur `pwa/`, configurer les variables d'env

---

## Évolutions futures (hors scope v1 — ne pas implémenter)

- Notifications push (service worker déjà prêt via `vite-plugin-pwa`)
- Auth admin dans la PWA pour la saisie du live score
- Publication automatique des actus sur Facebook (via Supabase Edge Function + Graph API)
- Trombinoscope des joueurs du club
- Gestion du bar
- Inscription aux événements depuis la PWA
