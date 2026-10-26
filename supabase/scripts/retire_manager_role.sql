-- Retrait du rôle Gestionnaire (26/10/2026) — script MANUEL, jamais une migration.
--
-- Le rôle `manager` n'est plus proposé dans le BO (invitation, changement de rôle) : les
-- capitaines d'équipe (`team_equipe_captains`) le remplacent pour le seul droit utile au
-- terrain, le changement de date d'une rencontre. Les gestionnaires existants deviennent
-- membres : ils perdent Actus, Événements, Matches par équipe (écriture), Affiche et Planning.
-- L'enum `club_role` garde la valeur `manager`, inutilisée.
--
-- À lancer dans le SQL Editor, après avoir vérifié la liste ci-dessous et prévenu les intéressés.

-- 1. Qui est concerné ?
SELECT c.slug, p.prenom, p.nom, u.email
  FROM public.club_members m
  JOIN public.clubs c ON c.id = m.club_id
  JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN public.profiles p ON p.id = m.user_id
 WHERE m.role = 'manager'
 ORDER BY c.slug, p.nom;

-- 2. Bascule.
UPDATE public.club_members
   SET role = 'member'
 WHERE role = 'manager'
RETURNING club_id, user_id;
