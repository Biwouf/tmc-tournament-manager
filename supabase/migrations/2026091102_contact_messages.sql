-- Multi-tenant — PR11 (lot A) : messages du formulaire de contact de la vitrine.
-- Voir docs/specs/MULTI_TENANT.md §7 et docs/briefs/web_site_brief.md §5.6.
--
-- CE QUE CETTE TABLE EST
-- La boîte de réception du formulaire `/contact` du site vitrine. Le visiteur n'écrit PAS
-- ici : il appelle l'Edge Function `contact-form`, qui valide, limite et écrit en service
-- role. La table est ensuite lue au BO (`/admin/messages`), en lecture seule.
--
-- POURQUOI AUCUNE POLICY D'ÉCRITURE, POUR PERSONNE
-- C'est la décision de sécurité de cette migration. Une policy INSERT `anon` ferait de
-- cette table un formulaire de spam ouvert sur internet : n'importe qui possédant la clé
-- anon — elle est publique, elle est dans le bundle de la vitrine — pourrait y écrire en
-- boucle, sans honeypot, sans rate-limit, sans validation. Toutes les protections du §5 du
-- brief vivent dans la function ; les contourner ne doit pas être une option. Le service
-- role bypasse la RLS, il n'a besoin d'aucune policy.
--
-- Pas de policy UPDATE / DELETE non plus : un message reçu ne se modifie pas, et la
-- suppression n'est pas demandée. On ne l'ouvre pas « au cas où » — même choix qu'en PR5
-- pour `clubs` (on suspend, on ne supprime pas).
--
-- ROLLBACK
--   DROP TABLE public.contact_messages;
--   (+ supprimer la function `contact-form`)

-- ============================================================
-- 1. Table
-- ============================================================
-- DIVERGENCE ASSUMÉE AVEC LA SPEC : `MULTI_TENANT.md` §7 annonçait une colonne `name`,
-- alors que le formulaire de `web_site_brief.md` §5.6 a DEUX champs, Nom et Prénom. Deux
-- colonnes plutôt qu'une concaténation qu'on ne saurait plus redécouper (et qui rendrait
-- « Bonjour Jean Dupont, » impossible à écrire correctement). La spec est mise à jour dans
-- la même PR.
--
-- `phone` est NULLABLE : le formulaire ne le rend pas obligatoire (§5.6).
--
-- `ip_hash` est un haché SALÉ (sha256(ip + CONTACT_IP_SALT)), calculé par la function.
-- L’IP brute n’est jamais stockée. Le secret reste côté serveur.
-- Nullable uniquement pour les appels locaux sans adresse IP fournie par le proxy.
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id    UUID        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  first_name TEXT        NOT NULL,
  last_name  TEXT        NOT NULL,
  email      TEXT        NOT NULL,
  phone      TEXT,
  message    TEXT        NOT NULL,
  ip_hash    TEXT,                     -- anti-spam uniquement, jamais affiché au BO
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- La requête de l'écran BO : les messages d'un club, du plus récent au plus ancien.
CREATE INDEX IF NOT EXISTS idx_contact_messages_club_created
  ON public.contact_messages (club_id, created_at DESC);

-- La requête du rate-limit, exécutée à CHAQUE soumission : « combien de messages pour ce
-- haché depuis 15 minutes ». Elle porte sur toute la table, tous clubs confondus (§5.3) —
-- l'index `(club_id, created_at)` ci-dessus ne la sert pas. Sans celui-ci, la mesure
-- anti-spam devient elle-même le coût qu'un flood cherche à provoquer.
CREATE INDEX IF NOT EXISTS idx_contact_messages_ip_hash_created
  ON public.contact_messages (ip_hash, created_at DESC);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. RLS — lecture cloisonnée par club
-- ============================================================
-- Patron `tenant_isolation` (20260816_multi_tenant_rls.sql §6), restreint à SELECT.
--
-- Les messages privés sont réservés aux administrateurs du club et au super-admin.
DROP POLICY IF EXISTS "contact_messages_select_tenant" ON public.contact_messages;
CREATE POLICY "contact_messages_select_tenant"
  ON public.contact_messages FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.club_members cm
      WHERE cm.club_id = contact_messages.club_id
        AND cm.user_id = auth.uid() AND cm.role = 'admin')
    OR public.is_super_admin()
  );

-- Club actif seulement — même règle `active_club_access` que les 11 autres tables depuis
-- l'audit du 05/09/2026. RESTRICTIVE : une policy permissive ajoutée plus tard (à la main
-- dans le dashboard, typiquement) ne peut pas rouvrir l'accès à un club suspendu.
-- Le super-admin y échappe : diagnostiquer un club suspendu est son usage (PR5).
DROP POLICY IF EXISTS "contact_messages_active_club" ON public.contact_messages;
CREATE POLICY "contact_messages_active_club"
  ON public.contact_messages AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.clubs c
       WHERE c.id = contact_messages.club_id AND c.status = 'active'
    )
  );

-- ============================================================
-- 3. GRANTs (convention docs/CODEBASE.md — obligatoire depuis oct. 2026)
-- ============================================================
-- SELECT seul, et seulement à `authenticated`. Une policy sans GRANT ne donne rien ; un
-- GRANT sans policy non plus. Les deux disent la même chose : on lit, on n'écrit pas.
--
-- AUCUN GRANT À `anon` : le visiteur de la vitrine n'a rien à lire ici — les messages des
-- autres visiteurs, c'est-à-dire des noms, des emails et des téléphones. Il n'écrit pas
-- non plus : il appelle la function.
--
-- Pas de GRANT par colonne pour exclure `ip_hash` (patron `club_social_credentials.token`,
-- PR8) : ce serait disproportionné ici. C'est un haché salé, pas un secret — le sel vit
-- dans les variables d'environnement de la function et ne redescend jamais. Le choix est
-- de ne pas AFFICHER la colonne au BO plutôt que d'en interdire la lecture.
REVOKE ALL ON TABLE public.contact_messages FROM anon, authenticated;
GRANT SELECT ON TABLE public.contact_messages TO authenticated;
GRANT ALL ON TABLE public.contact_messages TO service_role;
