# Spec — Module Events

> Statut : prêt pour intégration
> Dernière mise à jour : 2026-11-10

---

## Objectif

Permettre aux admins de créer, modifier, supprimer et dupliquer des événements depuis le backoffice. À terme, les événements seront servis via un flux JSON authentifié à une webapp publique.

---

## Scope de cette spec

- Interface backoffice CRUD (liste + formulaire)
- Stockage Supabase (DB + Storage)
- Flux JSON (endpoint de lecture, authentifié)

Hors scope pour l'instant : la webapp publique de consommation.

---

## Intégration dans l'app

- Nouvelle carte sur `AppHomePage` (3ème carte) → label **"Événements"**, description **"Créer et gérer les événements du club."**
- Route : `/events`
- Layout : header propre à la page, même pattern que les pages existantes
- Page principale : `src/pages/EventsPage.tsx`

---

## Modèle de données

### Type TypeScript

```ts
export type EventType = 'Animation' | 'Tournoi' | 'Sortie' | 'Soirée';

export interface ClubEvent {
  id: string;                  // UUID généré par Supabase
  type: EventType;
  titre: string;
  description: string;         // Contenu Markdown
  date_debut: string;          // ISO 8601 avec timezone (ex: "2026-06-15T14:00:00+02:00")
  date_fin: string | null;     // Obligatoire si type === 'Tournoi', sinon optionnel
  image_url: string | null;    // URL publique Supabase Storage (optionnelle)
  prix: number | null;         // En euros. null ou 0 = gratuit
  created_at: string;          // Géré par Supabase
  updated_at: string;          // Géré par Supabase (trigger)
}
```

> **Note** — Le type `'Match par équipe'` n'existe plus côté BO. La génération
> d'affiche des rencontres à venir a été déplacée dans le module **Matches par
> équipe** (`/team-matches`, voir `TEAM_MATCHES.md`). La colonne `team_matches`
> (migration `20260515_event_team_matches.sql`) reste en base pour les données
> historiques mais n'est plus lue ni écrite par le BO.

### Règles de validation

| Champ | Obligatoire | Contrainte |
|---|---|---|
| `type` | Oui | Parmi les 4 valeurs de l'enum |
| `titre` | Oui | Non vide |
| `description` | Oui | Non vide, Markdown |
| `date_debut` | Oui | Datetime (date + heure) |
| `date_fin` | Conditionnel | **Obligatoire si `type === 'Tournoi'`**, optionnel sinon. Doit être > `date_debut` si renseignée. |
| `image_url` | Non | JPEG ou PNG, max 5 Mo |
| `prix` | Non | Nombre positif ou nul. `null` ou `0` → afficher "Gratuit" |

---

## Infrastructure Supabase

### 1. Table `events` — SQL de migration

```sql
CREATE TABLE events (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  type        TEXT        NOT NULL CHECK (type IN ('Animation', 'Tournoi', 'Match par équipe', 'Sortie', 'Soirée')),
  titre       TEXT        NOT NULL,
  description TEXT        NOT NULL,
  date_debut  TIMESTAMPTZ NOT NULL,
  date_fin    TIMESTAMPTZ,
  image_url   TEXT,
  prix        NUMERIC(10, 2) CHECK (prix >= 0),
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Lecture, écriture, modification, suppression : authentifié uniquement
CREATE POLICY "events_select" ON events FOR SELECT TO authenticated USING (true);
CREATE POLICY "events_insert" ON events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "events_update" ON events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "events_delete" ON events FOR DELETE TO authenticated USING (true);
```

### 2. Supabase Storage — bucket `event-images`

- **Visibilité** : publique (les URLs d'images sont accessibles sans auth pour l'affichage)
- **Formats acceptés** : `image/jpeg`, `image/png`
- **Taille max** : 5 Mo
- **Nommage** : `{uuid-event}/{timestamp}-{nom-fichier-sanitizé}.{ext}`
- **À créer via le dashboard Supabase** ou via migration SQL :

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true);

CREATE POLICY "event_images_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'event-images');

CREATE POLICY "event_images_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-images');

CREATE POLICY "event_images_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'event-images');
```

---

## Interface backoffice

### Page liste — `EventsPage.tsx`

**Comportement par défaut :**
- Affiche les événements à venir
  - Critère "à venir" : si `date_fin` est renseignée → `date_fin >= now()` ; sinon → `date_debut >= now()`
- Triés par `date_debut` **ASC** (le prochain en premier)
- Pagination : **10 événements par page**

**Toggle "Voir les événements passés" :**
- Bouton/switch discret en haut de liste
- Quand activé : affiche les événements passés (critère inversé), triés par `date_debut` **DESC**
- Pagination identique (10/page)

**Carte événement — informations affichées :**
- Badge type (coloré selon le type)
- Titre
- Date début (+ date fin si présente)
- Prix (ou "Gratuit")
- 3 actions : **Modifier** | **Dupliquer** | **Supprimer**

**Suppression :**
- Confirmation avant suppression (modale ou `window.confirm`)
- Si `image_url` est renseignée : supprimer aussi le fichier du bucket Supabase Storage

**Duplication :**
- Crée une copie avec :
  - Titre : `"Copie de [titre original]"`
  - Dates : copiées telles quelles
  - Tous les autres champs copiés (y compris `image_url`)
- Redirige immédiatement vers le formulaire d'édition du doublon

**Bouton "Créer un événement" :** en haut à droite → redirige vers `/events/new`

---

### Formulaire création/édition — `EventForm.tsx`

- Création : route `/events/new`
- Édition : route `/events/:id/edit`

**Champs du formulaire :**

| Champ | Composant | Notes |
|---|---|---|
| Type | `<select>` | 4 valeurs de l'enum |
| Titre | `<input type="text">` | |
| Description | Textarea + onglet Aperçu | Voir section Markdown ci-dessous |
| Date début | `<input type="datetime-local">` | |
| Date fin | `<input type="datetime-local">` | Toujours visible ; marqué **obligatoire** si type = "Tournoi" |
| Image | Input file + aperçu + bouton supprimer | JPEG/PNG, max 5 Mo |
| Prix | `<input type="number" min="0" step="0.01">` | Placeholder "Laisser vide si gratuit" |

**Éditeur Markdown (description) :**
- Deux onglets : **Écrire** / **Aperçu**
- L'onglet Aperçu rend le Markdown en HTML via `react-markdown`
- Formatage supporté (à documenter dans le placeholder) : gras `**texte**`, italique `*texte*`, listes `- item`, titres `# Titre`
- Pas d'éditeur WYSIWYG — simple `<textarea>` + preview

**Upload image :**
1. L'utilisateur sélectionne un fichier → aperçu local immédiat via `URL.createObjectURL`
2. À la **soumission** du formulaire (pas avant) : upload vers Supabase Storage → récupère l'URL publique → stocke dans `image_url`
3. Si une image existait (cas édition) : supprimer l'ancienne du bucket avant d'uploader la nouvelle
4. Bouton "Supprimer l'image" : vide le champ et supprime du bucket si déjà uploadée

**Notification push** (29/10/2026) : en création uniquement, case « Envoyer une notification aux membres du club », **cochée par défaut**. Après l'enregistrement (image comprise), appel à la RPC `content_push_announce` (`kind = 'event'`), sans bloquer en cas d'échec. Voir `docs/CONTENT_PUSH.md`.

**Validation côté client (avant soumission) :**
- Afficher les erreurs inline sous chaque champ
- Bloquer si `date_fin` absent et `type === 'Tournoi'`
- Bloquer si `date_fin` < `date_debut`
- Bloquer si fichier image > 5 Mo ou format non supporté

> La génération d'affiche des rencontres à venir vit désormais dans le module
> **Matches par équipe** (`/team-matches`) — voir `TEAM_MATCHES.md`.

---

## Flux JSON (lecture)

> Disponible dès l'implémentation via le client Supabase, consommable par la future webapp.

**Authentification requise** : oui (JWT Supabase). La future webapp devra s'authentifier — le mécanisme exact (utilisateur public dédié ou autre) sera défini lors de l'implémentation webapp.

**Requête type :**
```ts
// Events à venir, triés par date, paginés
const { data } = await supabase
  .from('events')
  .select('*')
  .gte('date_debut', new Date().toISOString())
  .order('date_debut', { ascending: true })
  .range(0, 9);
```

**Format de réponse** : tableau d'objets `ClubEvent`. Le champ `description` est en Markdown brut — la webapp est responsable du rendu HTML.

---

## Arborescence de fichiers à créer

```
src/
  pages/
    EventsPage.tsx       # Page liste avec pagination et toggle passé/à venir
  components/
    EventForm.tsx        # Formulaire création/édition
    EventCard.tsx        # Carte d'un event dans la liste
  types.ts               # Ajouter ClubEvent et EventType (dans le fichier existant)
```

## Routes à ajouter dans `App.tsx`

```tsx
<Route path="/events"          element={auth(<EventsPage />)} />
<Route path="/events/new"      element={auth(<EventForm />)} />
<Route path="/events/:id/edit" element={auth(<EventForm />)} />
```

---

## Dépendances à ajouter

| Package | Usage |
|---|---|
| `react-markdown` | Rendu Markdown dans l'onglet Aperçu du formulaire |

---

## Notes d'implémentation

- Utiliser le client Supabase existant (`src/lib/supabase.ts`) — pas de nouveau client
- Pas de state management global — state local React dans `EventsPage` et `EventForm`
- Pas de `useLocalStorage` pour les events (tout passe par Supabase)
- Avant de commencer : créer la table `events` et le bucket `event-images` dans le dashboard Supabase

---

## Interface PWA

> Consommé par `pwa/src/pages/EventsPage.tsx` et `pwa/src/pages/EventDetailPage.tsx`.

### Policy RLS (versionnée dans `2026110802_events_anon_select.sql`)

Créée à la main en prod à l'origine, absente de la base de dev jusqu'au 08/11/2026.

```sql
CREATE POLICY "events_anon_select"
  ON events FOR SELECT TO anon USING (true);
```

### Requête Supabase (rôle `anon`)

```ts
const { data } = await supabase
  .from('events')
  .select('*')
  .order('date_debut', { ascending: true });
// Filtrer côté client : garder si (date_fin && date_fin >= now) || (!date_fin && date_debut >= now)
```

### Pages

**`EventsPage.tsx`** — uniquement les événements à venir (filtre client sur `date_debut` / `date_fin`), triés par `date_debut` ASC. Chaque carte : badge type coloré, titre, dates, image (si présente), prix (ou "Gratuit"). État vide : "Aucun événement à venir".

**`EventDetailPage.tsx`** — toutes les infos, `description` Markdown rendu via `react-markdown` + `rehype-raw` (pour le `<u>` du MarkdownEditor). Bouton retour vers `/evenements`.

### Badges par type (cohérent avec le BO)

| Type | Couleur |
|---|---|
| Animation | Bleu |
| Tournoi | Violet |
| Match par équipe | Vert |
| Sortie | Orange |
| Soirée | Rose |


## Inscriptions (07/11/2026)

Migrations `supabase/migrations/2026110701_event_registrations.sql` et
`2026110702_event_admin_remove_booking.sql` (suppression d'un groupe),
`2026110801_event_registrations_sans_compte.sql` (groupes de personnes sans compte),
`2026111001_event_sections.sql` (sections, voir plus bas). Paiement hors périmètre ;
pas de liste d'attente ni de notification liée aux inscriptions.

### Réglages par événement (formulaire BO, section « Inscriptions »)

| Colonne `events` | Défaut | Règle |
|---|---|---|
| `registration_enabled` | `false` | Inscription en ligne depuis la PWA. Désactivée : seul le BO inscrit. |
| `registration_max_per_member` | `1` | Places max **par réservation**, le titulaire compris (1–50). |
| `registration_capacity` | `null` | Jauge totale, toutes réservations confondues. `null` = illimitée. Atteinte = complet. |
| `registration_deadline` | `null` | Clôture des inscriptions **et** désinscriptions en ligne. `null` = début de l'événement. Doit précéder `date_debut`. |

La duplication d'un événement copie ces réglages, pas les inscriptions.

### Modèle

- `event_bookings` : une réservation par titulaire (membre) et événement. `owner_id` est `NULL`
  pour un **groupe saisi par un admin sans titulaire** (personnes sans compte) ; ces groupes ne
  sont jamais fusionnés entre eux.
- `event_participants` : les places d'une réservation — le titulaire, d'autres membres
  (inscrits d'office) ou des personnes **sans compte** (prénom + nom, `is_guest`) : invités d'un
  membre ou personnes saisies par un admin, sans distinction membre / extérieur (inutile tant que
  le paiement est hors périmètre). Un membre avec compte n'occupe qu'une place par événement,
  toutes réservations confondues.
- Une personne sans compte ne peut pas s'inscrire elle-même : seul un admin l'inscrit.
- Tables sans aucun droit direct : tout passe par des RPC `SECURITY DEFINER` qui verrouillent
  la ligne `events` (jauge et doublons sérialisés).

### Règles

| Action | Qui | Contrôles |
|---|---|---|
| `event_registration_state(club, event)` | public | Renvoie réglages, `open`, `closes_at`, places prises, `is_member`, `is_admin` et la réservation de l'appelant. Un membre inscrit par un autre ne voit que le nom du titulaire (`owner_name` `NULL` pour un groupe sans titulaire → « inscrit par le club »). |
| `event_member_save(club, event, members[], guests[])` | membre | Crée ou **remplace** sa réservation. Inscription ouverte, quota par réservation, jauge (ses places actuelles déduites), personnes déjà inscrites ailleurs → `ALREADY_REGISTERED` (noms en `details`). Un membre déjà inscrit par un autre ne peut pas créer sa propre réservation sans se désinscrire. |
| `event_member_cancel(club, event)` | membre | Inscription ouverte. Titulaire → annule toute la réservation ; inscrit par un autre → retire sa seule place (le groupe vide est supprimé). |
| `event_admin_bookings(club, event)` | admin | Liste des réservations et de leurs places. |
| `event_admin_add(club, event, owner, members[], guests[{prenom,nom,member}])` | admin | **Ajoute** à la réservation du titulaire (créée si besoin). `owner` `NULL` → nouveau groupe sans titulaire (au moins une personne). Ignore l'ouverture, la clôture et le quota par réservation ; la jauge s'applique. |
| `event_admin_remove(club, participant)` | admin | Retire une place ; retirer le titulaire ou la dernière personne annule la réservation. |
| `event_admin_remove_booking(club, booking)` | admin | Supprime une réservation entière (titulaire + toutes ses places) en une fois. |

Codes d'erreur : `NOT_MEMBER`, `NOT_FOUND`, `REGISTRATION_CLOSED`, `QUOTA_EXCEEDED`, `EVENT_FULL`,
`ALREADY_REGISTERED`, `NOT_REGISTERED`, `VALIDATION_ERROR`, `FORBIDDEN`.

### Écrans

- **BO** : bouton **Inscrits** sur chaque carte → `/events/:id/registrations`
  (`EventRegistrationsPage`) : compteur de places, réservations, retrait d'une personne ou
  de toute une réservation (« Supprimer la réservation », dès 2 places), ajout manuel via un **champ
  unique** : il propose les membres avec compte trouvés et, pour le texte saisi, « sans compte »
  (prénom = premier mot, modifiable). Le premier membre avec compte
  ajouté devient titulaire (sa réservation existante est complétée) ; sans aucun, le groupe
  n'a pas de titulaire. Une réservation d'une seule place s'affiche sur une ligne, sans titre.
- **PWA** : bloc « Inscription » sur `EventDetailPage` (`components/events/EventRegistration.tsx`) :
  places restantes (si jauge), date limite, bouton « S'inscrire » (visiteur → connexion,
  non-membre → message), éditeur de réservation (membres par recherche, invités, compteur
  `n / max`), « Modifier » et « Me désinscrire » jusqu'à la clôture.
- **PWA, admin du club** (`is_admin`) : le bloc s'affiche même sans inscription en ligne ;
  bouton « Voir les inscrits (n) » (`components/events/EventAdminRegistrations.tsx`) → liste
  des réservations, retrait d'une personne (confirmation ; retirer le titulaire annule sa
  réservation), suppression d'un groupe entier (réservations de 2 places et plus) et ajout manuel
  avec le même champ unique que le BO (`MemberPicker` avec `onPickNamed`), via les mêmes RPC admin. Une réservation d'une seule place tient sur une ligne.

### Sections (10/11/2026)

Migration `2026111001_event_sections.sql`. Un événement peut se découper en plusieurs temps
(ex. soirée pickleball : animation avec jauge, puis repas sans jauge). Sans section, rien ne change.

- **`event_sections`** : `titre`, `position` (ordre), `heure_debut` (optionnel), `prix` (optionnel,
  vide = gratuit), `capacity` (jauge de la section, `null` = illimitée). Lecture publique (club
  actif), écriture admin/manager (`can_manage_club_content`) avec un `event_id` du même club.
  Édition dans le formulaire BO (bloc « Sections » : ajout, ordre ↑↓, retrait). La duplication
  d'un événement copie ses sections.
- **Prix** : `events.prix` reste le prix de l'événement **complet**, affiché dans les listes ;
  il est saisi par l'admin, pas calculé. Chaque section affiche son propre prix sur la fiche PWA.
- **Choix par personne** : table privée `event_participant_sections (participant_id, section_id)`.
  **Aucune ligne = tout l'événement**, y compris les sections ajoutées plus tard. Cocher toutes
  les sections revient au même (rien n'est stocké). Au moins une section par personne.
- **Jauges** : la jauge totale `registration_capacity` s'applique toujours au nombre de
  personnes. La jauge d'une section compte les personnes inscrites à tout l'événement et celles
  qui l'ont choisie ; elle est contrôlée (admin compris) pour chaque section où la réservation
  enregistrée a au moins une place → `SECTION_FULL` (titre de la section en `details`).
- **Suppression d'une section** : refusée (23503, message dans le BO) si une personne l'a
  choisie explicitement. Supprimer l'événement reste possible.
- **Pas de date de clôture par section** : celle de l'événement s'applique. Les sections se
  modifient jusqu'à la clôture via « Modifier » (contrôle de jauge à chaque fois).

RPC :

| RPC | Changement |
|---|---|
| `event_registration_state` | + `sections[]` (`id`, `titre`, `heure_debut`, `prix`, `capacity`, `taken`) ; chaque place du titulaire porte `sections` (`null` = tout) ; un inscrit par un autre reçoit ses `sections`. |
| `event_member_save(club, event, members[], guests[], member_sections)` | `member_sections` optionnel : `{ user_id: [section ids] \| null }` (le membre lui-même compris) ; chaque invité peut porter `sections`. Absent → tout l'événement (compatibilité avec une PWA pas à jour). |
| `event_admin_add(…, member_sections)` | Idem pour les personnes ajoutées ; les places existantes de la réservation gardent leurs sections. |
| `event_admin_bookings` | Chaque place porte `sections`. |

Nouveaux codes d'erreur : `SECTION_FULL`, `SECTION_REQUIRED` (liste vide), `VALIDATION_ERROR`
(section d'un autre événement).

Écrans :
- **BO, page Inscrits** : filtre par section avec le compteur de chacune (`n / jauge`), badge des
  sections choisies sur chaque personne qui ne vient pas à tout, choix des sections par personne
  à l'ajout.
- **PWA** : programme des sections (heure, prix, places restantes ou « complet ») dans le bloc
  « Inscription » ; dans l'éditeur, cases à cocher par personne (vous, membres, invités). Une
  nouvelle personne est pré-cochée sur les sections qui ont encore de la place. « Complet »
  quand plus aucune section n'a de place. « Modifier » est proposé dès que l'événement a des
  sections, même à 1 place par réservation. Le panneau admin affiche le compteur par section et
  le choix par personne à l'ajout.
- Un membre inscrit par un autre voit ses sections mais ne peut pas les changer (c'est le
  titulaire qui gère sa réservation).

### Limites connues

- Un membre retiré du club garde ses inscriptions (pas de nettoyage automatique).
- La recherche de membres réutilise `team_member_search` (module Matches par équipe).

Tests : `npm run test:event-registrations` (PGlite).

## Correctif sécurité — audit du 05/09/2026

Le rendu éditorial utilise `rehype-raw` puis `rehype-sanitize` avec une liste
contrôlée de balises/attributs. Le soulignement `<u>` de l'éditeur est conservé ;
styles, scripts, formulaires et contenus embarqués actifs sont supprimés dans
l'aperçu BO et les détails PWA. Les liens, listes, images et légendes sont conservés.
Le contrat réside dans les deux copies de `src/lib/markdown.ts` (BO et PWA),
validées avec les dépendances propres à chaque application.
