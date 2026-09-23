# Consignes du dépôt

## Git worktrees

- Toujours travailler dans un worktree dédié à la tâche, sur une branche dédiée, avant toute modification de fichiers. Réutiliser un worktree existant uniquement s'il est déjà dédié à cette même tâche.
- Ne jamais développer directement sur `main` ni dans le checkout principal `tmc-tournament-manager`. Une exception ponctuelle explicitement autorisée par l'utilisateur ne vaut que pour la tâche concernée et ne doit pas être reproduite.
- Créer tout nouveau worktree de ce dépôt comme dossier frère de `tmc-tournament-manager`, directement sous `/Users/m.tresalmauroz/Desktop/perso`.
- Utiliser un nom explicite préfixé par `tmc-`, sur le modèle de `/Users/m.tresalmauroz/Desktop/perso/tmc-pr9-vitrine`.
- Ne pas créer de worktree dans `/private/tmp` ni à l'intérieur du dépôt, sauf demande explicite de l'utilisateur.
- Avant toute création, vérifier avec `git worktree list` que le chemin cible et la branche ne sont pas déjà utilisés.
