-- Génération d'actu depuis des rencontres par équipe (Edge Function generate-post) : chaque
-- génération est un appel payant à l'API Anthropic. Réservée aux administrateurs du club (pas aux
-- managers ni aux capitaines), plafonnée par club et par mois calendaire (heure de Paris), avec un
-- coupe-circuit global journalier fixé par la fonction (secret POST_GEN_GLOBAL_DAILY_LIMIT).
-- Une génération n'est comptée qu'après un appel réussi : deux générations simultanées peuvent
-- dépasser le plafond d'une unité chacune, c'est accepté.
-- Aucun texte généré ni aucune donnée de joueur n'est conservé ici.
BEGIN;

ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS post_gen_monthly_limit integer NOT NULL DEFAULT 30
  CHECK (post_gen_monthly_limit >= 0);

CREATE TABLE IF NOT EXISTS public.post_generations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_generations_club ON public.post_generations(club_id, created_at);
CREATE INDEX IF NOT EXISTS post_generations_created ON public.post_generations(created_at);
-- Aucune policy ni GRANT : seules les fonctions ci-dessous (SECURITY DEFINER) y lisent et écrivent.
ALTER TABLE public.post_generations ENABLE ROW LEVEL SECURITY;

-- Administrateur du club actif (ou super-admin en support).
CREATE OR REPLACE FUNCTION public.post_gen_is_admin(p_club uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
    WHERE m.club_id = p_club AND m.user_id = auth.uid() AND m.role = 'admin' AND c.status = 'active'))
$$;
REVOKE ALL ON FUNCTION public.post_gen_is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_gen_is_admin(uuid) TO authenticated;

-- Générations restantes ce mois-ci pour le club ; lève 42501 (non admin) ou PT429 (plafond).
CREATE OR REPLACE FUNCTION public.post_gen_check(p_club uuid, p_global_daily_limit integer)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE used integer; quota integer;
BEGIN
  IF NOT public.post_gen_is_admin(p_club) THEN
    RAISE EXCEPTION 'Réservé aux administrateurs du club.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM post_generations WHERE created_at > now() - interval '1 day')
     >= greatest(coalesce(p_global_daily_limit, 0), 0) THEN
    RAISE EXCEPTION 'La génération est momentanément indisponible. Réessayez demain ou rédigez l''actu à la main.' USING ERRCODE = 'PT429';
  END IF;
  SELECT post_gen_monthly_limit INTO quota FROM clubs WHERE id = p_club;
  SELECT count(*) INTO used FROM post_generations
   WHERE club_id = p_club
     AND created_at >= date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
  IF used >= coalesce(quota, 0) THEN
    RAISE EXCEPTION 'Limite de % générations ce mois-ci atteinte pour le club. Elle sera remise à zéro le 1er du mois.', coalesce(quota, 0) USING ERRCODE = 'PT429';
  END IF;
  RETURN quota - used;
END $$;
REVOKE ALL ON FUNCTION public.post_gen_check(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_gen_check(uuid, integer) TO authenticated;

-- Compte une génération réussie (appelée par generate-post après la réponse de l'API).
CREATE OR REPLACE FUNCTION public.post_gen_record(p_club uuid, p_input_tokens integer, p_output_tokens integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.post_gen_is_admin(p_club) THEN
    RAISE EXCEPTION 'Réservé aux administrateurs du club.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO post_generations(club_id, actor_id, input_tokens, output_tokens)
  VALUES (p_club, auth.uid(), greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0));
END $$;
REVOKE ALL ON FUNCTION public.post_gen_record(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_gen_record(uuid, integer, integer) TO authenticated;

COMMIT;
