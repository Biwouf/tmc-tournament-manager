-- Compo d'équipe : liste des joueurs retenus pour une rencontre (brief compo-equipes v2.1, PR1).
-- 1. Faille : un visiteur lisait les noms des matchs saisis à l'avance (team_lines_public_read sans date).
-- 2. Un compte connecté sans adhésion lit les rencontres comme un visiteur (même règle que les lives, 2026093001).
-- 3. Tables team_match_players / team_match_compos, sans aucun accès direct : tout passe par les RPC.
-- Déployer avant le client. Aucun service distant modifié par la PR.
BEGIN;

-- ============================================================
-- 1 et 2. Lecture publique des rencontres et des feuilles de match
-- ============================================================
CREATE FUNCTION public.team_club_readable(p_club uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM clubs WHERE id=p_club AND status='active')
$$;

-- Les noms d'un match ne sont publics qu'une fois la rencontre commencée, ou si le match est en live
-- ou a un résultat. Avant, l'adversaire pouvait lire notre compo avec la seule clé publique.
CREATE FUNCTION public.team_line_public(p_club uuid,p_rencontre uuid,p_live uuid,p_gagnant text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT team_club_readable(p_club) AND (p_live IS NOT NULL OR p_gagnant IS NOT NULL
  OR EXISTS(SELECT 1 FROM team_rencontres r WHERE r.id=p_rencontre AND r.date_heure<=now()))
$$;
REVOKE ALL ON FUNCTION public.team_club_readable(uuid),public.team_line_public(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.team_club_readable(uuid),public.team_line_public(uuid,uuid,uuid,text) TO anon,authenticated;

DROP POLICY IF EXISTS team_lines_public_read ON public.team_match_lines;
CREATE POLICY team_lines_public_read ON public.team_match_lines FOR SELECT TO anon
 USING (public.team_line_public(club_id,rencontre_id,live_match_id,gagnant));

-- Sans ces policies, un compte en attente d'adhésion (ou d'un autre club) voyait une liste vide
-- là où un visiteur voit les rencontres : tenant_isolation ne couvre que les membres.
CREATE POLICY team_lines_authenticated_public_read ON public.team_match_lines FOR SELECT TO authenticated
 USING (public.team_line_public(club_id,rencontre_id,live_match_id,gagnant));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['team_saisons','team_competitions','team_equipes','team_etapes','team_rencontres'] LOOP
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.team_club_readable(club_id))',
   t||'_authenticated_public_read',t);
 END LOOP;
END $$;

-- ============================================================
-- 3. Tables de la compo
-- ============================================================
-- Clé de comparaison des noms d'invités : casse, espaces et accents ignorés (pas d'extension unaccent).
CREATE FUNCTION public.team_compo_name_key(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT translate(lower(regexp_replace(btrim(coalesce(p_value,'')),'\s+',' ','g')),
  'àáâãäåāçćčèéêëēėęìíîïīñńòóôõöøōùúûüūýÿžźżœæ','aaaaaaaccceeeeeeeiiiiinnooooooouuuuuyyzzzœæ')
$$;

CREATE TABLE public.team_match_players (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 rencontre_id uuid NOT NULL REFERENCES public.team_rencontres(id) ON DELETE CASCADE,
 user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 guest_prenom text CHECK (length(btrim(guest_prenom)) BETWEEN 1 AND 100),
 guest_nom text CHECK (length(btrim(guest_nom))<=100),
 guest_sex text CHECK (guest_sex IN ('female','male')),
 added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 notified_at timestamptz, -- option P1 « Prévenir les joueurs »
 CONSTRAINT team_match_players_one_person CHECK (
  (user_id IS NOT NULL AND guest_prenom IS NULL AND guest_nom IS NULL AND guest_sex IS NULL)
  OR (user_id IS NULL AND guest_prenom IS NOT NULL)),
 UNIQUE (rencontre_id,user_id)
);
CREATE UNIQUE INDEX team_match_players_guest_unique ON public.team_match_players
 (rencontre_id,public.team_compo_name_key(guest_prenom),public.team_compo_name_key(guest_nom)) WHERE user_id IS NULL;
CREATE INDEX team_match_players_user ON public.team_match_players(user_id) WHERE user_id IS NOT NULL;

-- En-tête : fraîcheur affichée et révision (conflit d'édition). revision 0 = jamais enregistrée.
CREATE TABLE public.team_match_compos (
 rencontre_id uuid PRIMARY KEY REFERENCES public.team_rencontres(id) ON DELETE CASCADE,
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Aucune policy : un compte non membre doit lire (décision 1), ce que tenant_isolation interdit en direct.
-- La compo n'est jamais lisible sans compte, même après la rencontre (Q3).
ALTER TABLE public.team_match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_match_compos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_match_players,public.team_match_compos FROM PUBLIC,anon,authenticated;

-- ============================================================
-- 4. Droits
-- ============================================================
-- Admin/manager du club ou capitaine de l'équipe : une seule source de vérité avec le changement de date.
CREATE FUNCTION public.team_can_compose(p_club uuid,p_rencontre uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND team_club_readable(p_club) AND coalesce(team_can_reschedule(p_club,p_rencontre),false)
$$;

-- Lecture : tout compte connecté, rencontre d'un club actif.
CREATE FUNCTION public.team_compo_check_read(p_club uuid,p_rencontre uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'COMPO_AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT team_club_readable(p_club) OR NOT EXISTS(SELECT 1 FROM team_rencontres WHERE id=p_rencontre AND club_id=p_club) THEN
  RAISE EXCEPTION 'COMPO_NOT_FOUND' USING ERRCODE='P0002';
 END IF;
END $$;

-- ============================================================
-- 5. Lecture
-- ============================================================
CREATE FUNCTION public.team_compo_get(p_club uuid,p_rencontre uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth.uid(); editor boolean; equipe uuid; fmt text; gnr text; spec integer[]; head team_match_compos;
 show_sex boolean; players jsonb; captains jsonb; updater jsonb;
BEGIN
 PERFORM team_compo_check_read(p_club,p_rencontre);
 editor:=team_can_compose(p_club,p_rencontre);
 SELECT et.equipe_id,c.format,c.genre INTO equipe,fmt,gnr FROM team_rencontres r
  JOIN team_etapes et ON et.id=r.etape_id JOIN team_equipes e ON e.id=et.equipe_id
  JOIN team_competitions c ON c.id=e.competition_id WHERE r.id=p_rencontre;
 spec:=team_format_spec(fmt);
 -- Le sexe sert à grouper en mixte et à filtrer pour qui compose ; il n'est pas exposé sinon.
 show_sex:=editor OR gnr='mixte';
 SELECT * INTO head FROM team_match_compos WHERE rencontre_id=p_rencontre;

 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'is_guest',x.is_guest,'prenom',x.prenom,'nom',x.nom,
   'initials',upper(left(btrim(x.prenom),1)||left(btrim(x.nom),1)),'classement',x.classement,
   'is_captain',x.is_captain,'is_me',x.is_me,'sex',CASE WHEN show_sex THEN x.sex END)
   ORDER BY lower(x.nom),lower(x.prenom)),'[]') INTO players
 FROM (SELECT p.id,p.user_id IS NULL is_guest,
   coalesce(pr.prenom,p.guest_prenom,'') prenom,coalesce(pr.nom,p.guest_nom,'') nom,
   d.classement,coalesce(d.sex,p.guest_sex) sex,p.user_id IS NOT DISTINCT FROM me is_me,
   EXISTS(SELECT 1 FROM team_equipe_captains cap WHERE cap.equipe_id=equipe AND cap.user_id=p.user_id) is_captain
  FROM team_match_players p LEFT JOIN profiles pr ON pr.id=p.user_id LEFT JOIN profile_details d ON d.user_id=p.user_id
  WHERE p.rencontre_id=p_rencontre AND p.club_id=p_club) x;

 SELECT coalesce(jsonb_agg(jsonb_build_object('prenom',pr.prenom,'nom',pr.nom) ORDER BY pr.nom,pr.prenom),'[]') INTO captains
 FROM team_equipe_captains cap JOIN profiles pr ON pr.id=cap.user_id
 WHERE cap.equipe_id=equipe AND cap.club_id=p_club;

 IF head.updated_by IS NOT NULL AND head.revision>0 THEN
  SELECT jsonb_build_object('prenom',pr.prenom,'nom',pr.nom,'role',CASE WHEN EXISTS(SELECT 1 FROM team_equipe_captains cap
    WHERE cap.equipe_id=equipe AND cap.user_id=head.updated_by) THEN 'capitaine' ELSE 'admin' END)
   INTO updater FROM profiles pr WHERE pr.id=head.updated_by;
 END IF;

 RETURN jsonb_build_object('players',players,'captains',captains,'version',coalesce(head.revision,0),
  'updated_at',CASE WHEN head.revision>0 THEN head.updated_at END,'updated_by',updater,'can_edit',editor,
  'min_players',CASE WHEN spec IS NOT NULL THEN greatest(spec[1],2*spec[2]) END,
  'simples',spec[1],'doubles',spec[2],'format',fmt,'genre',gnr);
END $$;

-- Résumé des cartes de la liste « Matchs équipes » : un seul appel pour toutes les rencontres affichées.
-- Seules les rencontres avec au moins un joueur sont renvoyées ; prénoms seulement.
CREATE FUNCTION public.team_compo_summaries(p_club uuid,p_rencontres uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth.uid();
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'COMPO_AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 IF coalesce(cardinality(p_rencontres),0)>200 THEN RAISE EXCEPTION 'COMPO_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT team_club_readable(p_club) OR coalesce(cardinality(p_rencontres),0)=0 THEN RETURN '[]'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('rencontre_id',g.rencontre_id,'count',g.count,'is_me',g.is_me,
   'preview',g.preview,'updated_at',g.updated_at) ORDER BY g.rencontre_id),'[]')
  FROM (SELECT x.rencontre_id,count(*) count,bool_or(x.is_me) is_me,max(h.updated_at) updated_at,
    coalesce(jsonb_agg(jsonb_build_object('initials',x.initials,'prenom',x.prenom,'is_guest',x.is_guest,'is_me',x.is_me)
     ORDER BY x.rank) FILTER (WHERE x.rank<=3),'[]') preview
   FROM (SELECT p.rencontre_id,p.user_id IS NULL is_guest,p.user_id IS NOT DISTINCT FROM me is_me,
     coalesce(pr.prenom,p.guest_prenom,'') prenom,
     upper(left(btrim(coalesce(pr.prenom,p.guest_prenom,'')),1)||left(btrim(coalesce(pr.nom,p.guest_nom,'')),1)) initials,
     row_number() OVER (PARTITION BY p.rencontre_id ORDER BY p.user_id IS NOT DISTINCT FROM me DESC,
      (cap.user_id IS NOT NULL) DESC,lower(coalesce(pr.nom,p.guest_nom,'')),lower(coalesce(pr.prenom,p.guest_prenom,'')),p.id) rank
    FROM team_match_players p
    JOIN team_rencontres r ON r.id=p.rencontre_id AND r.club_id=p_club
    JOIN team_etapes et ON et.id=r.etape_id
    LEFT JOIN team_equipe_captains cap ON cap.equipe_id=et.equipe_id AND cap.user_id=p.user_id
    LEFT JOIN profiles pr ON pr.id=p.user_id
    WHERE p.club_id=p_club AND p.rencontre_id=ANY(p_rencontres)) x
   JOIN team_match_compos h ON h.rencontre_id=x.rencontre_id
   GROUP BY x.rencontre_id) g);
END $$;

-- Membres du club proposés à qui compose (avec le sexe, que team_member_roster n'expose pas à tous).
CREATE FUNCTION public.team_compo_candidates(p_club uuid,p_rencontre uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE equipe uuid;
BEGIN
 PERFORM team_compo_check_read(p_club,p_rencontre);
 IF NOT team_can_compose(p_club,p_rencontre) THEN RAISE EXCEPTION 'COMPO_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT et.equipe_id INTO equipe FROM team_rencontres r JOIN team_etapes et ON et.id=r.etape_id WHERE r.id=p_rencontre;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'prenom',p.prenom,'nom',p.nom,'classement',d.classement,
   'sex',d.sex,'is_captain',EXISTS(SELECT 1 FROM team_equipe_captains cap WHERE cap.equipe_id=equipe AND cap.user_id=p.id))
   ORDER BY lower(p.nom),lower(p.prenom)),'[]')
  FROM club_members m JOIN profiles p ON p.id=m.user_id LEFT JOIN profile_details d ON d.user_id=m.user_id
  WHERE m.club_id=p_club AND length(btrim(coalesce(p.prenom,'')||coalesce(p.nom,'')))>0);
END $$;

-- ============================================================
-- 6. Écriture : la liste entière en une fois, en diff (ids et notified_at stables)
-- ============================================================
-- p_players : [{user_id}] membre, [{id}] invité déjà présent, [{prenom, nom?, sex?}] nouvel invité.
-- p_version : la révision lue (0 si aucune compo). Erreurs : codes stables traduits par shared/teamCompoCopy.
-- Jamais SQLSTATE 40001 (rejeu infini de PostgREST) : le conflit d'édition est en PT409.
CREATE FUNCTION public.team_compo_save(p_club uuid,p_rencontre uuid,p_players jsonb,p_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth.uid(); current_rev integer; author text; item jsonb; member uuid; guest uuid;
 g_prenom text; g_nom text; g_sex text; key text; label text;
 keep_users uuid[]:='{}'; keep_guests uuid[]:='{}'; keys text[]:='{}'; new_guests jsonb:='[]';
BEGIN
 PERFORM team_compo_check_read(p_club,p_rencontre);
 IF NOT team_can_compose(p_club,p_rencontre) THEN RAISE EXCEPTION 'COMPO_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_players IS NULL OR jsonb_typeof(p_players)<>'array' THEN RAISE EXCEPTION 'COMPO_INVALID' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_players)>30 THEN RAISE EXCEPTION 'COMPO_TOO_LARGE' USING ERRCODE='22023'; END IF;

 -- Verrou de l'en-tête : deux enregistrements simultanés se sérialisent, le second voit la nouvelle révision.
 INSERT INTO team_match_compos(rencontre_id,club_id) VALUES(p_rencontre,p_club) ON CONFLICT DO NOTHING;
 SELECT revision INTO current_rev FROM team_match_compos WHERE rencontre_id=p_rencontre FOR UPDATE;
 IF current_rev<>coalesce(p_version,0) THEN
  SELECT btrim(coalesce(pr.prenom,'')) INTO author FROM team_match_compos h JOIN profiles pr ON pr.id=h.updated_by
   WHERE h.rencontre_id=p_rencontre;
  RAISE EXCEPTION 'COMPO_STALE' USING ERRCODE='PT409',DETAIL=coalesce(author,'');
 END IF;

 FOR item IN SELECT value FROM jsonb_array_elements(p_players) LOOP
  IF jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'COMPO_INVALID' USING ERRCODE='22023'; END IF;
  IF item ? 'user_id' THEN
   member:=(item->>'user_id')::uuid;
   SELECT btrim(coalesce(pr.prenom,'')||' '||coalesce(pr.nom,'')) INTO label FROM club_members m
    JOIN profiles pr ON pr.id=m.user_id WHERE m.club_id=p_club AND m.user_id=member;
   IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_NOT_MEMBER' USING ERRCODE='22023'; END IF;
   IF member=ANY(keep_users) THEN RAISE EXCEPTION 'DUPLICATE_PLAYER' USING ERRCODE='23505',DETAIL=label; END IF;
   keep_users:=keep_users||member;
  ELSE
   IF item ? 'id' THEN
    guest:=(item->>'id')::uuid;
    SELECT guest_prenom,guest_nom INTO g_prenom,g_nom FROM team_match_players
     WHERE id=guest AND rencontre_id=p_rencontre AND club_id=p_club AND user_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'COMPO_INVALID' USING ERRCODE='22023'; END IF;
    IF guest=ANY(keep_guests) THEN
     RAISE EXCEPTION 'DUPLICATE_PLAYER' USING ERRCODE='23505',DETAIL=btrim(g_prenom||' '||coalesce(g_nom,''));
    END IF;
    keep_guests:=keep_guests||guest;
   ELSE
    g_prenom:=btrim(coalesce(item->>'prenom','')); g_nom:=nullif(btrim(coalesce(item->>'nom','')),'');
    g_sex:=nullif(item->>'sex','');
    IF length(g_prenom) NOT BETWEEN 1 AND 100 OR coalesce(length(g_nom),0)>100
     OR (g_sex IS NOT NULL AND g_sex NOT IN ('female','male')) THEN
     RAISE EXCEPTION 'COMPO_INVALID' USING ERRCODE='22023';
    END IF;
    new_guests:=new_guests||jsonb_build_object('prenom',g_prenom,'nom',g_nom,'sex',g_sex);
   END IF;
   key:=team_compo_name_key(g_prenom)||'|'||team_compo_name_key(g_nom);
   IF key=ANY(keys) THEN
    RAISE EXCEPTION 'DUPLICATE_PLAYER' USING ERRCODE='23505',DETAIL=btrim(g_prenom||' '||coalesce(g_nom,''));
   END IF;
   keys:=keys||key;
  END IF;
 END LOOP;

 DELETE FROM team_match_players WHERE rencontre_id=p_rencontre AND club_id=p_club
  AND NOT (coalesce(user_id=ANY(keep_users),false) OR id=ANY(keep_guests));
 INSERT INTO team_match_players(club_id,rencontre_id,user_id,added_by)
  SELECT p_club,p_rencontre,u,me FROM unnest(keep_users) u ON CONFLICT (rencontre_id,user_id) DO NOTHING;
 INSERT INTO team_match_players(club_id,rencontre_id,guest_prenom,guest_nom,guest_sex,added_by)
  SELECT p_club,p_rencontre,g->>'prenom',g->>'nom',g->>'sex',me FROM jsonb_array_elements(new_guests) g;
 UPDATE team_match_compos SET revision=revision+1,updated_at=now(),updated_by=me WHERE rencontre_id=p_rencontre;

 RETURN team_compo_get(p_club,p_rencontre);
END $$;

REVOKE ALL ON FUNCTION public.team_can_compose(uuid,uuid),public.team_compo_check_read(uuid,uuid),
 public.team_compo_get(uuid,uuid),public.team_compo_summaries(uuid,uuid[]),public.team_compo_candidates(uuid,uuid),
 public.team_compo_save(uuid,uuid,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_can_compose(uuid,uuid),public.team_compo_get(uuid,uuid),
 public.team_compo_summaries(uuid,uuid[]),public.team_compo_candidates(uuid,uuid),
 public.team_compo_save(uuid,uuid,jsonb,integer) TO authenticated;

COMMIT;
