# Validation des mises à jour PWA

La PWA vérifie les mises à jour au lancement, au retour au premier plan, à la reconnexion et toutes les cinq minutes lorsqu’elle est visible et en ligne. Les vérifications réseau sont espacées d’au moins 30 secondes. Une version prête affiche un bandeau global ; seul le bouton « Actualiser » autorise le rechargement de cette fenêtre. Le bandeau reste disponible pour permettre de finir une saisie avant de cliquer.

Le service worker est généré par Vite PWA en mode `prompt`, sans injection automatique du script d’enregistrement. `pwaUpdates.ts` gère l’enregistrement et le consentement par fenêtre. Une activation depuis un autre onglet affiche aussi le bandeau sans recharger la page courante. Aucune migration Supabase.

## Tests automatisés

- `npm run test:pwa-updates` : installation initiale, version en attente, installation d’une mise à jour, consentement, autre onglet, visibilité, réseau, nettoyage, délai d’activation.
- `npm run test:pwa-network` : non-régression des abonnements et requêtes PWA.
- `npm run build --prefix pwa` : compilation TypeScript et génération du service worker.

## Essai avec deux versions compilées

Le mode `npm run dev` ne permet pas de valider le service worker.

1. Configurer les variables habituelles de la PWA dans le worktree, puis compiler une version A : `npm run build --prefix pwa`.
2. Servir le résultat avec `npm run preview --prefix pwa -- --host 127.0.0.1 --port 4173`. Utiliser localhost pour le test local, ou un hébergement HTTPS pour un téléphone.
3. Ouvrir la PWA, puis recharger une fois pour être contrôlé par le service worker. Ouvrir un second onglet sur la même origine.
4. Changer temporairement un libellé dans le code (par exemple `Cours` dans `BottomNav.tsx`, pas le contenu d’une actualité), compiler une version B au même endroit et sur la même origine. Garder les deux pages ouvertes.
5. Mettre une page en arrière-plan puis revenir après au moins 30 secondes : le bandeau doit apparaître une fois B téléchargée. Le texte et les saisies de A doivent rester en place.
6. Cliquer sur « Actualiser » : B s’affiche sur la même URL. L’autre onglet doit proposer la mise à jour sans se recharger automatiquement.
7. Vérifier aussi la reconnexion après un démarrage hors ligne, la navigation Cours/Live/Actu avec le bandeau, une largeur mobile de 320 px et la coexistence du bandeau d’installation.
8. Restaurer le texte temporairement modifié.

## Premier déploiement

Les utilisateurs exécutant encore l’ancienne version ne possèdent pas ce mécanisme. Un premier rechargement, voire la fermeture de toutes les fenêtres de la PWA si le nouveau worker reste en attente, peut être nécessaire pour le recevoir. Valider ensuite une seconde livraison sur iOS et Android : le correctif ne peut pas ajouter rétroactivement le bandeau au JavaScript déjà chargé.
