-- SaaS S8b — remplir le site depuis la page Ten'Up du club (brief SAAS_10_S8b, décisions du 14/11/2026).
--
-- 1. `clubs.tenup_club_id` : identifiant du club sur Ten'Up (`https://tenup.fft.fr/club/<id>`).
--    Posé par le service role seulement (Edge `tenup-sync` à la réussite de la lecture de la page
--    du club, Edge `tenup-site` à la réussite d'une lecture du profil) : `authenticated` n'a
--    toujours que `UPDATE (status)` sur `clubs` (2026102601). Lisible comme les autres colonnes de
--    `clubs` : c'est une donnée publique de Ten'Up.
-- 2. `club_tenup_site_reads` : compteur des lectures du profil, À PART du plafond d'essai
--    (décision 3 : la lecture du profil ne compte pas dans les 40 lectures / 24 h). Une lecture
--    réussie (ou en cours depuis moins de 2 minutes) par club et par 24 h, lecture en tâche de
--    fond comprise ; une lecture en échec ne compte pas, mais 3 échecs par 24 h bloquent
--    (décision du 14/11/2026, comme `2026111320_tenup_failed_reads.sql`).
-- 3. `club_tenup_site_proposals` : la proposition (une par club), gardée jusqu'à l'enregistrement
--    ou la lecture suivante. Lisible des seuls admins du club ; écrite par le service role.
-- 4. RPC pour les admins : `club_tenup_site_begin` (contrôle avant lecture), `club_tenup_site_state`
--    (état pour `/admin/site`), `club_tenup_site_consume` (proposition consommée à l'enregistrement).
-- Clubs `internal` (le CAC) : aucune lecture (décision 6). Idempotente. Jamais de SQLSTATE 40001.
BEGIN;

ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS tenup_club_id text;
DO $$ BEGIN
  ALTER TABLE public.clubs ADD CONSTRAINT clubs_tenup_club_id_format CHECK (tenup_club_id ~ '^[0-9]{1,12}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.club_tenup_site_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tenup_club_id text NOT NULL CHECK (tenup_club_id ~ '^[0-9]{1,12}$'),
  background boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_tenup_site_reads_club ON public.club_tenup_site_reads(club_id, created_at);
ALTER TABLE public.club_tenup_site_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_tenup_site_reads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.club_tenup_site_reads TO service_role;

CREATE TABLE IF NOT EXISTS public.club_tenup_site_proposals (
  club_id uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  tenup_club_id text NOT NULL CHECK (tenup_club_id ~ '^[0-9]{1,12}$'),
  payload jsonb NOT NULL,
  -- Chemins `content-images` des images copiées pour cette proposition (logo, bandeau).
  images text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'consumed')),
  read_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.club_tenup_site_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_tenup_site_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.club_tenup_site_proposals TO authenticated;
GRANT ALL ON public.club_tenup_site_proposals TO service_role;

-- Admin d'un club actif, ou super-admin (même garde que `club_set_site_published`).
CREATE OR REPLACE FUNCTION public.club_tenup_site_is_admin(p_club uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM club_members m JOIN clubs c ON c.id = m.club_id
     WHERE m.club_id = p_club AND m.user_id = auth.uid() AND m.role = 'admin' AND c.status = 'active'))
$$;
REVOKE ALL ON FUNCTION public.club_tenup_site_is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_tenup_site_is_admin(uuid) TO authenticated;

DROP POLICY IF EXISTS "club_tenup_site_proposals_select_admin" ON public.club_tenup_site_proposals;
CREATE POLICY "club_tenup_site_proposals_select_admin" ON public.club_tenup_site_proposals
  FOR SELECT TO authenticated USING (public.club_tenup_site_is_admin(club_id));

-- Contrôle avant une lecture du profil (appelée par l'Edge `tenup-site` avec le JWT de l'admin).
-- `p_tenup_id` : lien collé ; NULL = l'identifiant enregistré (lecture en tâche de fond).
-- En tâche de fond, un refus attendu (pas d'identifiant, lecture récente, échecs) rend
-- `{started: false, reason}` au lieu d'une erreur : la lecture n'a simplement pas lieu.
CREATE OR REPLACE FUNCTION public.club_tenup_site_begin(p_club uuid, p_tenup_id text DEFAULT NULL, p_background boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target text;
  last_ok timestamptz;
  failures integer;
  read_id uuid;
BEGIN
  IF NOT public.club_tenup_site_is_admin(p_club) THEN
    RAISE EXCEPTION 'Réservé aux administrateurs du club.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM clubs WHERE id = p_club AND plan = 'internal') THEN
    RAISE EXCEPTION 'Le remplissage depuis Ten’Up n’est pas proposé pour ce club.' USING ERRCODE = '42501';
  END IF;
  IF p_tenup_id IS NOT NULL AND p_tenup_id !~ '^[0-9]{1,12}$' THEN
    RAISE EXCEPTION 'Lien du club Ten’Up invalide.';
  END IF;
  target := coalesce(p_tenup_id, (SELECT tenup_club_id FROM clubs WHERE id = p_club));
  IF target IS NULL THEN
    IF p_background THEN RETURN jsonb_build_object('started', false, 'reason', 'no_id'); END IF;
    RAISE EXCEPTION 'Collez le lien de votre club sur Ten’Up.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('tenup-site:' || p_club::text, 0));
  DELETE FROM club_tenup_site_reads WHERE club_id = p_club AND created_at < now() - interval '2 days';
  -- Lecture réussie, ou en cours depuis moins de 2 minutes (le délai du worker est de 50 s).
  SELECT max(created_at) INTO last_ok FROM club_tenup_site_reads
   WHERE club_id = p_club AND created_at > now() - interval '1 day'
     AND (status = 'done' OR (status = 'running' AND created_at > now() - interval '2 minutes'));
  IF last_ok IS NOT NULL THEN
    IF p_background THEN RETURN jsonb_build_object('started', false, 'reason', 'recent'); END IF;
    IF last_ok > now() - interval '2 minutes' AND EXISTS (SELECT 1 FROM club_tenup_site_reads
        WHERE club_id = p_club AND status = 'running' AND created_at = last_ok) THEN
      RAISE EXCEPTION 'Lecture Ten’Up déjà en cours. Patientez une minute.';
    END IF;
    RAISE EXCEPTION 'Votre club a déjà été lu sur Ten’Up dans les dernières 24 heures. Nouvelle lecture possible le % .',
      to_char((last_ok + interval '1 day') AT TIME ZONE 'Europe/Paris', 'DD/MM à HH24"h"MI');
  END IF;
  -- Échecs (ou lectures restées « en cours » au-delà de 2 minutes : Edge interrompue).
  SELECT count(*) INTO failures FROM club_tenup_site_reads
   WHERE club_id = p_club AND created_at > now() - interval '1 day'
     AND (status = 'failed' OR (status = 'running' AND created_at <= now() - interval '2 minutes'));
  IF failures >= 3 THEN
    IF p_background THEN RETURN jsonb_build_object('started', false, 'reason', 'failures'); END IF;
    RAISE EXCEPTION 'Ten’Up n’a pas répondu à trois lectures aujourd’hui. Réessayez demain, ou remplissez le site à la main.';
  END IF;
  INSERT INTO club_tenup_site_reads(club_id, actor_id, tenup_club_id, background)
    VALUES (p_club, auth.uid(), target, p_background) RETURNING id INTO read_id;
  RETURN jsonb_build_object('started', true, 'read_id', read_id, 'tenup_club_id', target);
END $$;
REVOKE ALL ON FUNCTION public.club_tenup_site_begin(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_tenup_site_begin(uuid, text, boolean) TO authenticated;

-- État pour `/admin/site` : proposé ou non, identifiant connu, lecture en cours, prochaine lecture.
CREATE OR REPLACE FUNCTION public.club_tenup_site_state(p_club uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE last_ok timestamptz; running boolean; failures integer;
BEGIN
  IF NOT public.club_tenup_site_is_admin(p_club) THEN
    RAISE EXCEPTION 'Réservé aux administrateurs du club.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM clubs WHERE id = p_club AND plan = 'internal') THEN
    RETURN jsonb_build_object('available', false);
  END IF;
  SELECT max(created_at) INTO last_ok FROM club_tenup_site_reads
   WHERE club_id = p_club AND created_at > now() - interval '1 day' AND status = 'done';
  running := EXISTS (SELECT 1 FROM club_tenup_site_reads
   WHERE club_id = p_club AND status = 'running' AND created_at > now() - interval '2 minutes');
  SELECT count(*) INTO failures FROM club_tenup_site_reads
   WHERE club_id = p_club AND created_at > now() - interval '1 day'
     AND (status = 'failed' OR (status = 'running' AND created_at <= now() - interval '2 minutes'));
  RETURN jsonb_build_object(
    'available', true,
    'tenup_club_id', (SELECT tenup_club_id FROM clubs WHERE id = p_club),
    'running', running,
    'next_read_at', CASE WHEN last_ok IS NULL THEN NULL ELSE last_ok + interval '1 day' END,
    'failures', failures);
END $$;
REVOKE ALL ON FUNCTION public.club_tenup_site_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_tenup_site_state(uuid) TO authenticated;

-- Enregistrement de la relecture : la proposition est consommée (elle ne s'affiche plus).
CREATE OR REPLACE FUNCTION public.club_tenup_site_consume(p_club uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.club_tenup_site_is_admin(p_club) THEN
    RAISE EXCEPTION 'Réservé aux administrateurs du club.' USING ERRCODE = '42501';
  END IF;
  UPDATE club_tenup_site_proposals SET status = 'consumed' WHERE club_id = p_club AND status = 'ready';
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.club_tenup_site_consume(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_tenup_site_consume(uuid) TO authenticated;

COMMIT;
