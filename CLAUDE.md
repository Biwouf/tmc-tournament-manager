# CLAUDE.md

---

## Projet — TMC Tournament Manager

### Contexte produit — SaaS multi-tenant « feelike »

Ce projet évolue d'une app mono-club (CAC Tennis) vers un **produit SaaS multi-tenant**
commercialisable, dont le nom / domaine racine est **`feelike.pro`**. Autrement dit :
**« feelike » = la plateforme SaaS, TMC Tournament Manager = le produit qu'on y rend
multi-tenant, CAC Tennis = le premier club (tenant #1)**. Ces trois termes désignent le même
projet — un « Feelike Migration Tracker » ou toute mention de `feelike.pro` concerne bien
cette codebase.

Architecture cible retenue : base Supabase partagée + `club_id` + RLS, apps uniques (BO / PWA /
site vitrine) avec tenant résolu au runtime par sous-domaine `*.feelike.pro`, provisioning par
un super-admin. Migration livrée en 16 PR réparties en 5 phases.

- **Spec maître** (à lire en premier pour tout sujet multi-tenant) : `docs/specs/MULTI_TENANT.md`
  — décisions D1–D12, modèle de données, plan de livraison et découpage en PR.
- **Suivi d'avancement** : artifact claude.ai « Migration multi-tenant feelike » (statut des 16 PR, ops de déploiement, dettes ouvertes). L'ancien artefact Cowork `feelike-migration-tracker` est figé au 20/08/2026 — ne plus s'y référer.

### Règle absolue — pas de développement via Cowork

**Aucune modification de code via Cowork**, sauf si l'utilisateur le demande explicitement dans le message. Tout le développement se fait via Claude Code (ou Codex), dans un worktree dédié (cf. ci-dessous) ; l'utilisateur choisit le modèle adapté.

### Workflow Git — worktrees

Mêmes règles que `AGENTS.md` (Codex) — garder les deux fichiers synchronisés.

**Règles :**
- Toujours travailler dans un worktree dédié à la tâche, sur une branche dédiée, **avant toute modification de fichiers** (code ou doc). Réutiliser un worktree existant uniquement s'il est déjà dédié à cette même tâche.
- Ne jamais développer directement sur `main` ni dans le checkout principal `tmc-tournament-manager`. Une exception ponctuelle explicitement autorisée par l'utilisateur ne vaut que pour la tâche concernée et ne doit pas être reproduite.
- Créer tout nouveau worktree comme **dossier frère** de `tmc-tournament-manager`, directement sous `/Users/m.tresalmauroz/Desktop/perso`, avec un nom explicite préfixé par `tmc-` (modèle : `/Users/m.tresalmauroz/Desktop/perso/tmc-pr9-vitrine`).
- Ne pas créer de worktree dans `/private/tmp`, dans `.claude/worktrees/` ni à l'intérieur du dépôt, sauf demande explicite de l'utilisateur. Ne pas utiliser `EnterWorktree` (il crée ses worktrees dans `.claude/worktrees/`) : passer par `git worktree add`.
- Avant toute création, vérifier avec `git worktree list` que le chemin cible et la branche ne sont pas déjà utilisés.
- Ne jamais toucher aux autres worktrees.

**Configuration locale après création :**
- Copier depuis le checkout principal les fichiers `.env.local`, `pwa/.env.local` et `web/.env.local` existants vers les mêmes chemins relatifs du nouveau worktree.
- Avant chaque copie, vérifier que la destination est ignorée par Git (`git check-ignore -q -- <chemin>`) et non suivie (`git ls-files -- <chemin>` ne retourne rien). Sinon, ne pas copier et signaler le problème.
- Ne jamais écraser une destination existante, y compris un lien symbolique. Une source absente est simplement ignorée.
- Ne jamais afficher le contenu de ces fichiers, le consigner dans les logs ou le versionner, même avec `git add -f`. Ne copier aucun autre fichier de secrets.
- Ces valeurs donnent accès aux mêmes services que le checkout principal ; la copie n'autorise pas à modifier ou déployer les services distants.
- `docs/briefs/` est gitignoré : copier aussi le brief de la tâche depuis le checkout principal s'il est nécessaire.

**Commandes utiles :**
```bash
# Créer un worktree sur une nouvelle branche
git worktree add ../tmc-<nom-tache> -b <branche> main

# Lister les worktrees actifs
git worktree list

# Supprimer un worktree après merge de la PR
git worktree remove ../tmc-<nom-tache>
```

### Première action obligatoire

Avant toute intervention sur le code, lire **`docs/CODEBASE.md`** pour avoir la carte d'architecture à jour.

### Specs fonctionnelles

Les specs sont dans `docs/specs/` :
- `SCHEDULING_RULES.md` — règles de l'algo de planification
- `GEN_PROG.md` — module Programmation Image
- `LIVE_SCORE.md` — module Live Score (BO + PWA)
- `PWA.md` — PWA CAC Tennis (architecture, fonctionnalités, PTR)
- `ACTUS.md` — module Actus (BO + PWA + publication Facebook)
- `EVENTS.md` — module Événements
- `SHARED_COMPONENTS.md` — composants partagés
- *(nouveaux modules → créer un fichier dédié dans ce dossier)*

### Briefs de feature et de correctif

Tout brief de feature ou de correctif (contexte, objectif, périmètre) doit être déposé dans **`docs/briefs/`** avant de commencer le développement. Ce dossier est dans le `.gitignore` — les briefs ne sont pas versionnés.

### Migrations Supabase

Les migrations vivent dans `supabase/migrations/`. Convention de nommage :
`YYYYMMDD_<nom_court>.sql` — ex. `20260423_live_matches.sql`.

⚠️ La CLI Supabase dérive la `version` de migration des **chiffres de tête** du nom de
fichier. Deux migrations le même jour doivent donc être désambiguïsées par un suffixe de
séquence à 2 chiffres : `YYYYMMDDNN` — ex. `2026042601_actus.sql` puis
`2026042602_actus_image_urls.sql`. Sinon `supabase db push` échoue avec
`duplicate key value violates unique constraint "schema_migrations_pkey"`.

Application : via le dashboard Supabase (SQL Editor) ou `supabase db push` en CLI.
Pour connaître le schéma actuel d'une table, lire la dernière migration qui la concerne
— ne pas supposer depuis les types TypeScript.

### Maintenance de la documentation

Après chaque changement fonctionnel, mettre à jour sans qu'on le demande :

| Si… | Alors mettre à jour… |
|---|---|
| Logique d'un module change (scheduler, tmcLogic, moveMatch, ProgrammationImage) | Le fichier spec correspondant dans `docs/specs/` |
| Nouveau fichier `src/` créé ou rôle d'un fichier existant change | `docs/CODEBASE.md` |
| Fonctionnalité ajoutée ou modifiée côté utilisateur | `README.md` |

---

## Guidelines de développement

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs. Ask questions.**

Before implementing:
- State your assumptions explicitly. If uncertain, **ask** — don't guess silently.
- If multiple interpretations exist, present them and ask which one to follow.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- **Don't wait for the user to ask "did you have questions?" — pose them proactively**, before writing a single line of code.
- If the task involves a field described as "already existing" or "already wired",
  verify it before starting: check the producer's insert payload, the TypeScript types
  (BO + PWA), and the latest migration. A brief can be wrong about the current state
  of the system.
- If reading the code reveals that the brief rests on a false premise (a field that
  doesn't exist, a column that was never added), stop and surface it before writing
  any code — regardless of how narrow the stated scope is.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

Adding a field to a Supabase table touches 4 layers — every one of them:
1. Migration SQL (new column)
2. TypeScript type(s) — BO `src/types.ts` and/or `pwa/src/types.ts`
3. Producer(s) — the insert/update payload(s) that write the field
4. Consumer(s) — the UI component(s) that read and display it

If the brief only names the consumer, check whether the other layers are already in
place before starting. If any layer is missing, flag it and confirm scope before
expanding.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
