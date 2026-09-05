# MULTI_TENANT.md — Passage en architecture multi-tenant (SaaS)

> **Statut : en cours — PR1 à PR7-bis livrées (cf. tableau « Découpage en PR » ci-dessous).**
> Document maître. À lire avant d'attaquer n'importe quelle phase ci-dessous.
> Chaque phase fera l'objet de son propre brief dans `docs/briefs/` au moment de l'implémentation.
> Source : `docs/briefs/multi_tenant_archi.md` (vision) + `docs/briefs/web_site_brief.md` (site vitrine).

---

## 0. TL;DR

On transforme l'app mono-club actuelle (CAC Tennis) en produit SaaS où l'on peut
**instancier plusieurs clubs**. Chaque club dispose de trois surfaces : un **back-office**
(existe), une **PWA adhérents** (existe), et un **site vitrine public** (à construire).

L'architecture retenue est **pooled multi-tenant** : une seule base Supabase, une seule
instance de chaque app, isolation logique par `club_id` + RLS. Le club courant est résolu
**au runtime** à partir du sous-domaine, sous le domaine racine **`feelike.app`**. On
provisionne les clubs depuis une **console super-admin**. On démarre progressivement :
d'abord le **socle multi-tenant sur l'existant**, le site vitrine ensuite.

---

## 1. Décisions d'architecture (validées)

| # | Décision | Choix retenu |
|---|---|---|
| D1 | **Isolation des données** | Base Supabase **partagée**, colonne `club_id` sur chaque table métier, isolation par **RLS**. Onboarding = créer une ligne `clubs`. |
| D2 | **Déploiement des apps** | **Apps partagées uniques** (un seul BO, un seul PWA, un seul site vitrine). Le tenant est résolu au runtime, pas au build. |
| D3 | **Domaines** | Domaine racine **`feelike.app`**. **Sous-domaine automatique** par club (ex. `cac-tennis.feelike.app`). **Custom domain** par club supporté par l'archi (colonne `clubs.custom_domain`), activé en phase ultérieure. |
| D4 | **Provisioning** | **Super-admin** crée les clubs via une console dédiée. Pas de signup public ni de billing au V1. |
| D5 | **Membership** | Table d'appartenance `club_members (user_id, club_id, role)`. Un compte peut appartenir à **plusieurs** clubs. |
| D6 | **Premier jalon** | **Socle multi-tenant sur l'existant** (BO + PWA) avant le site vitrine. |
| D7 | **Formulaire de contact vitrine** | **Email au club** via Edge Function + **Brevo** (provider FR/EU, argument RGPD) **+ copie en base** pour historique. |
| D9 | **Schéma de sous-domaines** | Vitrine = `<slug>.feelike.app` · PWA = `app-<slug>.feelike.app` (URL ~invisible une fois installée sur l'écran d'accueil) · BO = `admin.feelike.app` (console globale + sélecteur de club). |
| D10 | **Secrets sociaux par club** | Table dédiée `club_social_credentials`, **RLS admin-only** (jamais `anon`/`manager`/PWA/vitrine), lue par l'Edge Function via **service role**. |
| D11 | **`club_id` sur tables filles** | **Colonne `club_id` dénormalisée partout** (y c. `team_match_lines`) → patron RLS uniforme et performant. |
| D12 | **Stockage des images** | Buckets **par type de contenu** (peu nombreux), chemins **préfixés `club_id/`**, écritures scopées au club, lecture publique pour le contenu public. |
| D8 | **Données CAC Tennis** | **Migrées en place** : backfill d'un `club_id` sur tout l'existant. CAC devient le club #1. |

Hypothèses implicites de ces choix :
- On **repart de la codebase actuelle** (pas de rewrite from scratch).
- **Pas de billing/paiement** au V1 (super-admin provisionne manuellement).
- Isolation **logique** (RLS), pas physique — acceptée pour le V1. Une bascule silo d'un
  gros client reste possible plus tard sans renier ce socle.

---

## 2. Modèle de données multi-tenant

### 2.1 Nouvelles tables socle

```
clubs
  id            uuid pk
  slug          text unique         -- sous-domaine : "cac-tennis"
  name          text                -- "CAC Tennis Club"
  sport         text default 'tennis'  -- préparé pour D'AUTRES SPORTS (vision long terme)
  status        text                -- 'active' | 'suspended'
  custom_domain text null           -- réservé à une phase ultérieure
  created_at    timestamptz
  updated_at    timestamptz

club_members
  id        uuid pk
  club_id   uuid fk -> clubs(id)
  user_id   uuid fk -> auth.users(id)
  role      club_role              -- enum: 'admin' | 'manager' | 'member'
  created_at timestamptz
  unique (club_id, user_id)

club_settings                      -- config du site vitrine + réglages tenant (cf. §6)
  club_id   uuid pk fk -> clubs(id)
  config    jsonb                  -- arbre des ~80 variables vitrine (brand.*, home.*, …)
  updated_at timestamptz
```

> Le **super-admin** n'est pas un rôle dans `club_members` : c'est un flag global porté
> par le profil (ex. `profiles.is_super_admin boolean default false`) ou une table
> `super_admins`. Il court-circuite la RLS par club (cf. §4).

### 2.2 Tables métier existantes → ajout de `club_id`

Toutes les tables métier reçoivent une colonne `club_id uuid not null references clubs(id)` :

`events`, `live_matches`, `actus`, `profiles` (lien d'appartenance via `club_members`),
`team_saisons`, `team_competitions`, `team_equipes`, `team_etapes`, `team_rencontres`,
`team_match_lines`.

> ⚠️ **Vérifier chaque table avant** d'ajouter la colonne : lire la dernière migration qui
> la concerne (cf. `docs/CODEBASE.md` › Infrastructure Supabase), pas les types TypeScript.

**Décision D11 — `club_id` dénormalisé partout, y compris sur les tables filles.** Pour
`team_match_lines`, on ne déduit **pas** le club via la rencontre parente : on pose une
colonne `club_id` directe (égale à celle de la rencontre, fixée à la création, immuable).
Objectif : un **patron RLS unique et identique** sur toutes les tables (sécurité plus sûre,
policies plus simples, meilleures perfs). Ce principe s'applique à toutes les tables filles.

La persistance **TMC Planner** vit en `localStorage` (pas en base) : pas de `club_id` requis
côté données, mais la **clé localStorage devra être préfixée par `club_id`** pour éviter
qu'un gestionnaire multi-clubs mélange ses plannings (cf. `hooks/useLocalStorage.ts`).

### 2.3 RLS — patron multi-tenant

Helper SQL réutilisable :

```sql
-- clubs auxquels l'utilisateur courant appartient
create or replace function auth_club_ids() returns setof uuid
  language sql stable security definer as $$
    select club_id from public.club_members where user_id = auth.uid()
  $$;
```

Patron de policy `authenticated` sur une table métier :

```sql
create policy tenant_isolation on public.<table>
  for all to authenticated
  using  (club_id in (select auth_club_ids()) or auth.is_super_admin())
  with check (club_id in (select auth_club_ids()) or auth.is_super_admin());
```

Patron `anon` (lecture publique PWA + vitrine) — **scopé au club + contenu publié** :

```sql
create policy public_read on public.actus
  for select to anon
  using (published = true);   -- le filtrage par club_id est fait par la requête (subdomain)
```

> Pour `anon`, la RLS gate le **contenu publiable** (ex. `published = true`) ; le **club
> courant** est appliqué côté requête via le `club_id` résolu par sous-domaine. C'est
> suffisant car ces données sont publiques par nature. `team_match_lines` (joueurs
> nominatifs) **reste back-office only** (pas de policy `anon`).

> ⚠️ **Convention GRANTs (obligatoire oct. 2026)** : chaque `CREATE TABLE` est suivi de ses
> `GRANT` par rôle, alignés sur la RLS (cf. `docs/CODEBASE.md` › Convention GRANTs). Les
> nouvelles tables (`clubs`, `club_members`, `club_settings`) doivent les inclure.

### 2.4 Dette d'isolation connue — tables socle non cloisonnées

PR3 a posé `tenant_isolation` sur les **10 tables métier** uniquement. Les tables socle
(PR1) ont été délibérément gelées, et deux d'entre elles restent **non cloisonnées par
club** :

| Table | Policy PR1 | Portée réelle | Statut |
|---|---|---|---|
| ~~`club_settings`~~ | ~~`FOR SELECT TO authenticated USING (true)`~~ | ~~tout compte authentifié lit la config de **tous** les clubs~~ | ✅ **fermée en PR6a** (`20260822_config_storage_tenant.sql`) |
| `profiles` | lecture libre `authenticated` **et** `anon` | prénoms/noms de **tous** les membres de **tous** les clubs, y compris hors authentification | ⚠️ **ouverte** — dès le 2ᵉ club réel en production |

`clubs` est volontairement lisible par tous : c'est la condition de la résolution du tenant
avant authentification (§3). `club_members` est déjà restreinte (`user_id = auth.uid()`).

> PR5 n'a rien changé à cette dette : elle a ajouté à `club_settings` des policies
> **d'écriture** réservées au super-admin (réparation d'un club), la policy `SELECT`
> `USING (true)` restait telle quelle. **PR6a** l'a remplacée par
> `club_settings_select_tenant` (patron `tenant_isolation`) et a ajouté
> `club_settings_update_club_admin` (`EXISTS` sur `club_members` avec `role = 'admin'`), les
> policies super-admin de PR5 étant conservées. Garde-fou `pg_policies` inclus, façon PR3.
> La lecture `anon` **n'est pas ouverte** : PR9 ouvrira une lecture restreinte aux clés
> publiques quand la vitrine en aura besoin.

Pour `profiles`, le cloisonnement passe par `club_members` (un profil est visible s'il partage
un club avec le demandeur) — attention à ne pas casser la lecture `anon` dont dépend
l'affichage du gestionnaire d'un live en PWA. **Pas de PR d'accueil à ce jour.**

#### Dette Storage — fermée en PR6a, avec un reliquat legacy

Non recensée ici avant le 20/08/2026, et pourtant c'était la **dernière fuite de données entre
clubs** de la plateforme. PR3 a verrouillé les 10 tables métier et laissé le Storage dehors :
les policies d'écriture des 4 buckets étaient scopées **au bucket**, pas au club
(`WITH CHECK (bucket_id = 'actu-images')`) — tout membre d'un club pouvait écraser ou
supprimer les images de n'importe quel autre.

**PR6a** applique D12 : premier segment de chemin = `club_id`, policies d'écriture et de
suppression scopées via `public.can_write_club_object(name)`, lecture publique inchangée. Le
bucket `content-images`, créé au dashboard et versionné par aucune migration, est rapatrié
dans le dépôt à cette occasion.

> ⚠️ **Reliquat — clause « grandfather », posée le 2026-08-22, temporaire.**
> Les objets antérieurs à PR6a n'ont pas de préfixe club. Les policies tolèrent donc les
> chemins dont le **1ᵉʳ segment n'est pas un UUID**, réservés aux membres de CAC — sans quoi
> ces objets deviendraient **non supprimables** et « supprimer une actu » casserait en prod
> sur des données réelles.
> **Fermeture** : une PR de nettoyage qui déplace les objets et réécrit les URL — dans
> `events.image_url`, `actus.image_urls[]`, `team_rencontres.photo_urls[]` **et dans le corps
> markdown** des actus et des events, où `MarkdownEditor` les a noyées. À planifier dès qu'un
> **2ᵉ club réel** existe ; tant qu'un seul club possède ces objets, la clause ne fuit rien.

---

## 3. Résolution du tenant au runtime

Principe commun aux 3 apps : **hostname → club_id**, posé en contexte React, puis
**toutes les requêtes filtrent sur `club_id`**.

```
1. Au démarrage : lire window.location.hostname
2. Résolution, dans l'ordre :
   a. custom_domain  → select … from clubs where custom_domain = :hostname and status='active'
   b. sinon, extraire le slug du sous-domaine feelike.app :
      - "cac-tennis"       depuis "cac-tennis.feelike.app"      (vitrine)
      - "cac-tennis"        depuis "app-cac-tennis.feelike.app" (PWA, préfixe "app-")
      → select … from clubs where slug = :slug and status='active'
   (en dev : fallback via VITE_DEV_CLUB_SLUG ou ?club=… )
3. Si introuvable / suspended → page "club inconnu / indisponible"
4. Sinon → ClubProvider expose { clubId, club } à toute l'app
5. Tous les hooks/queries existants ajoutent .eq('club_id', clubId)
```

> La résolution teste **`custom_domain` en premier** (dès le V1 côté logique, même si l'UI
> d'attribution custom domain n'arrive qu'en phase ultérieure) puis retombe sur le slug
> `*.feelike.app`. Le **BO** (`admin.feelike.app`) ne résout pas par sous-domaine : il
> présente un **sélecteur de club** parmi ceux dont l'utilisateur est membre (ou tous, si
> super-admin), et pose le `club_id` choisi dans le contexte.

Points d'attention :
- **`clubs` doit être lisible en `anon`** (au moins `id, slug, name, sport, status`) pour
  permettre cette résolution avant authentification.
- Le **BO** résout aussi le tenant par sous-domaine, mais l'utilisateur doit en plus être
  membre (`club_members`) ou super-admin pour y accéder.
- Centraliser dans un `ClubContext` partagé (un par app : `src/`, `pwa/src/`, et la future
  app vitrine). Éviter de re-déduire le slug à 50 endroits.

---

## 4. Rôles & permissions

| Rôle | Portée | Droits |
|---|---|---|
| **Super-admin** | Global (tous les clubs) | Console de provisioning : créer/suspendre un club, inviter le premier admin, accéder en lecture/écriture à n'importe quel club (support). Bypass RLS via `auth.is_super_admin()`. |
| **Admin** | Un club | Gestion complète du club : config vitrine, comptes sociaux, GEN_PROG background, gestion des membres (inviter manager/member), tous les modules métier. |
| **Manager** | Un club | Crée du contenu et utilise les outils (actus, events, équipes, programmation image, planning TMC). Ne gère ni la config club ni les membres. |
| **Member** | Un club | Accès **Live Score** uniquement (saisie de scores). C'est le périmètre `authenticated` actuel de la PWA. |

Implémentation :
- `club_role` enum `('admin','manager','member')` sur `club_members`.
- Super-admin = flag global (`profiles.is_super_admin` ou table dédiée) + helper SQL
  `auth.is_super_admin()` utilisé dans les `using/with check` des policies.
- Côté front : un hook `useClubRole()` dérive le rôle de l'utilisateur dans le club courant
  et conditionne l'affichage (cartes du dashboard BO, actions). **La RLS reste la source de
  vérité** ; le front ne fait que masquer.
- Le flux d'invitation existant (`InvitePage`/`AcceptInvitePage` + Edge Function
  `invite-user`) est **étendu** pour porter `club_id` + `role` dans l'invitation et créer la
  ligne `club_members`.

### 4.1 Livré en PR4 — état réel de l'implémentation

- **`club_members` créée à l'émission de l'invitation**, pas à l'acceptation :
  `inviteUserByEmail` / `generateLink` créent le compte `auth.users` immédiatement et
  renvoient son `id`, donc l'Edge Function (déjà en service role) upsert dans la foulée.
  `AcceptInvitePage` est **inchangée**. Deux approches ont été **écartées** :
  - *rôle dans `user_metadata` puis création à l'acceptation* → `raw_user_meta_data` est
    modifiable par l'utilisateur (`auth.updateUser({ data })`) : un invité `member` pourrait
    se promouvoir `admin` avant d'accepter. **Faille d'escalade.**
  - *table `club_invitations` + token consommé à l'acceptation* → robuste mais c'est une
    table, un cycle de vie et un aller-retour de plus pour un besoin que le service role
    couvre en une ligne. À reconsidérer seulement pour **lister les invitations en attente**.
- **Autorisation d'invitation** : `invite-user` exige `admin` **du `club_id` demandé** (ou
  super-admin), contrôle fait en service role sur `club_members` + `profiles`. Un `manager`
  n'invite personne. C'est ce contrôle — et non le `club_id` envoyé par le front — qui
  empêche d'injecter le club d'un tiers.
- **Garde d'appartenance BO** : un compte authentifié ni membre ni super-admin obtient un
  écran de refus plein page (nom du club + « Se déconnecter »), pas une redirection vers
  `/login` : la session est valide, c'est le club qui ne l'est pas. `/login` et
  `/accept-invite` restent atteignables.
- **Super-admin non membre** : entre en support (`isMember === false`, rôle effectif `admin`).
- **Multi-club (D5)** : inviter un email déjà titulaire d'un compte le **rattache** au club
  courant sans envoyer d'email (réponse `already_existed`).

**Correctif audit du 05/09/2026 — à déployer :** la migration
`20260905_audit_content_permissions.sql` ajoute des policies restrictives : admin/manager
écrivent les modules éditoriaux, TMC et équipes ; member conserve les droits Live Score.
Les clubs suspendus sont refusés par les règles métier (lecture publique comprise), avec
exception de support pour le super-admin. Les images déjà publiques ne deviennent pas
privées. Les fonctions d'invitation/gestion de membres vérifient aussi le statut du club.
Une réinvitation conserve le rôle existant et un trigger protège le dernier admin.
Le contrôle exclusif du gestionnaire du score reste un correctif distinct.
Voir `docs/SECURITY_AUDIT_FIXES.md` pour la validation et l'ordre de déploiement.

> **Dette PR4 — pas de garde d'appartenance côté PWA.** `pwa/` n'a ni `useClubRole()` ni
> garde : un membre du club A qui ouvre la PWA du club B lit le contenu public (normal, il est
> `anon`-lisible) mais échoue sur une **erreur technique sèche** à la première écriture (créer
> un match, saisir un score), rejetée par la RLS. Le correctif n'est pas l'écran de refus du
> BO — ce serait priver le visiteur d'un contenu volontairement public — mais le masquage des
> seules actions d'écriture pour un non-membre. À traiter avec la page « club inconnu /
> suspendu » (**PR13**).

### 4.2 Livré en PR5-bis — gestion des membres côté admin de club

Écran **`/admin/members`** (`MembersPage`, route `adminOnly`), carte *Admin › Membres* du
dashboard. Il **absorbe** l'ancienne page `/admin/invite`, qui redirige en permanence :
inviter quelqu'un et voir la liste se rafraîchir est le même geste. Un `manager` n'y a pas
accès (§4 : « Ne gère ni la config club ni les membres »).

- **Lister** : nom, **email**, rôle (`<select>` inline), badge « invitation en attente ».
- **Changer le rôle**, **retirer** du club (confirmation nommant la personne et le club),
  **renvoyer l'invitation** à un invité jamais activé, **inviter** (email ou lien à copier).

- **Tout passe par l'Edge Function `club-members`** (service role), et cette PR n'a **aucune
  migration** : `club_members` garde exactement ses deux policies `SELECT`. C'est une
  **déviation assumée** de ce que laissait entendre §4.1 (« ouvrir `club_members` en lecture
  club-scopée + écritures ») : l'email et le statut « en attente » vivent dans `auth.users`,
  hors de portée de la clé anon — le service role est de toute façon nécessaire pour que la
  liste soit lisible. Des policies RLS en plus donneraient deux sources pour la même liste, et
  une policy `UPDATE` exposée au client sur la table qui porte l'autorisation de toute l'app
  n'est pas une surface qu'on ouvre sans nécessité.
- **Autorisation** : patron d'`invite-user` — admin **du `club_id` demandé** ou super-admin,
  vérifié en service role. Le `club_id` envoyé par le front ne fait pas foi.
- **Garde-fou « au moins un admin par club », côté serveur** : rétrograder ou retirer le
  dernier `admin` est refusé par la function (le front désactive aussi les contrôles, mais ce
  n'est que du confort). Sans lui, un club sans admin ne peut plus inviter personne et le
  rattrapage est SQL-only. **Se rétrograder ou se retirer soi-même reste permis** — le cas
  dangereux est déjà couvert par le garde-fou ; la confirmation dit ce qu'on perd.
- **Retirer ≠ supprimer le compte** : `DELETE` sur `club_members` seul. `auth.users` et
  `profiles` sont intacts, une future invitation rattachera le compte (branche
  `already_existed`). Effet immédiat : `auth_club_ids()` étant évalué à chaque requête, la RLS
  refuse tout sur-le-champ, et au rechargement la personne tombe sur l'écran « Accès refusé ».
- **Relancer une invitation ne peut pas passer par `invite-user`** : l'invité existe déjà dans
  `auth.users` (§4.1), la function partirait dans sa branche `already_existed` et répondrait
  « succès » **sans envoyer d'email**. `club-members` appelle donc `inviteUserByEmail`
  directement — GoTrue ne lève `email_exists` que sur un compte **confirmé**, un invité jamais
  activé reçoit donc bien un nouvel email — avec repli `generateLink` (`invite` puis
  `recovery`) qui produit un lien à copier. La réponse porte `email_sent` : l'UI annonce ce qui
  s'est réellement passé, jamais l'email espéré. Action refusée (`400`) sur un membre `active`.
- **`is_super_admin` n'est jamais exposé** par la function : information plateforme, pas rôle
  de club.
- **Non traité ici** : le rôle reste du **masquage UI** (encadré ⚠️ du §4.1) — les libellés de
  l'écran disent « définit ce que la personne voit dans le back-office », pas ce qu'elle a le
  droit de faire. Rien côté PWA (dette §4.1, PR13). Pas de suppression de compte
  `auth.users` (« annuler l'invitation ») en V1.

⚠️ Déploiement **manuel** : `supabase functions deploy club-members` (dev puis prod).

---

---

## 5. Console super-admin (provisioning)

Nouvelle surface (peut vivre dans le BO sous une route gardée `super_admin`, ou app séparée
— **recommandé : route gardée dans le BO** pour limiter le périmètre V1).

Fonctions V1 :
- **Créer un club** : `name`, `slug` (vérif unicité + format DNS), `sport`. Crée la ligne
  `clubs` + une `club_settings` vide + le sous-domaine (cf. §8).
- **Inviter le premier admin** du club (réutilise le flux d'invitation, role `admin`).
- **Lister / suspendre** un club (`status = 'suspended'` → vitrine et apps renvoient "club
  indisponible").
- **Impersonation / accès support** : entrer dans le BO d'un club donné.

Hors V1 : facturation, quotas, métriques d'usage, self-service signup.

### 5.1 Livré en PR5 — état réel de l'implémentation

Route **`/super-admin`** dans le BO, gardée par **`isSuperAdmin` seul** (jamais `role === 'admin'` :
le super-admin n'est pas un rôle de club). Carte « Console plateforme » sur le dashboard, rendue
**hors de la matrice de rôles** pour la même raison.

- **Écritures par RLS, pas par Edge Function.** Créer ou suspendre un club ne manipule aucun
  secret : policies `is_super_admin()` sur `clubs` / `club_settings` + client Supabase standard.
  Zéro Edge Function nouvelle, zéro déploiement manuel supplémentaire. L'invitation, elle, garde
  `invite-user` **inchangée** — elle a besoin du service role pour créer le compte `auth.users`,
  et elle autorisait déjà un super-admin sur n'importe quel `club_id` (§4.1).
- **`clubs.slug` est devenu une adresse DNS** (D9) : `CHECK clubs_slug_format` (format
  sous-domaine, 2–32, préfixe `app-` interdit car réservé à la PWA, slugs plateforme réservés).
  Les mêmes règles sont dupliquées côté front — le CHECK est le filet, pas le message d'erreur.
- **`club_settings` par trigger**, pas par un 2ᵉ insert côté front : un échec entre les deux
  laisserait un club à moitié provisionné.
- **Pas de suppression de club** : aucune policy `DELETE`. On suspend (cascade sur 10 tables).
- **Accès support = override de club** (`localStorage.feelike_support_club`), résolu par
  `ClubContext` **avant** le hostname et **sans** le filtre `status = 'active'` — entrer dans un
  club suspendu pour le diagnostiquer est l'usage même du support. Bandeau permanent + Quitter.
  Indispensable, pas un bonus : sans wildcard `*.feelike.app` (PR13), un club créé depuis la
  console ne serait joignable **par personne**. Ce n'est pas une faille : poser la clé à la main
  ne donne aucun droit (écran « Accès refusé » de PR4, et `tenant_isolation` ne rend rien) —
  l'override change le club **affiché**, pas les droits. BO uniquement, PWA non touchée.
- **Périmètre volontairement fermé** (tranché en PR5) : la **gestion des membres** d'un club
  (lister / changer un rôle / retirer) part en **PR5-bis côté admin de club** (livré, §4.2), qui est le vrai
  destinataire du besoin — la console de provisioning ne devient pas un écran d'administration
  des comptes. Le **sélecteur de club généraliste** pour les comptes multi-clubs non
  super-admin (D5) attend un 2ᵉ club réel et le wildcard (PR13) ; l'override ci-dessus en est
  déjà l'ossature.

> ⚠️ **Prérequis de sécurité livré avec cette PR** — `profiles.is_super_admin` était
> **auto-attribuable** depuis PR1 : la policy `profiles_update_own` n'avait pas de `WITH CHECK`
> et le `GRANT UPDATE` ne listait aucune colonne, donc tout compte authentifié (clé anon
> publique) pouvait se promouvoir et court-circuiter `tenant_isolation` sur **tous** les clubs.
> Corrigé par `2026081801_profiles_column_grants.sql` (**grants par colonne** — la RLS ne sait
> pas restreindre une colonne — sur INSERT *et* UPDATE, + `WITH CHECK`). Migration isolable,
> à appliquer **avant** `2026081802` : livrer la console au-dessus d'un flag auto-attribuable
> serait le mauvais ordre. Le flag ne se pose plus qu'au SQL Editor (bootstrap : `README.md`).

---

## 6. Configuration tenant

Trois familles de config par club, toutes administrables par l'**admin** du club depuis le BO :

### 6.1 Config du site vitrine
Les ~80 variables du `web_site_brief.md` (`brand.*`, `home.*`, `club.*`, `infra.*`,
`pricing.*`, `contact.*`, `social.*`, `partners`, `legal.*`, `settings.*`).
- **Stockage** : `club_settings.config` en **JSONB** (arbre unique, versionnable, souple
  pour les `list<…>`). Schéma validé côté app (zod ou équivalent).
- **Contrat posé en PR6a** — source unique : `src/lib/clubConfig.ts` (zod), écrit sans import
  React ni Supabase pour être déplaçable tel quel dans le paquet partagé avec `web/` (PR9).
  Trois règles : tout est optionnel et a un défaut (`config = '{}'` est le cas **nominal**
  d'un club provisionné par la console) ; **la lecture ne jette jamais** (`safeParse` + fusion
  avec les défauts — la validation stricte est pour l'écriture, PR6b) ; les **clés inconnues
  sont préservées**, pour qu'un BO en retard d'une version n'efface pas un groupe qu'il ne
  connaît pas encore. `config.version` (= 1) discrimine la forme.
  Groupes couverts : **`brand`, `home`, `contact`** (PR6a), **`social`, `partners`, `legal`,
  `settings`** (PR6c) et **`club`, `infra`, `pricing`** (PR6d). ✅ **La configuration est CLOSE**
  — les dix groupes du `web_site_brief.md` §5 sont éditables et PR9 a son contrat complet. Les
  groupes se sont ajoutés avec leurs consommateurs plutôt qu'en bloc : figer 80 clés sans retour
  d'usage, c'était se condamner à migrer un JSONB qui porte déjà les données de deux clubs.
  Chaque ajout de groupe est resté **additif**, donc `CLUB_CONFIG_VERSION` reste à **1** — il n'a
  jamais bougé de PR6a à PR6d.
  Lecture côté BO : `src/hooks/useClubConfig.ts`.
- **Images** (logos, hero, portraits, courts…) : voir **D12** — buckets **par type de
  contenu** (peu nombreux, stables), chemins **préfixés `club_id/`** (ex.
  `vitrine/{club_id}/hero.jpg`). Policies Storage : **écriture/suppression scopées au club**
  (l'admin n'écrit que sous son préfixe), **lecture publique** pour le contenu public
  (actus, events, vitrine). On n'ouvre **pas** un bucket par club (ne scale pas).
- **Nouvelle section BO** « Configuration du site » : un formulaire par groupe de préfixe
  (Identité, Accueil, Le Club, Infrastructures, Tarifs, Contact, Réseaux, Partenaires,
  Légal, Réglages d'affichage).
- **Livré en PR6b** — `/admin/site` (`adminOnly`), un **panneau par groupe** avec son propre bouton
  d'enregistrement : une erreur de validation sur un groupe ne bloque pas les autres, et l'UPDATE ne
  touche qu'une clé racine, donc deux onglets ouverts sur deux panneaux différents ne s'écrasent plus.
  Écriture : `src/lib/clubConfigWrite.ts` — **schéma strict** (l'inverse du schéma de lecture), qui refuse
  au lieu de retomber sur un défaut et **nomme l'entrée fautive** (« 2ᵉ horaire — « Jour » est
  obligatoire. ») ; sans quoi une entrée à demi remplie coûterait **toute** la liste à la relecture.
  Un champ requis vide est en revanche **accepté au niveau du groupe** : un club en cours de saisie est le
  cas nominal, au même titre que `config = '{}'`. L'écriture **relit la ligne brute**, fusionne
  **profondément** le seul groupe édité (les clés inconnues nichées dans un groupe connu survivent —
  `parseClubConfig` ne fusionne qu'à la racine) et fait un **`UPDATE`, jamais un `upsert`** : l'INSERT
  reste réservé au super-admin. Le `.select()` qui suit l'UPDATE est **nécessaire** — une écriture refusée
  par la RLS ne remonte aucune erreur, elle ne touche aucune ligne.
  Périmètre PR6b : **`brand`, `home`, `contact`** seulement.
  Images : bucket **`content-images`** sous `clubPath(clubId, 'config', …)` — le bucket générique que
  demande D12, donc **aucune migration**. Un bucket dédié viendra avec PR7-bis, quand elle aura
  elle-même des logos et des icônes PWA à y placer, et déplacera ces quelques objets.
- **Livré en PR6c** — les quatre groupes **globaux**, ceux qui alimentent le *chrome* du site plutôt
  qu'une page : **`social`** (Facebook, Instagram), **`legal`** (directeur de publication, hébergeur),
  **`settings`** (drapeaux d'affichage) et **`partners`** (bande « Ils soutiennent le club »). Toujours
  **aucune migration** : le JSONB n'a pas de schéma en base, et la policy d'écriture comme le bucket
  datent de `20260822`. Deux **extensions du modèle**, chacune livrée avec le groupe qui l'exerce :
  · Le type **`bool`**. Un drapeau ne transite **pas** par le tuyau des chaînes (`fieldSchema` =
  `z.string().transform(trim)` + format) : il a sa propre branche, sans quoi c'est la **chaîne**
  `'false'` — non vide, donc **vraie** pour la vitrine — qui finirait dans le JSONB. Son défaut est
  **positif** (`flag = z.boolean().catch(true).default(true)`, brief §5.10), à l'inverse de tout le
  reste du contrat : un club qui n'a jamais ouvert l'écran voit ses quatre cases **cochées**. Décocher
  écrit donc le booléen `false` plutôt que d'effacer la clé — c'est la seule façon de distinguer
  « masqué explicitement » de « jamais configuré ».
  · Le **groupe-liste**. `partners` est une **liste à la racine** (`web_site_brief.md` §5.8), pas un
  objet de champs : `GroupSpec` devient une union `kind: 'fields' | 'list'`. L'emboîter sous
  `partners.items` aurait évité l'union, au prix d'un JSONB **divergent de la spec que PR9 lira**.
  L'union ne se propage pas pour autant : `itemsOf()` présente le groupe-liste comme un groupe à un
  seul item, si bien que le schéma zod, le nommage de l'entrée fautive, les chemins de fichiers en
  attente (`partners.0.logo`) et le rendu du panneau l'ignorent — **deux** points seulement
  connaissent la différence, la lecture (`groupValueFromConfig`) et l'écriture, où la liste remplace
  sa valeur **en bloc** (`mergeGroup` ne saurait pas fusionner un tableau : `Object.entries` en ferait
  un objet indexé par position). Les logos réutilisent l'upload différé de PR6b **sans modification**.
  Ordre à l'écran : le chrome vient **après** les groupes de contenu, et PR6d a inséré `club`,
  `infra` et `pricing` **avant** ce bloc. Les trois dernières extensions du modèle sont restées
  **non anticipées** ici — les poser sans le groupe qui les exerce, c'est du code non testé.
- **Livré en PR6d — la configuration est CLOSE.** Les trois **pages de contenu** : **`club`**
  (§5.3), **`infra`** (§5.4) et **`pricing`** (§5.5), soit ~45 clés, 8 listes et 4 objets
  imbriqués. Toujours **aucune migration**, `CLUB_CONFIG_VERSION` **inchangé**. Trois extensions,
  chacune posée avec le groupe qui l'exerce, et toutes tenues à la **règle de PR6c** : l'état de
  formulaire garde **une seule forme, plate**, et seuls les deux points qui lisent et écrivent le
  JSONB connaissent la forme réelle. `groupSchema`, `formatIssue`, `setAtPath` et le rendu du
  panneau n'ont eu à connaître **aucune** des trois.
  · **Objets imbriqués** (`club.president`, `club.coach`, `infra.clubhouse`,
  `infra.locker_rooms`). La clé de formulaire reste **plate et sans point** (`president_photo`),
  la spec porte en plus le **chemin réel** (`path: ['president', 'photo']`). Des clés pointées
  auraient cassé `setAtPath` **en silence** — il découpe les chemins de fichiers en attente sur le
  point, donc `'president.photo'` s'y serait lu `[head='president', index='photo']` et une URL
  d'image aurait **écrasé l'objet entier**. Côté écriture, l'objet niché est reconstruit à partir
  des `path` **avant** `mergeGroup`, dont la fusion profonde préexistante suffit alors : une clé
  inconnue posée à la main (`club.president.twitter`) survit à un enregistrement du panneau. Les
  sous-titres `section` de PR6b suffisent à présenter ces objets à l'écran.
  · **Listes de scalaires** (`club.values`, `club.methods`, `club.levels`,
  `club.coach.credentials`, `infra.clubhouse.images`). `ListSpec` gagne `scalar: true` + **un
  seul** `FieldSpec` ; l'état reste des entrées à une clé, donc le rendu de liste, l'ajout, le
  retrait, le réordonnancement et le remap des fichiers en attente (`clubhouse_images.0.value`)
  fonctionnent **sans une ligne de plus**. L'emballage `{ value: … }` ne sort **jamais** du
  formulaire : le JSONB porte `["Respect", "Convivialité"]`, la forme que décrit la spec et que
  PR9 lira — le stocker emballé aurait refait l'erreur que la décision `partners` a refusée.
  `club.coach.credentials` et `infra.clubhouse.images` **combinent** les deux extensions : une
  liste scalaire qui vit à un `path`.
  · Le type **`number`** (`pricing.lessons[].price`, `pricing.membership[].price`). Sa propre
  branche de schéma, comme `bool` en PR6c : la saisie reste une chaîne (c'est un `<input>`), le
  schéma la **valide et la convertit**, et le JSONB reçoit un **nombre** — un `"120"` y serait une
  régression silencieuse pour la vitrine. **Vide ≠ zéro** : un tarif non renseigné voit sa clé
  **omise**, jamais écrite à `0`. Le schéma est **idempotent** (il accepte le nombre et
  l'`undefined` autant que la chaîne) parce que `saveClubConfigGroup` revalide la valeur que le
  panneau lui repasse — un `z.string()` seul aurait refusé au second tour un montant laissé vide.
  Le champ reste un `input[type=text]` avec `inputMode="decimal"` : un `type="number"` rend une
  **chaîne vide** dès que la saisie n'est pas un nombre, et un « 15€ / h » collé serait passé pour
  un champ vide au lieu du refus nommé.
  ⚠️ **Deux champs `price`, deux types, et c'est voulu** (`web_site_brief.md` §5.5) :
  `lessons[].price` et `membership[].price` sont des **nombres**, `other_fees[].price` est du
  **texte** — l'unité y est variable (« 15€ / h », « 8€ »). Ne pas « harmoniser » l'un sur l'autre.
  Ordre à l'écran, celui du brief §5 : Identité → Accueil → **Le Club → Infrastructures →
  Tarifs** → Contact → Réseaux → Partenaires → Mentions légales → Affichage. Dix panneaux dépliés
  faisant une page trop haute, ils sont désormais **repliés par défaut** (sauf le premier) et
  chacun affiche son état — « Configuré » / « À compléter » d'après ce qui est **en base**, ou
  « Modifications non enregistrées » dès qu'une saisie est en cours, pour qu'un repli ne cache
  jamais du travail non sauvegardé. Le repli n'est qu'un masquage : le panneau reste monté, donc
  sa saisie et ses fichiers en attente survivent.

### 6.2 GEN_PROG — background personnalisé

> **Livré en PR7.** Les deux affiches générées par le BO reposaient sur un fond **figé aux
> couleurs de CAC** (`/tmcs_pentecote.png`, `/template_event.png`) : un second club produisait
> donc des affiches à l'entête du premier. Elles lisent désormais **`config.posters.*`**, où
> chaque affiche a une **liste de fonds nommés** parmi lesquels choisir à la génération.

- **PLUSIEURS fonds par affiche, pas un seul.** Un club a une affiche d'été, une de tournoi, une
  de fin de saison : `posters.tmc_backgrounds` et `posters.team_match_backgrounds` sont donc des
  **listes d'objets `{ name, image }`**, à la forme de `partners` ou `home.stats`. Le **nom**
  n'est pas décoratif — c'est ce que l'admin lit dans le sélecteur quand il a cinq fonds ; les
  deux clés sont ⬤ **dans l'entrée**, où le ⬤ bloque (asymétrie de `fieldSchema`) : un fond sans
  image ne sert à rien, un fond sans nom est impossible à choisir. Le choix se fait **à la
  génération**, n'est **pas enregistré**, et retombe sur le premier fond. La liste apporte au
  passage la **suppression** — retirer une entrée efface l'objet Storage devenu orphelin — sans
  une ligne de code de plus.
- **Un onzième groupe, `posters`**, et non deux clés dans `brand`. Les dix groupes du
  `web_site_brief.md` §5 sont le **contrat de la vitrine**, celui que PR9 lira ; or ces deux
  images ne sortent nulle part sur la vitrine — elles alimentent **deux écrans du back-office**.
  Les glisser dans `brand` polluait un contrat fermé la veille et obligeait PR9 à ignorer deux
  clés au milieu de l'identité du club. Le groupe est donc **à part et en dernier à l'écran** :
  le seul panneau de `/admin/site` qui ne concerne pas le site. Ajout **additif** ⇒
  `CLUB_CONFIG_VERSION` reste à **1**.
- **Un emplacement à GABARIT IMPOSÉ, pas un re-skin libre.** Les textes des deux affiches sont
  écrits en **position absolue à des coordonnées figées** (`GRID_TOP = 305`, date à `170`,
  marges de 18 px côté TMC ; `CONTENT_TOP = 245` → `CONTENT_BOTTOM = 1780`, marges de 60 px
  côté rencontres). Le fond n'est pas un décor, c'est un **cadre dont les zones vides sont
  exactement là où le code viendra écrire** : une image aux mauvaises proportions ne rend pas
  « moins bien », elle rend l'affiche **inutilisable**. D'où un contrôle **avant l'upload**
  (`dimensions` sur `FieldSpec`, honoré par le seul sélecteur d'image), qui porte sur **deux
  choses, et deux seulement** :
  · les **PROPORTIONS**, à **2 % près** — sans quoi le fond des rencontres, rendu en
  `width/height: 100%` sans `object-fit`, serait **étiré en silence** ;
  · une **taille minimale** (794 × 1123 et 1414 × 2000), l'export étant fait à `pixelRatio: 2` ;
  plus grand est bienvenu.
  ⚠️ **Ce n'est pas une définition à respecter au pixel près, et ça ne doit pas le devenir** :
  les deux gabarits sont de l'**A4 portrait** (ratio ≈ **0,707**), dont aucune définition en
  pixels ne tombe juste — 794 × 1123 vaut 0,70703, 1414 × 2000 vaut 0,70700, 595 × 842 vaut
  0,70665. Un premier jet exigeait l'**égalité exacte** du produit en croix : il refusait un
  1414 × 2000 pour l'affiche 794 × 1123, **c'est-à-dire le même format**. La tolérance couvre
  toutes les définitions A4 courantes et refuse toujours ce qui casse vraiment l'affiche (un
  4:5 est à 13 % du ratio, un 3:2 à 94 %). Un fichier refusé l'est en **nommant le ratio
  attendu et le ratio reçu**, pas signalé par un avertissement qu'un clic franchit.
  **Rien de la mise en page n'est devenu configurable** : pas de coordonnées en config, pas de
  zones paramétrables, pas de recadrage — ce serait un éditeur d'affiches, c'est-à-dire un
  autre produit.
- **Consommation** : `ProgrammationImagePage` est une **page**, elle monte `useClubConfig()`
  elle-même ; `TeamMatchImagePreview` reste un composant de **présentation** et reçoit l'URL en
  **prop**, parce que `PosterPanel` le monte **deux fois** sur le même écran (aperçu réduit +
  nœud d'export hors viewport) — le hook n'a aucune raison d'y tourner deux fois. Il n'est donc
  **pas** promu en provider.
- ⚠️ **Cross-origin — le vrai piège.** Le fond passe d'une image de même origine (Vercel) à une
  **URL Supabase Storage**. `html-to-image` inline les images avant de rendre le canvas : sans
  en-tête CORS à la source **ou** sans `crossOrigin`, l'export sort sans fond — **au
  téléchargement seulement**, l'aperçu à l'écran restant parfait. `crossOrigin="anonymous"` est
  désormais posé sur **les deux** `<img>` de fond (le TMC l'avait déjà), et les objets publics
  du Storage servent bien `access-control-allow-origin: *`.
- **Aucun fond ⇒ génération REFUSÉE.** ⚠️ **Revirement assumé** par rapport au premier jet de
  PR7, qui laissait l'affiche se générer sur son aplat uni : une affiche sans fond n'est pas un
  repli acceptable, c'est un brouillon qu'on diffuse par mégarde. Les deux écrans désactivent
  donc le bouton et affichent un message **nommant le chemin de sortie** (`/admin/site` →
  « Affiches ») ; la garde est aussi **dans le handler**, pas seulement sur le bouton. Le
  **contrat**, lui, ne bouge pas : `[]` reste une valeur parfaitement valide et la lecture ne
  jette jamais — c'est l'**écran** qui refuse, pas le schéma.
  Toujours **aucun défaut** retombant sur `/tmcs_pentecote.png` : ce serait réinstaller de la
  logique de tenant **en dur dans le code**, précisément ce que cette migration démonte, et la
  clause « grandfather » de PR6a a déjà montré le prix d'un contournement temporaire.
- ⚠️ **L'opération de contenu après déploiement devient BLOQUANTE.** Tant que l'admin CAC n'a pas
  ajouté au moins un fond par affiche depuis `/admin/site` → « Affiches », le club **ne peut plus
  générer d'affiche du tout** — là où le premier jet dégradait seulement le rendu. À faire
  **juste après** le déploiement, pas « quand on aura le temps ». Les deux fichiers de `public/`
  **restent en place** — ils en sont la source, leur retrait viendra quand l'op sera confirmée.

(cf. `docs/specs/GEN_PROG.md`.)

### 6.2-bis Identité visuelle des apps internes (BO + PWA)

Le §6.1 ci-dessus ne couvre que la **vitrine**. Or l'objectif produit est un cloisonnement
**graphique et textuel complet des trois surfaces** : BO, vitrine et PWA doivent porter le
nom, les couleurs et les logos du club courant. Aujourd'hui BO et PWA sont **codés en dur
aux couleurs de CAC**. Inventaire du dur, par difficulté :

| Niveau | Emplacements | Levier |
|---|---|---|
| Couleurs | `src/index.css` + `pwa/src/index.css` (tokens de teinte 355), dégradé de `body`, états de score teintés marque | **`brand.color`** (+ `color_secondary`, `color_accent`) → tokens CSS posés au runtime |
| Texte | `src/pages/AppHomePage.tsx` (h1), `pwa/src/components/layout/headerConfig.ts` (titre root), `pwa/src/components/install/InstallBanner.tsx` (slogan), `pwa/index.html` (`<title>`) | **`clubs.name`**, déjà exposé par `useClub()` — aucun nouveau champ requis |
| Images | `/logo.png` (BO), icônes PWA (`/icons/*`), favicons et `apple-touch-icon` des deux `index.html` | Storage préfixé `club_id/` (D12) + champ de config club |
| Manifest PWA | `pwa/vite.config.ts` → `name`, `short_name`, `icons` | ⚠️ **figés au build** — voir question ouverte ci-dessous |

> ⚠️ **Question ouverte, à trancher avant PR9/PR13.** Une PWA **unique** servant N clubs (D2)
> ne peut pas porter un manifest statique : le nom et l'icône sur l'écran d'accueil sont
> résolus au build, pas au runtime. Deux pistes : (a) manifest **généré au runtime** et
> injecté via un `<link rel="manifest">` pointant sur une route/blob par tenant ; (b) un
> déploiement PWA par club — ce qui **contredirait D2**. Comme D9 prévoit
> `app-<slug>.feelike.app`, c'est un livrable visible par l'adhérent : à décider avant, pas
> pendant. Le volet texte (`clubs.name`) est en revanche livrable indépendamment et à tout
> moment.

> **Livré en PR7-bis.** Le BO affiche `clubs.name` et le logo `brand.logo` du club courant. La
> PWA reprend le même nom et le même logo depuis `club_settings.config`, avec repli vers les
> assets CAC historiques pour les clubs non configurés. Le `theme-color` et le manifest sont
> remplacés au runtime quand la configuration est disponible ; le manifest généré par Vite
> reste le fallback initial.

> **Volet favicon — livré.** `brand.logo` alimente aussi le `rel="icon"` du BO et les
> `rel="icon"` / `rel="apple-touch-icon"` de la PWA, remplacés au runtime. Le manifest
> couvrait déjà les icônes d'installation Android, mais **pas** l'onglet ni l'écran d'accueil
> iOS. Les liens sont remplacés et non modifiés (Safari garde l'icône en cache sinon), et
> perdent leur `type`. Comme le logo, l'icône n'arrive **qu'après connexion** — la config est
> `TO authenticated`, l'écran de login garde celle d'`index.html`.

> **Volet couleurs — livré.** Trois clés (`brand.color`, `brand.color_secondary`,
> `brand.color_accent`) sont converties en tokens CSS par `src/lib/theme.ts` — dupliqué dans
> `pwa/src/lib/theme.ts`, à garder synchronisé — et posées sur `<html>` par le BO (`App.tsx`)
> et la PWA (`AppShell`). Seule la principale est structurante : les deux autres, laissées
> vides, en sont dérivées, ainsi que TOUS les neutres teintés (`--foreground`, `--muted`,
> `--border`, `--input`, `--ring`, bas du dégradé de `body`). Avec `#e51828` seul, la sortie
> reproduit exactement les valeurs historiques de `index.css`.
>
> **Hors périmètre, et volontairement :** les couleurs de SENS ne suivent pas le club —
> `--destructive`, les ~180 classes `red-*` de Tailwind (erreurs de saisie, boutons Supprimer,
> badge « Éliminée ») et les états de score `win` / `loss` / `draw` / `wo`. Seuls les états
> teintés marque (`todo`, `next`, `na`) suivent, via `@theme inline`.
>
> **Dette restante :** les générateurs d'affiches (`TeamMatchImagePreview.tsx`,
> `ProgrammationImagePage.tsx`, `public/vs.svg`) gardent `#C8102E` en dur — un club non rouge
> exportera des affiches rouges. Le `theme_color` de `pwa/vite.config.ts` et de
> `pwa/index.html` reste figé au build, comme le manifest (même question ouverte ci-dessus).

### 6.3 Comptes sociaux par club
Aujourd'hui la publication Facebook utilise des **secrets globaux** (`FACEBOOK_PAGE_ID`,
`FACEBOOK_PAGE_ACCESS_TOKEN`) côté Edge Function `post-to-facebook`. En multi-tenant, ces
identifiants doivent être **par club** — décision **D10** :
- Table dédiée **`club_social_credentials`** (`club_id`, `platform`, `page_id`, `token`…),
  **séparée de `club_settings`** (qui sert au rendu public). **Token = secret.**
- **RLS stricte admin-only** : lisible/modifiable seulement par l'admin du club, **jamais
  `anon`, `manager`, PWA ou vitrine**.
- L'Edge Function `post-to-facebook` lit les credentials **du club concerné** via le
  **service role** (bypass RLS côté serveur) ; plus aucun secret global.
- Durcissement optionnel ultérieur : chiffrer la seule colonne `token` via le Vault Supabase,
  sans changer le reste du schéma.
- Récupération du token = **flux de connexion Facebook** (l'admin autorise l'app et choisit
  sa page) — détail d'implémentation de la Phase 3.
- (cf. `docs/specs/ACTUS_FACEBOOK.md` à mettre à jour.)

---

## 7. Site vitrine (nouvelle app)

Référence structurelle complète : **`docs/briefs/web_site_brief.md`** (5 pages, arborescence
HTML, variables, design tokens « convivial »). Maquette : `docs/briefs/struct_web_site.html`.

Spécificités multi-tenant à ajouter au brief existant :
- **Nouvelle app** `web/` (Vite/React, même stack), déploiement Vercel unique, Root Directory
  `web/`. Résolution du tenant par sous-domaine (§3).
- **Rendu = `club_settings.config`** du club courant. Design tokens dérivés de `brand.color`.
- **Flux actus & events** : réutilisent les tables existantes `actus` / `events` filtrées par
  `club_id`, en lecture `anon` (déjà publiques). Pas de nouveau CMS.
- **Formulaire de contact** (D7) : Edge Function `contact-form` → envoie un email à
  `contact.email` du club via **Brevo** **+** insère le message dans une table
  `contact_messages (club_id, name, email, phone, message, created_at)` consultable au BO.
  Email expédié depuis une adresse de la plateforme (ex. `contact@feelike.app`) avec
  **`reply-to` = email du visiteur** (le club répond en un clic ; il ne configure rien).
  Vérification du domaine `feelike.app` chez Brevo (enregistrements DNS) à faire une fois.
  Anti-spam (honeypot / rate-limit) à prévoir.
- **Pont vers la PWA** : sur mobile, proposer l'installation de la PWA adhérents (bannière /
  lien vers le sous-domaine PWA). Détail design ultérieur.

---

## 8. Infrastructure & déploiement

### 8.1 Trois apps, un déploiement chacune (schéma D9)
| App | Dossier | Audience | Domaine |
|---|---|---|---|
| Site vitrine | `web/` (nouveau) | public | **`<slug>.feelike.app`** (adresse « publique » du club) |
| PWA | `pwa/` | adhérents | **`app-<slug>.feelike.app`** (URL ~invisible une fois installée) |
| Back-office | `src/` (racine) | gestionnaires (admin/manager/member) + super-admin | **`admin.feelike.app`** (console globale, sélecteur de club) |

> Le BO est une **console unique** `admin.feelike.app` (pas un sous-domaine par club) : on s'y
> connecte, on choisit son club (ou n'importe lequel si super-admin). Cohérent avec le modèle
> super-admin et avec le membership multi-clubs (D5).

### 8.2 Wildcard domain
- Configurer un **wildcard `*.feelike.app` sur Vercel**. La vitrine répond sur `<slug>`, la PWA
  sur `app-<slug>` (l'app teste le préfixe `app-` pour se distinguer de la vitrine), le BO sur
  `admin`. Créer un club = créer une ligne `clubs` ; **aucune action Vercel manuelle** par club
  (c'est tout l'intérêt du wildcard + résolution runtime).
- **Custom domain par club** : phase ultérieure. Mécanique = pointage DNS du club vers Vercel +
  ajout du domaine au projet (API Vercel) + renseignement de `clubs.custom_domain`. La logique
  de résolution (§3) le gère **dès le V1** (test `custom_domain` avant le slug) ; seule l'UI/
  l'automatisation d'attribution arrive plus tard. **Rien au V1 ne bloque cette évolution.**

### 8.3 Environnements
Le garde-fou dev/prod existant (`VITE_ENV`, cf. `lib/supabase.ts`) est conservé. La base de
dev reçoit le même schéma multi-tenant. Prévoir des **clubs de test** en dev.

### 8.4 Checklist de déploiement PROD — à passer à **chaque** merge de la série

> ⚠️ **Incident PR3/PR4 (17/08/2026), à ne pas reproduire.** PR3 n'avait jamais été appliquée
> sur le projet Supabase de prod. Le merge de PR4 y a donc déployé la **garde d'appartenance**
> sur une base où `club_members` était **vide** → « Accès refusé » pour **tous** les comptes,
> **BO de prod hors service** jusqu'à l'application de PR3 après coup. Rien dans le build, les
> tests ou le déploiement Vercel ne l'avait signalé.

La leçon : **merger et déployer ne touchent pas la base.** Le code part sur Vercel
automatiquement, mais migrations, Edge Functions, config du dashboard et opérations de données
sont **quatre gestes manuels distincts**, chacun sur le projet prod. Une PR étiquetée
« non-bloquante prod » ne l'est que si les migrations des PR **précédentes** sont en place.

| Surface | Mécanisme | Si on l'oublie |
|---|---|---|
| Code BO / PWA | **auto** (Vercel sur `main`) | — |
| Migrations SQL | **manuel** (SQL Editor ou `db push`) | le front s'exécute sur un schéma/une RLS qu'il ne suppose pas |
| Edge Functions | **manuel** (`supabase functions deploy`) | le front envoie un contrat que l'ancienne version ignore |
| Config dashboard Auth | **manuel** (URL Configuration) | liens d'invitation cassés **en silence** |
| Opérations de données | **manuel** (`supabase/scripts/*.sql`) | la feature est invisible en prod |

**1. Avant le merge — état des migrations de prod.** Confronter à `supabase/migrations/` :

```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
```

⚠️ Le **SQL Editor n'alimente pas ce journal** : après une application manuelle, enregistrer
la ligne, sinon un futur `db push` voudra rejouer la migration et le journal mentira.

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('YYYYMMDDNN', '<nom_court>');
```

**2. Appliquer les migrations manquantes, dans l'ordre.** Passer d'abord le **pré-vol** propre
à la migration quand elle en prévoit un — policies droppées (en-tête de
`20260816_multi_tenant_rls.sql`), slugs incompatibles (en-tête de
`2026081802_super_admin_console.sql`). Rappel : **prod porte des policies créées à la main dans
le dashboard, absentes du dépôt** — c'est le cas des policies `anon` de `events` et
`live_matches`, dont dépend la PWA.

Ensuite, deux chemins — **le premier est préférable**.

*Voie recommandée — `db push` visant la prod explicitement.* Elle applique dans l'ordre **et
écrit elle-même `schema_migrations`** : c'est la seule qui ne peut pas laisser le journal
mentir (cf. l'avertissement du §1). Ne **pas** faire `supabase link` sur la prod — ça réécrit
`supabase/.temp/` et braque le CLI sur la prod pour **toutes** les commandes suivantes, celles
qu'on croira lancer sur dev comprises. On passe la prod en argument, une fois :

```bash
supabase db push --db-url "postgresql://postgres.<ref-prod>:<mdp>@<host-prod>:5432/postgres" --dry-run
```

Chaîne de connexion : dashboard prod → *Project Settings → Database → Connection string*, avec
le mot de passe **percent-encodé**. **Lire la sortie du `--dry-run` avant tout** : elle doit
lister **exactement** les migrations de la PR. Si elle en liste d'autres, s'arrêter — c'est le
scénario de l'incident ci-dessus, une migration antérieure jamais appliquée. Puis relancer sans
`--dry-run`.

*Voie manuelle (SQL Editor)* — utile pour n'appliquer qu'une seule migration d'une PR qui en
porte plusieurs (ex. le correctif de sécurité `2026081801` seul, sans attendre PR5), ou pour
lire le SQL en l'exécutant. Le SQL Editor exécute le fichier en une transaction implicite : un
garde-fou qui lève annule tout, donc pas de demi-migration. **Ne pas oublier l'`INSERT` du
journal** (§1) — c'est précisément ce que la voie recommandée fait à ta place.

**3. Déployer les Edge Functions touchées**, sans relinker le dossier local (il pointe sur dev) :

```bash
supabase functions deploy <nom> --project-ref <ref-du-projet-prod>
```

**4. Authentication → URL Configuration.** Les **Redirect URLs** sont **vides par défaut** sur
un projet neuf ; sans l'origine de déploiement (`https://<domaine>/**`), Supabase retombe
silencieusement sur le *Site URL* et les liens d'invitation ne mènent nulle part. Le *Site URL*
n'accepte pas de wildcard. En dev, `http://localhost:*/**` couvre les décalages de port de Vite.

**5. Opérations de données** (`supabase/scripts/`), en dernier, quand la PR en prévoit une —
ex. `pr4_assign_club_roles.sql`. Ce sont des **scripts manuels, jamais des migrations** : leur
contenu dépend de l'environnement.

**6. Contrôle fonctionnel réel.** Ouvrir le **BO de prod** et la **PWA de prod**, connecté. Un
verrouillage RLS ou une garde d'accès ne se voient ni dans un build vert ni dans un typecheck :
seul un parcours authentifié les révèle.

---

## 9. Migration du club existant (CAC Tennis)

D8 = migrer en place. Étapes de la migration de données (à exécuter une fois, en Phase 1) :
1. Créer la ligne `clubs` CAC Tennis (`slug = 'cac-tennis'`, `sport = 'tennis'`, `status =
   'active'`).
2. `club_id` `NOT NULL` ajouté en deux temps : colonne nullable → **backfill** de toutes les
   lignes existantes avec l'`id` CAC → passage `NOT NULL` + FK.
3. Créer les `club_members` pour les comptes BO existants (rôles à attribuer : l'actuel
   gestionnaire en `admin`, les autres en `manager`/`member`).
4. Migrer la config vitrine CAC dans `club_settings` (valeurs de la maquette comme point de
   départ).
5. Déplacer les secrets Facebook globaux vers la config par club de CAC.
6. Préfixer les clés `localStorage` TMC par `club_id`.

Risque principal : ordre des migrations + RLS. **Activer/durcir la RLS multi-tenant seulement
après** le backfill, sinon on coupe l'accès aux données existantes.

---

## 10. Plan de livraison par phases

Progressif, chaque phase est livrable et testable indépendamment. Chaque phase = un brief
dédié dans `docs/briefs/` au moment de l'implémentation.

### Phase 0 — Cadrage & schéma (ce document)
- Valider ce doc. Trancher le **schéma de sous-domaines** (§8.1) et le **nom de domaine SaaS**.
- Geler le modèle de données (§2).
- ✅ *Verif* : revue de ce document + schéma SQL cible relu.

### Phase 1 — Socle multi-tenant sur l'existant (BO + PWA) — *prioritaire (D6)*
- Migration SQL : `clubs`, `club_members`, `club_settings`, enum `club_role`, super-admin,
  `club_id` + backfill CAC, RLS multi-tenant + GRANTs.
- `ClubContext` (résolution subdomain → club_id) dans `src/` et `pwa/src/`.
- Toutes les requêtes filtrent `club_id` ; clés localStorage TMC préfixées.
- Extension du flux d'invitation (porte `club_id` + `role`) — cf. §4.1.
- Hook `useClubRole()` + masquage UI par rôle + garde d'appartenance BO.
- ✅ *Verif* : CAC fonctionne à l'identique ; créer un 2ᵉ club de test prouve l'isolation
  (aucune fuite de données entre clubs, testée via deux comptes).

### Phase 2 — Console super-admin
- Route gardée `super_admin` dans le BO : créer/lister/suspendre un club, inviter le premier
  admin, accès support.
- ✅ *Verif* : provisionner un club de bout en bout sans SQL manuel.

### Phase 3 — Config tenant administrable au BO
- Section « Configuration du site » (formulaires par préfixe → `club_settings.config`).
- GEN_PROG background par club (§6.2).
- Comptes sociaux par club + `post-to-facebook` multi-tenant (§6.3).
- ✅ *Verif* : deux clubs avec branding/Facebook distincts publient chacun sur leur page.

### Phase 4 — Site vitrine
- Nouvelle app `web/`, rendu depuis `club_settings.config`, flux actus/events par `club_id`.
- Edge Function `contact-form` + table `contact_messages` + lecture au BO.
- Pont d'installation PWA.
- ✅ *Verif* : la vitrine d'un club affiche sa config ; un message de contact arrive par email
  et apparaît au BO.

### Phase 5 — Infra domaines & polish
- Wildcard domain Vercel pour les 3 apps ; page "club inconnu/suspendu".
- (Optionnel) amorce custom domain.
- ✅ *Verif* : un nouveau club est joignable sur son sous-domaine sans action Vercel.

### Plus tard (hors périmètre de ce plan)
Billing & self-service signup · custom domains généralisés · autres sports (le champ
`clubs.sport` est déjà prévu) · silo pour gros clients.

### Découpage en PR (1 étape = 1 PR)

Ordre conçu pour ne **jamais casser CAC en prod** (expand → migrate → contract).

> ⚠️ Avant de merger **n'importe laquelle** de ces PR : passer la **checklist §8.4**. L'ordre
> ci-dessous ne protège la prod que si chaque PR y est *réellement* déployée — migrations,
> Edge Functions et config Auth comprises, qui sont des gestes **manuels**. L'oubli de PR3 sur
> prod a mis le BO hors service au merge de PR4.

| PR | Phase | Objet | Sensibilité prod |
|---|---|---|---|
| PR1 ✅ | 1 | Migration SQL socle : `clubs`/`club_members`/`club_settings`/enum/super-admin + `club_id` **nullable** partout + ligne CAC + backfill | non-bloquante |
| PR2 ✅ | 1 | `ClubContext` (résolution hostname→club_id, fallback CAC) + filtrage `.eq('club_id')` partout + clés localStorage TMC préfixées | non-bloquante |
| PR3 ✅ | 1 | **Verrouillage** : `club_id` NOT NULL + FK, RLS multi-tenant + GRANTs + helpers `auth_club_ids()`/`is_super_admin()` + seeding `club_members` (reporté de PR1) | ⚠️ **sensible** (tester sur dev + comptes CAC avant merge) |
| PR4 ✅ | 1 | Invitations portant `club_id`+`role` (+ autorisation `admin` du club dans `invite-user`) + `useClubRole()` + masquage UI par rôle + **garde d'appartenance BO** : un non-membre du club courant se voit refuser l'accès (§3) au lieu d'obtenir un BO monté mais vide. Aucune migration ; script manuel d'attribution des rôles + déploiement manuel de la function. Limites et dettes : §4.1 | non-bloquante |
| PR5 ✅ | 2 | Console super-admin (créer/lister/suspendre un club, inviter le 1er admin, accès support) + **correctif §0** : `is_super_admin` n'est plus auto-attribuable (grants par colonne sur `profiles`). Détail : §5.1 | non-bloquante — mais les **deux** migrations sont à appliquer, la `2026081801` d'abord |
| PR5-bis ✅ | 2 | Gestion des membres d'un club (lister / changer un rôle / retirer / relancer une invitation / inviter) **côté admin de club** — sorti de PR5 pour ne pas transformer la console de provisioning en écran d'administration des comptes. Écran `/admin/members`, qui absorbe `/admin/invite`. **Aucune migration** : tout passe par l'Edge Function `club-members` (service role), à déployer à la main. Détail : §4.2 | non-bloquante — mais la function `club-members` est à **déployer manuellement** (dev puis prod) |
| PR6a ✅ | 3 | **Socle** : contrat `club_settings.config` (`src/lib/clubConfig.ts`, zod, lecture tolérante) + cloisonnement RLS de `club_settings` (dette §2.4) + **cloisonnement Storage** (D12 : préfixe `club_id/`, policies scopées sur les 4 buckets, `content-images` rapatrié) + mutualisation d'`extractStoragePath` dans `src/lib/storage.ts`. **Aucun formulaire.** | ⚠️ **sensible** — migration Storage : un verrouillage ne se voit ni au build ni au typecheck, contrôle fonctionnel réel exigé (§8.4) |
| PR6b ✅ | 3 | Section « Configuration du site » au BO (`/admin/site`, `adminOnly`) : un panneau par groupe, chacun avec son propre enregistrement, sur les **trois groupes du contrat** (`brand`, `home`, `contact`) — `src/lib/clubConfigWrite.ts` (schéma **strict** à l'écriture, `UPDATE` + fusion profonde préservant les clés inconnues) + `SiteConfigPage` + `components/siteConfig/`. Images sous `content-images/<club_id>/config/…`. **Aucune migration** — la policy d'écriture et les GRANT étaient déjà en place, et le bucket réutilisé date de PR6a. `src/lib/clubConfig.ts` **inchangé**. | non-bloquante — première PR de la série **sans opération prod** |
| PR6c ✅ | 3 | Les **quatre groupes globaux** — le *chrome* du site : `social`, `legal`, `settings`, `partners`. Deux **extensions du modèle**, chacune livrée avec le groupe qui l'exerce : le type **`bool`** (branche propre dans le schéma, hors du tuyau des chaînes qui écrirait `'false'` — non vide donc **vrai** ; défaut **positif**, décocher écrit le booléen `false` au lieu d'effacer la clé) et le **groupe-liste** (`partners` reste une **liste à la racine** comme la spec §5.8 que PR9 lira ; `itemsOf()` confine l'union à la lecture et à l'écriture). **Aucune migration**, `CLUB_CONFIG_VERSION` **inchangé** (ajout additif). Détail : §6.1. | non-bloquante — **aucune opération prod** |
| PR6d ✅ | 3 | Les **trois pages de contenu** (`club`, `infra`, `pricing`) — ~45 clés, 8 listes, 4 objets imbriqués — et les **trois extensions** qu'elles seules exercent, chacune confinée à la lecture et à l'écriture du JSONB : **objets imbriqués** (clé de formulaire **plate et sans point** + `path` sur la spec — une clé pointée aurait cassé `setAtPath` en silence et une URL d'image aurait écrasé l'objet entier ; `mergeGroup` fusionne déjà en profondeur, il suffit de lui donner un objet niché), **listes de scalaires** (`scalar: true` + un seul champ : l'état reste des entrées à une clé, donc rendu / ajout / retrait / réordonnancement / remap des fichiers en attente inchangés, et l'emballage `{value}` ne sort jamais du formulaire) et le type **`number`** (branche propre, **vide ≠ zéro** — clé omise, jamais `0` —, schéma **idempotent** car l'écriture revalide sa propre sortie ; `other_fees[].price` reste du **texte**, c'est voulu). `groupSchema`, `formatIssue`, `setAtPath` et le rendu du panneau n'ont connu **aucune** des trois formes. **Aucune migration**, `CLUB_CONFIG_VERSION` **inchangé**. En prime, les dix panneaux sont **repliés par défaut** avec un indicateur « Configuré / À compléter ». ✅ **La configuration est close** — PR9 a son contrat complet. Détail : §6.1. | non-bloquante — **aucune opération prod** |
| PR7 ✅ | 3 | GEN_PROG : **fonds d'affiche par club** — onzième groupe `posters` (deux clés, à part des dix groupes de la vitrine et **en dernier** à l'écran), **gabarit contrôlé avant l'upload** (`dimensions` sur `FieldSpec` : **proportions A4 à 2 % près** — et non une définition au pixel près, les deux gabarits étant de l'A4 dont aucune définition en pixels ne tombe juste — plus une taille minimale ; refus nommant le ratio attendu et le reçu), `crossOrigin="anonymous"` sur les deux fonds (sans quoi l'export sort blanc alors que l'aperçu est parfait), **listes de fonds nommés** avec choix à la génération et suppression, et **génération refusée sans aucun fond** — pas de repli sur les assets CAC, qui réinstallerait du tenant en dur. **Aucune migration**, `CLUB_CONFIG_VERSION` **inchangé**. Détail : §6.2. | non-bloquante en base — mais ⚠️ **une opération de contenu BLOQUANTE** juste après déploiement : sans au moins un fond par affiche ajouté depuis `/admin/site`, le club ne peut plus générer d'affiche |
| PR7-bis ✅ | 3 | **Dé-branding BO + PWA** (cf. §6.2-bis) : textes via `clubs.name`, logo via `brand.logo` sous Storage `club_id/`, manifest PWA au runtime avec fallback Vite | non-bloquante — aucune migration |
| PR8 | 3 | `club_social_credentials` (RLS admin-only) + connexion Facebook + `post-to-facebook` multi-tenant | non-bloquante |
| PR9 | 4 | App `web/` (vitrine) : scaffold + résolution tenant + design tokens + 5 pages rendues depuis `club_settings` | nouvelle app |
| PR10 | 4 | Flux actus & events branchés sur la vitrine (filtrés `club_id`) | non-bloquante |
| PR11 | 4 | Edge Function `contact-form` (Brevo) + table `contact_messages` + réception BO | non-bloquante |
| PR12 | 4 | Pont d'installation PWA depuis la vitrine (mobile) | non-bloquante |
| PR13 | 5 | Page « club inconnu/suspendu » + wildcard `*.feelike.app` sur Vercel | infra |
| *(plus tard)* | — | Custom domain par club : API Vercel + UI + `clubs.custom_domain` (cas CAC ci-dessous) | post-V1 |

### Stratégie de domaine CAC (dogfood)

`cac-tennis.vercel.app` est un **projet de démo** (pas de vrais adhérents → aucune URL à
préserver). Parcours retenu :
1. **V1** : on développe et éprouve tout sur `*.feelike.app` ; CAC sert de club de test réel
   sur `cac-tennis.feelike.app`.
2. **Quand c'est solide** : on bascule CAC sur son propre domaine
   **`tennisclubcastelsarrasin.fr`** via la feature custom domain (post-V1). CAC est ainsi le
   **premier cas de dogfood** du parcours custom domain.
- Le custom domain concerne la **vitrine** (face publique). Le **BO reste sur
  `admin.feelike.app`** (console plateforme). La PWA peut rester sur `*.feelike.app`.
- Note technique : domaine **apex** (`tennisclubcastelsarrasin.fr` sans `www`) → enregistrement
  A vers Vercel ou nameservers Vercel (un cran plus délicat qu'un sous-domaine en CNAME).

---

## 11. Hors périmètre V1 (explicite)

Paiement / abonnement · inscription publique self-service · custom domain par club · isolation
physique (silo) · multi-sport effectif (préparé mais non implémenté) · refonte des modules
métier existants.

---

## 12. Questions tranchées (Phase 0) — récap

Les 6 zones d'ombre du cadrage sont **résolues** :

1. **Schéma de sous-domaines** → D9 : vitrine `<slug>.feelike.app`, PWA `app-<slug>.feelike.app`,
   BO `admin.feelike.app` (console globale).
2. **Domaine racine** → **`feelike.app`**.
3. **Provider d'email** du formulaire de contact → **Brevo**.
4. **Stockage des secrets sociaux** → D10 : table `club_social_credentials`, RLS admin-only.
5. **`club_id` sur `team_match_lines`** → D11 : colonne dénormalisée (patron RLS uniforme).
6. **Buckets Storage** → D12 : buckets par type de contenu, préfixe `club_id/`, écritures scopées.

Reste à préciser **au fil de l'implémentation** (détails, pas de blocage de cadrage) :
- Flux OAuth de connexion Facebook côté admin (Phase 3).
- Schéma exact des tables `clubs` / `club_members` / `club_settings` (Phase 1, à figer avant la 1ʳᵉ migration).
- Modèle de `super_admin` : flag `profiles.is_super_admin` vs table dédiée (Phase 1).

---

## 13. Maintenance documentaire (rappel CLAUDE.md)

À chaque phase implémentée, mettre à jour : `docs/CODEBASE.md` (nouveaux fichiers/tables),
le `docs/specs/*` du module touché (GEN_PROG, ACTUS_FACEBOOK, PWA…), et `README.md` (côté
utilisateur). Créer `docs/specs/WEB_SITE.md` à la Phase 4.
