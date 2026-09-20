BEGIN;
-- Compléter les champs absents sans écraser un profil déjà renseigné.
CREATE FUNCTION public.signup_fill_profile_internal(p_user uuid,p_prenom text,p_nom text,p_sex text,p_classement text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE changed integer;
BEGIN
 IF coalesce(length(btrim(p_prenom)),0) NOT BETWEEN 1 AND 100
 OR coalesce(length(btrim(p_nom)),0) NOT BETWEEN 1 AND 100
 OR coalesce(p_sex,'') NOT IN ('female','male')
 OR (p_classement IS NOT NULL AND p_classement NOT IN ('NC','40','30/5','30/4','30/3','30/2','30/1','30','15/5','15/4','15/3','15/2','15/1','15','5/6','4/6','3/6','2/6','1/6','0','-2/6','-4/6','-15')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 INSERT INTO profiles(id,prenom,nom) VALUES(p_user,btrim(p_prenom),btrim(p_nom))
 ON CONFLICT(id) DO UPDATE SET
 prenom=CASE WHEN nullif(btrim(profiles.prenom),'') IS NULL THEN excluded.prenom ELSE profiles.prenom END,
 nom=CASE WHEN nullif(btrim(profiles.nom),'') IS NULL THEN excluded.nom ELSE profiles.nom END
 WHERE nullif(btrim(profiles.prenom),'') IS NULL OR nullif(btrim(profiles.nom),'') IS NULL;
 GET DIAGNOSTICS changed = ROW_COUNT;
 INSERT INTO profile_details(user_id,sex,classement) VALUES(p_user,p_sex,p_classement)
 ON CONFLICT(user_id) DO UPDATE SET
 sex=coalesce(profile_details.sex,excluded.sex),
 classement=coalesce(profile_details.classement,excluded.classement),
 revision=profile_details.revision+1,updated_at=clock_timestamp()
 WHERE changed>0 OR profile_details.sex IS NULL
 OR (profile_details.classement IS NULL AND excluded.classement IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.signup_fill_profile_internal(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.signup_profile_internal(p_user uuid,p_club uuid,p_prenom text,p_nom text,p_sex text,p_classement text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM clubs WHERE id=p_club AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CLUB_UNAVAILABLE'; END IF;
 PERFORM signup_fill_profile_internal(p_user,p_prenom,p_nom,p_sex,p_classement);
 IF EXISTS(SELECT 1 FROM club_members WHERE club_id=p_club AND user_id=p_user)
 OR EXISTS(SELECT 1 FROM club_signup_requests WHERE club_id=p_club AND user_id=p_user) THEN RETURN; END IF;
 INSERT INTO club_signup_requests(club_id,user_id) VALUES(p_club,p_user);
END $$;

-- Réparer également les inscriptions déjà faites, y compris acceptées/retirées.
-- Seulement les métadonnées liées à une demande existante ; aucun droit ne change.
DO $$
DECLARE r record; d jsonb;
BEGIN
 FOR r IN SELECT DISTINCT u.id,u.raw_user_meta_data->'club_signup' AS data
 FROM auth.users u JOIN club_signup_requests s ON s.user_id=u.id
 AND s.club_id::text=u.raw_user_meta_data->'club_signup'->>'club_id'
 LOOP
  d:=r.data;
  BEGIN
   PERFORM signup_fill_profile_internal(r.id,d->>'prenom',d->>'nom',d->>'sex',nullif(d->>'classement',''));
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'VALIDATION_ERROR' THEN RAISE; END IF;
   -- Métadonnées invalides : conserver le profil existant.
  END;
 END LOOP;
END $$;
COMMIT;
