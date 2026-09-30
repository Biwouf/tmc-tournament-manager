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
- Les valeurs copiées donnent accès aux mêmes services et environnements que le checkout principal ; cette copie n’autorise pas à modifier ou déployer les services distants.
