-- Multi-tenant — PR6a : contrat de configuration + cloisonnement du Storage.
-- Voir docs/specs/MULTI_TENANT.md (§2.4, §6.1, D12) et docs/briefs/PR6a_socle_config_storage.md.
--
-- Deux dettes fermées ici :
--   1. `club_settings` était lisible par TOUT compte authentifié (`USING (true)`, PR1) —
--      dette §2.4, explicitement due « avant PR6 ». La config de chaque club devient
--      significative à partir de cette PR : la fermer maintenant, pas après.
--   2. Les policies Storage étaient ouvertes à l'échelle du bucket : tout membre d'un club
--      pouvait écraser ou supprimer les images de n'importe quel autre. PR3 a verrouillé les
--      10 tables métier et laissé le Storage dehors — c'est la dernière fuite entre clubs.
--
-- ⚠️ REQUÊTE DE PRÉ-VOL — à passer sur dev PUIS sur prod avant application.
-- Le bucket `content-images` n'est créé par AUCUNE migration : il a été créé au dashboard et
-- ses policies portent des noms inconnus de ce dépôt (même cas que §8.4 pour les policies
-- `anon` de events / live_matches). Le §3 ci-dessous les balaye par leur DÉFINITION plutôt
-- que par leur nom, mais il faut savoir ce qu'on supprime :
--
--   SELECT policyname, roles, cmd, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--    ORDER BY policyname;
--
-- Toute policy de LECTURE (cmd = SELECT) doit survivre : la vitrine et la PWA déconnectée
-- en dépendent. Ce fichier ne touche qu'INSERT / UPDATE / DELETE.

-- ============================================================
-- 1. Cloisonnement de club_settings (dette §2.4)
-- ============================================================
-- Patron `tenant_isolation` de PR3. Les policies d'écriture super-admin de PR5
-- (`club_settings_insert_super_admin` / `_update_super_admin`) sont volontairement
-- CONSERVÉES : la console en a besoin pour réparer un club dont la ligne manquerait.
DROP POLICY IF EXISTS "club_settings_select_authenticated" ON public.club_settings;

DROP POLICY IF EXISTS "club_settings_select_tenant" ON public.club_settings;
CREATE POLICY "club_settings_select_tenant"
  ON public.club_settings FOR SELECT TO authenticated
  USING (club_id IN (SELECT public.auth_club_ids()) OR public.is_super_admin());

-- Écriture par l'admin DU club (brief §4 : l'écriture est dans PR6a, les formulaires qui la
-- consomment sont PR6b). `auth_club_ids()` ne dit pas le rôle et `is_super_admin()` ne dit
-- pas le club : ni l'un ni l'autre n'exprime « es-tu admin de CE club ». Un EXISTS explicite
-- sur club_members le fait sans introduire un helper de rôle en base — le helper
-- `auth_club_role()` que réclame la dette §4.1 reste à poser par sa PR dédiée, qui l'appliquera
-- partout d'un coup plutôt qu'ici pour un seul appelant.
--
-- Pas de policy DELETE : une ligne club_settings vit et meurt avec son club
-- (ON DELETE CASCADE + trigger `clubs_create_settings` de PR5). La supprimer seule ne
-- correspond à aucun geste produit.
DROP POLICY IF EXISTS "club_settings_update_club_admin" ON public.club_settings;
CREATE POLICY "club_settings_update_club_admin"
  ON public.club_settings FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.club_members m
       WHERE m.club_id = club_settings.club_id
         AND m.user_id = auth.uid()
         AND m.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.club_members m
       WHERE m.club_id = club_settings.club_id
         AND m.user_id = auth.uid()
         AND m.role = 'admin'
    )
  );

-- GRANT SELECT (PR1) et GRANT INSERT, UPDATE (PR5) déjà posés. Rien à ajouter : la policy
-- ci-dessus s'appuie sur le GRANT UPDATE existant.
--
-- Lecture `anon` : volontairement NON ouverte (brief §8 Q2). La vitrine (PR9) en aura besoin,
-- mais l'ouvrir maintenant rouvrirait à `anon` la dette qu'on ferme à `authenticated`. PR9
-- ouvrira une lecture `anon` restreinte aux clés publiques.

-- ============================================================
-- 2. Garde-fou club_settings — façon PR3 (§7 de 20260816)
-- ============================================================
-- La prod porte des policies créées à la main au dashboard, absentes du dépôt (§8.4). Une
-- policy résiduelle `USING (true)` sur club_settings viderait le §1 de sa substance en
-- silence : mieux vaut que la migration lève.
DO $$
DECLARE leftovers text;
BEGIN
  SELECT string_agg(policyname, ', ')
    INTO leftovers
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'club_settings'
     AND policyname NOT IN ('club_settings_select_tenant',
                            'club_settings_update_club_admin',
                            'club_settings_insert_super_admin',
                            'club_settings_update_super_admin')
     AND roles && ARRAY['authenticated','public','anon']::name[];
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'Policy(ies) non cloisonnée(s) restante(s) sur club_settings : %. Isolation incomplète — dropper ou re-scoper avant de rejouer PR6a.', leftovers;
  END IF;
END $$;

-- ============================================================
-- 3. Bucket content-images — rapatriement dans le dépôt (brief §8 Q3)
-- ============================================================
-- Créé au dashboard, jamais versionné : angle mort permanent. On le déclare ici pour que ses
-- policies vivent dans le dépôt comme celles des trois autres buckets.
INSERT INTO storage.buckets (id, name, public)
VALUES ('content-images', 'content-images', true)
ON CONFLICT (id) DO NOTHING;

-- Lecture publique — alignée sur les trois autres buckets. Les images inline vivent dans le
-- corps markdown des actus et des events, rendus par la PWA déconnectée.
DROP POLICY IF EXISTS "content_images_read" ON storage.objects;
CREATE POLICY "content_images_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'content-images');

-- ============================================================
-- 4. Purge des policies d'écriture ouvertes sur les 4 buckets
-- ============================================================
-- Les policies versionnées ont des noms connus, mais celles de `content-images` (et toute
-- policy ajoutée à la main sur les autres buckets) n'en ont pas. On balaye donc par
-- DÉFINITION : toute policy INSERT/UPDATE/DELETE sur storage.objects qui mentionne l'un des
-- 4 buckets est supprimée, quel que soit son nom. Les policies SELECT sont épargnées — la
-- lecture publique doit rester inchangée.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename  = 'objects'
       AND cmd <> 'SELECT'
       AND COALESCE(qual, '') || ' ' || COALESCE(with_check, '') ~
           '(actu-images|event-images|team-match-photos|content-images)'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p.policyname);
  END LOOP;
END $$;

-- ============================================================
-- 5. Helper de cloisonnement Storage (D12)
-- ============================================================
-- Un seul endroit porte la règle, pour les 12 policies du §6 (4 buckets × INSERT/UPDATE/DELETE).
-- La dupliquer 12 fois, c'est 12 occasions de rater le piège du cast ci-dessous.
--
-- ⚠️ AUCUN cast ::uuid sur storage.foldername. `(storage.foldername(name))[1]` est du `text`,
-- et un objet legacy a un premier segment qui n'est pas un UUID (`inline`, ou un id d'actu) :
-- un `::uuid` ferait échouer la requête entière (22P02 invalid input syntax for type uuid).
-- Une policy n'est pas censée lever, elle est censée renvoyer faux. On compare en texte.
CREATE OR REPLACE FUNCTION public.can_write_club_object(object_name text)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    -- Cas nominal : le 1er segment est un club dont l'appelant est membre.
    (storage.foldername(object_name))[1] IN (SELECT c::text FROM public.auth_club_ids() AS c)

    -- Super-admin. Nécessaire, et pas seulement par confort : tant que PR13 n'a pas posé le
    -- wildcard *.feelike.app, l'override de support (ClubContext `enterSupportClub`) est le
    -- SEUL moyen d'atteindre un 2e club — or un super-admin en support n'est pas membre du
    -- club visité, donc `auth_club_ids()` ne le couvre pas. Sans cette branche, la console
    -- ne peut rien uploader dans le club qu'elle administre.
    OR public.is_super_admin()

    -- ⚠️ LEGACY — TEMPORAIRE, posé le 2026-08-22 (brief §7.3, voie (b) « grandfather »).
    -- Les objets antérieurs à cette migration n'ont pas de préfixe club : sans cette clause
    -- ils deviendraient NON SUPPRIMABLES, et « supprimer une actu » casserait en prod sur des
    -- données réelles. On tolère donc les chemins dont le 1er segment n'est pas un UUID, et
    -- on les réserve aux membres de CAC — seul club à en posséder.
    -- À RETIRER par la PR de nettoyage (voie (a) : déplacer les objets + réécrire les URL en
    -- base ET dans le corps markdown), à planifier dès qu'un 2e club réel existera.
    -- Tracé dans MULTI_TENANT.md §2.4.
    -- COALESCE : un objet posé à la racine du bucket donne un foldername vide, donc [1] NULL.
    -- Sans lui la clause rendrait NULL (donc faux) et l'objet serait non supprimable.
    OR (
      COALESCE((storage.foldername(object_name))[1], '') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM public.clubs c
         WHERE c.slug = 'cac-tennis'
           AND c.id IN (SELECT public.auth_club_ids())
      )
    )
$$;

GRANT EXECUTE ON FUNCTION public.can_write_club_object(text) TO authenticated;

-- ============================================================
-- 6. Policies Storage scopées au club (D12, brief §7.2)
-- ============================================================
-- Lecture publique INCHANGÉE (policies `*_read` de 20260418 / 2026042601 / 20260606 + §3
-- ci-dessus) : la vitrine et la PWA déconnectée en dépendent.
--
-- UPDATE inclus : aucun `.upload()` du BO n'utilise `upsert: true` aujourd'hui (vérifié sur
-- les 4 appels), mais le pré-vol a montré qu'une policy UPDATE existe en base
-- (`cac_buckets_authenticated_update`, dashboard, les 4 buckets d'un coup). Ne pas la
-- recréer serait retirer une capacité, pas seulement cloisonner — hors périmètre. Et PR7
-- (background d'affiche) comme PR7-bis (logos) voudront des chemins STABLES remplacés à
-- chaque upload, donc `upsert: true`, donc UPDATE. Même helper, même protection.
--
-- Pas de `DROP POLICY IF EXISTS` ici, et c'est volontaire : les policies ci-dessous nomment
-- leur bucket dans le WITH CHECK / USING, donc un rejeu de la migration les fait tomber dans
-- la purge du §4 avant d'arriver ici. C'est ce qui rend ce fichier idempotent — ne pas
-- restreindre le §4 sans remettre les DROP.
CREATE POLICY "actu_images_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'actu-images' AND public.can_write_club_object(name));

CREATE POLICY "actu_images_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'actu-images' AND public.can_write_club_object(name));

CREATE POLICY "actu_images_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'actu-images' AND public.can_write_club_object(name))
  WITH CHECK (bucket_id = 'actu-images' AND public.can_write_club_object(name));

CREATE POLICY "event_images_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'event-images' AND public.can_write_club_object(name));

CREATE POLICY "event_images_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'event-images' AND public.can_write_club_object(name));

CREATE POLICY "event_images_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'event-images' AND public.can_write_club_object(name))
  WITH CHECK (bucket_id = 'event-images' AND public.can_write_club_object(name));

CREATE POLICY "team_match_photos_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'team-match-photos' AND public.can_write_club_object(name));

CREATE POLICY "team_match_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'team-match-photos' AND public.can_write_club_object(name));

CREATE POLICY "team_match_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'team-match-photos' AND public.can_write_club_object(name))
  WITH CHECK (bucket_id = 'team-match-photos' AND public.can_write_club_object(name));

CREATE POLICY "content_images_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'content-images' AND public.can_write_club_object(name));

CREATE POLICY "content_images_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'content-images' AND public.can_write_club_object(name));

CREATE POLICY "content_images_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'content-images' AND public.can_write_club_object(name))
  WITH CHECK (bucket_id = 'content-images' AND public.can_write_club_object(name));

-- ============================================================
-- 7. Garde-fou Storage — aucune policy d'écriture ouverte ne doit subsister
-- ============================================================
-- Symétrique du §2. Deux cas rendraient le §6 décoratif : une policy d'écriture qui vise l'un
-- de nos buckets sans passer par le helper, ou une policy qui ne restreint AUCUN bucket (elle
-- s'applique alors aussi aux nôtres). Les policies d'un bucket tiers sont épargnées — elles ne
-- concernent pas cette PR et faire échouer la migration sur elles serait un faux positif.
DO $$
DECLARE leftovers text;
BEGIN
  SELECT string_agg(policyname, ', ')
    INTO leftovers
    FROM pg_policies
   WHERE schemaname = 'storage'
     AND tablename  = 'objects'
     AND cmd <> 'SELECT'
     AND roles && ARRAY['authenticated','public','anon']::name[]
     AND COALESCE(qual, '') || ' ' || COALESCE(with_check, '') !~ 'can_write_club_object'
     AND (
       COALESCE(qual, '') || ' ' || COALESCE(with_check, '') ~
         '(actu-images|event-images|team-match-photos|content-images)'
       OR COALESCE(qual, '') || ' ' || COALESCE(with_check, '') !~ 'bucket_id'
     );
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'Policy(ies) d''écriture non cloisonnée(s) sur storage.objects : %. Elles s''appliquent à tous les buckets et vident PR6a de sa substance — dropper ou re-scoper avant de rejouer.', leftovers;
  END IF;
END $$;

-- ============================================================
-- ROLLBACK (brief §11)
-- ============================================================
-- Symétrique : le legacy n'a PAS été déplacé (voie (b)), donc aucune donnée n'est à remettre
-- en place. Rejouer les policies d'origine suffit :
--
--   DROP POLICY IF EXISTS "club_settings_select_tenant"     ON public.club_settings;
--   DROP POLICY IF EXISTS "club_settings_update_club_admin" ON public.club_settings;
--   CREATE POLICY "club_settings_select_authenticated"
--     ON public.club_settings FOR SELECT TO authenticated USING (true);
--
--   -- Storage : les 12 policies ci-dessus, re-créées sans la condition de club
--   -- (cf. 20260418_events.sql:50, 2026042601_actus.sql:52, 20260606_team_matches.sql:135) :
--   --   FOR INSERT TO authenticated WITH CHECK (bucket_id = '<bucket>');
--   --   FOR DELETE TO authenticated USING      (bucket_id = '<bucket>');
--   --   FOR UPDATE TO authenticated USING/WITH CHECK (bucket_id = '<bucket>');
--   -- Le dashboard portait en plus la famille `cac_buckets_*` (les 4 buckets d'un coup,
--   -- INSERT/UPDATE/DELETE + un SELECT public), non versionnée : la purge du §4 l'a
--   -- supprimée. Le SELECT `cac_buckets_public_read`, lui, a survécu.
--   DROP FUNCTION IF EXISTS public.can_write_club_object(text);
--
-- Les objets uploadés APRÈS cette migration gardent leur préfixe club_id/ — sans effet, les
-- policies d'origine ignorent le chemin. Le bucket content-images reste déclaré : le
-- supprimer effacerait ses objets.
