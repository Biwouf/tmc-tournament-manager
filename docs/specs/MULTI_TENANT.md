# MULTI_TENANT.md — Passage en architecture multi-tenant (SaaS)

> **Statut : en cours — PR1 à PR3 livrées (cf. tableau « Découpage en PR » ci-dessous).**
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

| Table | Policy PR1 | Portée réelle | Quand ça devient un problème |
|---|---|---|---|
| `club_settings` | `FOR SELECT TO authenticated USING (true)` | tout compte authentifié lit la config de **tous** les clubs | dès **PR6**, quand le JSONB portera la config de chaque club (aujourd'hui vide, donc sans conséquence) |
| `profiles` | lecture libre `authenticated` **et** `anon` | prénoms/noms de **tous** les membres de **tous** les clubs, y compris hors authentification | dès le 2ᵉ club réel en production |

`clubs` est volontairement lisible par tous : c'est la condition de la résolution du tenant
avant authentification (§3). `club_members` est déjà restreinte (`user_id = auth.uid()`).

À traiter **avant PR6** pour `club_settings`. Pour `profiles`, le cloisonnement passe par
`club_members` (un profil est visible s'il partage un club avec le demandeur) — attention à
ne pas casser la lecture `anon` dont dépend l'affichage du gestionnaire d'un live en PWA.

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
  ligne `club_members` à l'acceptation.

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

---

## 6. Configuration tenant

Trois familles de config par club, toutes administrables par l'**admin** du club depuis le BO :

### 6.1 Config du site vitrine
Les ~80 variables du `web_site_brief.md` (`brand.*`, `home.*`, `club.*`, `infra.*`,
`pricing.*`, `contact.*`, `social.*`, `partners`, `legal.*`, `settings.*`).
- **Stockage** : `club_settings.config` en **JSONB** (arbre unique, versionnable, souple
  pour les `list<…>`). Schéma validé côté app (zod ou équivalent).
- **Images** (logos, hero, portraits, courts…) : voir **D12** — buckets **par type de
  contenu** (peu nombreux, stables), chemins **préfixés `club_id/`** (ex.
  `vitrine/{club_id}/hero.jpg`). Policies Storage : **écriture/suppression scopées au club**
  (l'admin n'écrit que sous son préfixe), **lecture publique** pour le contenu public
  (actus, events, vitrine). On n'ouvre **pas** un bucket par club (ne scale pas).
- **Nouvelle section BO** « Configuration du site » : un formulaire par groupe de préfixe
  (Identité, Accueil, Le Club, Infrastructures, Tarifs, Contact, Réseaux, Partenaires,
  Légal, Réglages d'affichage).

### 6.2 GEN_PROG — background personnalisé
Le module Programmation Image utilise aujourd'hui un fond figé. En multi-tenant, chaque club
doit pouvoir **uploader son propre background d'affiche**. → champ image dans la config club,
consommé par `ProgrammationImagePage` / `TeamMatchImagePreview`. (cf. `docs/specs/GEN_PROG.md`
à mettre à jour le moment venu.)

### 6.2-bis Identité visuelle des apps internes (BO + PWA)

Le §6.1 ci-dessus ne couvre que la **vitrine**. Or l'objectif produit est un cloisonnement
**graphique et textuel complet des trois surfaces** : BO, vitrine et PWA doivent porter le
nom, les couleurs et les logos du club courant. Aujourd'hui BO et PWA sont **codés en dur
aux couleurs de CAC**. Inventaire du dur, par difficulté :

| Niveau | Emplacements | Levier |
|---|---|---|
| Texte | `src/pages/AppHomePage.tsx` (h1), `pwa/src/components/layout/headerConfig.ts` (titre root), `pwa/src/components/install/InstallBanner.tsx` (slogan), `pwa/index.html` (`<title>`) | **`clubs.name`**, déjà exposé par `useClub()` — aucun nouveau champ requis |
| Images | `/logo.png` (BO), icônes PWA (`/icons/*`) | Storage préfixé `club_id/` (D12) + champ de config club |
| Manifest PWA | `pwa/vite.config.ts` → `name`, `short_name`, `icons` | ⚠️ **figés au build** — voir question ouverte ci-dessous |

> ⚠️ **Question ouverte, à trancher avant PR9/PR13.** Une PWA **unique** servant N clubs (D2)
> ne peut pas porter un manifest statique : le nom et l'icône sur l'écran d'accueil sont
> résolus au build, pas au runtime. Deux pistes : (a) manifest **généré au runtime** et
> injecté via un `<link rel="manifest">` pointant sur une route/blob par tenant ; (b) un
> déploiement PWA par club — ce qui **contredirait D2**. Comme D9 prévoit
> `app-<slug>.feelike.app`, c'est un livrable visible par l'adhérent : à décider avant, pas
> pendant. Le volet texte (`clubs.name`) est en revanche livrable indépendamment et à tout
> moment.

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
- Extension du flux d'invitation (porte `club_id` + `role`).
- Hook `useClubRole()` + masquage UI par rôle.
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

| PR | Phase | Objet | Sensibilité prod |
|---|---|---|---|
| PR1 ✅ | 1 | Migration SQL socle : `clubs`/`club_members`/`club_settings`/enum/super-admin + `club_id` **nullable** partout + ligne CAC + backfill | non-bloquante |
| PR2 ✅ | 1 | `ClubContext` (résolution hostname→club_id, fallback CAC) + filtrage `.eq('club_id')` partout + clés localStorage TMC préfixées | non-bloquante |
| PR3 ✅ | 1 | **Verrouillage** : `club_id` NOT NULL + FK, RLS multi-tenant + GRANTs + helpers `auth_club_ids()`/`is_super_admin()` + seeding `club_members` (reporté de PR1) | ⚠️ **sensible** (tester sur dev + comptes CAC avant merge) |
| PR4 | 1 | Invitations portant `club_id`+`role` + `useClubRole()` + masquage UI par rôle + **garde d'appartenance BO** : un non-membre du club courant se voit refuser l'accès (§3) au lieu d'obtenir un BO monté mais vide, comme aujourd'hui | non-bloquante |
| PR5 | 2 | Console super-admin (créer/lister/suspendre un club, inviter le 1er admin) | non-bloquante |
| PR6 | 3 | Section « Configuration du site » au BO (`club_settings.config` + formulaires) *(scindable en 2)* — **inclut le cloisonnement RLS de `club_settings`**, cf. §2.4 | non-bloquante |
| PR7 | 3 | GEN_PROG : background d'affiche par club | non-bloquante |
| PR7-bis | 3 | **Dé-branding BO + PWA** (cf. §6.2-bis) : textes via `clubs.name`, logos/icônes via Storage `club_id/`, manifest PWA au runtime | non-bloquante — le volet texte est livrable seul |
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
