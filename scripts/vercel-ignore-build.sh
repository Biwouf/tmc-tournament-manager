#!/usr/bin/env bash
# Ignored Build Step Vercel : ne reconstruire un projet que si ses dossiers ont changé.
# Usage : bash scripts/vercel-ignore-build.sh <pathspec>...  (chemins relatifs à la racine du dépôt)
# Code de sortie lu par Vercel : 0 = build ignoré, 1 = build lancé.

cd "$(git rev-parse --show-toplevel)" || exit 1

# Dernier déploiement réussi de ce projet sur cette branche (fourni par Vercel).
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  if [ "${VERCEL_ENV:-}" = "production" ]; then
    echo "Pas de déploiement précédent exploitable en production : build."
    exit 1
  fi
  # Première preview d'une branche : on se limite au dernier commit.
  base="HEAD^"
  if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    echo "Aucun commit de comparaison : build."
    exit 1
  fi
fi

if git diff --quiet "$base" HEAD -- "$@"; then
  echo "Aucun changement dans [$*] depuis $base : build ignoré."
  exit 0
fi

echo "Changements dans [$*] depuis $base : build."
exit 1
