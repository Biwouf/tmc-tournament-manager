# Consignes du dépôt

## Git worktrees

- Toujours travailler dans un worktree dédié à la tâche, sur une branche dédiée, avant toute modification de fichiers. Réutiliser un worktree existant uniquement s'il est déjà dédié à cette même tâche.
- Ne jamais développer directement sur `main` ni dans le checkout principal `tmc-tournament-manager`. Une exception ponctuelle explicitement autorisée par l'utilisateur ne vaut que pour la tâche concernée et ne doit pas être reproduite.
- Créer tout nouveau worktree de ce dépôt comme dossier frère de `tmc-tournament-manager`, directement sous `/Users/m.tresalmauroz/Desktop/perso`.
- Utiliser un nom explicite préfixé par `tmc-`, sur le modèle de `/Users/m.tresalmauroz/Desktop/perso/tmc-pr9-vitrine`.
- Ne pas créer de worktree dans `/private/tmp` ni à l'intérieur du dépôt, sauf demande explicite de l'utilisateur.
- Avant toute création, vérifier avec `git worktree list` que le chemin cible et la branche ne sont pas déjà utilisés.

## Configuration locale des worktrees

- Après la création d’un worktree, copier automatiquement depuis le checkout principal `/Users/m.tresalmauroz/Desktop/perso/tmc-tournament-manager` les fichiers `.env.local`, `pwa/.env.local` et `web/.env.local` existants vers les mêmes chemins relatifs du nouveau worktree.
- Avant chaque copie, vérifier que le chemin de destination est ignoré par Git dans le nouveau worktree (`git check-ignore -q -- <chemin relatif>`) et n’est pas suivi (`git ls-files -- <chemin relatif>` ne doit rien retourner). Sinon, ne pas copier et signaler le problème.
- Ne jamais écraser une destination existante, y compris un lien symbolique. Une source absente doit simplement être ignorée.
- Ne jamais afficher le contenu de ces fichiers, le consigner dans les logs ou le versionner, même avec `git add -f`. Ne copier aucun autre fichier de secrets dans le cadre de cette initialisation.
- Les valeurs copiées donnent accès aux mêmes services et environnements que le checkout principal ; cette copie n’autorise pas, à elle seule, à modifier ou déployer les services distants (voir « Déploiements » pour ce qui est permis).

## Déploiements : Supabase DEV et worker Ten'Up

**Supabase DEV : automatique.** Quand une tâche ajoute une migration ou modifie une Edge
Function, l'agent l'applique lui-même sur le projet DEV (`hnhsmefrcihpnkxbrxmr`) avant de
rendre la main, sans attendre qu'on le lui demande.

- **Cible.** Ne jamais se fier au lien existant : le checkout principal et plusieurs
  worktrees sont liés à la **PROD** (`ettausmxxxyfgmxxhvvx`). Dans le worktree, lancer
  `supabase link --project-ref hnhsmefrcihpnkxbrxmr`, puis vérifier que
  `supabase/.temp/project-ref` contient bien cet identifiant avant tout push.
- **Migrations.** Avant de numéroter, vérifier les versions déjà prises sur `origin/main`, dans
  les worktrees frères et dans le journal de DEV. Ensuite, `supabase db push --dry-run`
  doit lister uniquement les migrations de la tâche (sinon, s'arrêter et signaler), puis
  `supabase db push`. Ne jamais lancer `supabase migration repair`. Si DEV contient des
  versions poussées depuis d'autres branches, mettre la branche à jour sur `origin/main`, puis
  pousser depuis un `--workdir` temporaire qui contient aussi les migrations manquantes copiées
  des worktrees frères, avec `--include-all`. Ne jamais modifier une migration déjà poussée sur
  DEV : en ajouter une nouvelle.
- **Edge Functions.** `supabase functions deploy <nom> --project-ref hnhsmefrcihpnkxbrxmr`
  pour chaque fonction modifiée, y compris celles qui importent un fichier modifié de
  `supabase/functions/_shared/`.
- **Hors automatisme.** Secrets Edge ou Vault, scripts pg_cron et réglages Auth restent
  manuels : les lister à l'utilisateur avec la valeur attendue, sans afficher de secret.
- Dans le compte rendu, indiquer ce qui a été appliqué sur DEV (versions, fonctions).

**Supabase PROD : jamais sans demande explicite** de l'utilisateur dans le message (aucun
`db push` ni `functions deploy` vers `ettausmxxxyfgmxxhvvx`, aucune requête d'écriture).

**Worker Ten'Up (Vercel) : après feu vert.** Il n'existe qu'un projet,
`tmc-tenup-worker-check`, qui sert la prod et n'est pas redéployé au merge. Quand une tâche
modifie `services/tenup-worker/` :
1. Intégrer `origin/main` dans la branche (sinon le déploiement écrase les correctifs déjà
   en prod), puis vérifier les fichiers envoyés avec `--dry --json`.
2. Demander le feu vert dans le chat, avec la commande exacte, et attendre un « oui »
   explicite de l'utilisateur. Un feu vert ne vaut que pour ce déploiement-là.
3. Déployer depuis la racine du worktree, sous Node 24 (le Node 22.19.0 de nvm est un binaire
   x86_64) :
   `npx vercel@62.0.0 deploy --prod --cwd services/tenup-worker --project tmc-tenup-worker-check --scope biwoufs-projects`
4. Vérifier que le déploiement est `Ready` (`npx vercel@62.0.0 inspect <url>`), puis demander
   à l'utilisateur de lancer une synchro Ten'Up pour valider.
