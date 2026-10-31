# Gestionnaire de Tournois TMC

Application web pour organiser des tournois de tennis multi-chances (TMCs) et générer des affiches de programmation.

## Fonctionnalités

### Planification TMC
- Configuration de tournois multi-chances avec différents nombres de joueurs (4, 8, 12 ou 16)
- Gestion des créneaux horaires par jour
- Planification automatique des matches sur plusieurs courts
- Support de tournois simultanés (hommes et femmes)
- Filtrage par classement de tennis (NC à 15)
- Vue calendrier et vue tableau pour le planning
- Déplacement des matches par glisser-déposer
- Export du planning au format CSV (compatible Excel)

### Génération d'affiches de programmation
- Import PDF depuis les feuilles de programmation FFT/TEN'UP
- Saisie manuelle via CSV
- Export en image JPEG (haute qualité, ratio 2×)
- Mise en page A4 avec 8 matches par page (2 colonnes × 4 lignes)
- **Affiche des résultats** : depuis un PDF Ten'Up, bascule Programmation / Résultats — les matchs terminés (score + vainqueur lus dans la feuille) forment une affiche « Résultats du … », vainqueur à gauche, score au centre ; WO exclus
- Charte graphique CAC Tennis intégrée
- **Partenaires en bas de l'affiche** : les logos configurés dans *Admin › Configuration du site › Partenaires* sont ajoutés automatiquement (10 max, 2 rangées de 5 ; au-delà de 10, tirage au hasard avec un bouton « Autre tirage », règle identique sur l'affiche des rencontres à venir et le visuel du résultat par équipe) ; case à cocher pour les retirer, cochée par défaut
- **Couleurs du club** : l'affiche reprend la couleur principale du club (*Admin › Configuration du site › Identité du club › Couleur principale*), avec des nuances dérivées pour le cartouche et le fond des joueurs du club ; rouge `#c8102e` par défaut
- **Basculement vers Live Score** : depuis l'aperçu, un bouton crée tous les matchs détectés dans Live Score (statut « En attente », événement lié optionnel) — plus de double saisie
- **Animation vidéo du programme** : une fois l'affiche téléchargée, une animation (story 1080×1920 ou carré 1080×1080) reprend ses matchs, son club mis en valeur et ses partenaires, aux couleurs et au logo du club ; lecteur intégré et **export MP4 généré dans le navigateur** (1 à 3 minutes, onglet ouvert)

### Événements
- Gestion des événements du club (Animations, Tournois, Sorties, Soirées)
- Liste paginée avec toggle « à venir / passés »
- Formulaire de création/édition avec description en Markdown (aperçu intégré)
- Upload d'image (JPEG/PNG, max 5 Mo) stockée sur Supabase Storage
- Actions : modifier, dupliquer, supprimer
- Exposition d'un flux JSON authentifié (via client Supabase) pour une future webapp publique

### Live Score
- Saisie en temps réel du score d'un match de tennis (simple ou double)
- Liste des matchs regroupés en 3 sections : en live / en attente / terminés
- Création d'un match (joueurs, classements, clubs, événement lié optionnel)
- Interface +/- par joueur pour saisir les jeux et les tiebreaks
- Détection automatique du vainqueur (sets 1 et 2, avec set décisif normal ou super tiebreak)
- Possibilité d'annuler la fin de match pour corriger une erreur de saisie, puis de le terminer à nouveau (« Terminer le match ») si le score est déjà final
- Table `live_matches` diffusée en temps réel par Supabase Realtime Broadcast (publié en base par trigger, octobre 2026)
- Disponible aussi côté PWA : connexion avec un compte BO → création de match, démarrage/reprise/libération d'un live, suivi du score, suppression. Un live a un gestionnaire (champ `scored_by`) ; un autre utilisateur authentifié peut **prendre le contrôle** après confirmation (warning avec le nom du gestionnaire actuel) — le précédent gestionnaire, s'il est sur la page de saisie, voit un bandeau l'avertir et bascule en lecture seule via Realtime.
- **Indicateur de service** : on indique qui sert — au démarrage du live, ou à tout moment pendant le match une fois le score saisi (« Déjà commencé » pour qui arrive en cours de match) ; la balle s'affiche ensuite à côté du joueur — ou de l'équipe en double — au service, calculée à partir du score (tie-breaks compris).
- PWA — fil du live : les membres du club publient des messages, des sondages et des **photos** (pellicule ou prise de vue en direct, légende facultative) ; messages et photos restent possibles une fois le match terminé, les sondages non ; les spectateurs connectés votent et réagissent d'un emoji sous chaque commentaire ou photo — six raccourcis, ou n'importe quel emoji via un sélecteur intégré avec catégories et recherche en français — (une réaction par personne, modifiable, y compris après le match ; la liste de qui a réagi est visible des comptes connectés).
- PWA — **revivre le match** : un live terminé se clôt sur un récap visible de tous, qui ouvre une story plein écran façon retransmission — le match rejoué en accéléré avec les breaks et les commentaires les plus réagis à leur heure, le moment fort, les meilleures photos, la tribune (réactions, emojis favoris, spectateurs uniques au-delà de 10) et le vainqueur, avec la progression des jeux de chaque joueur, set par set, qui se trace en mettant en scène les séries de plus de 3 jeux, les fins de set et la balle de match.

### Actus
- Rédaction d'actualités du club avec contenu en Markdown (aperçu intégré)
- Upload **multi-images** facultatif (JPEG/PNG, max 5 Mo par image, bucket Supabase Storage)
- Statut **brouillon** ou **publié** ; deux boutons distincts dans le formulaire
- Date de première publication conservée (`published_at` jamais écrasée)
- Actions sur la liste : modifier, publier, dépublier, supprimer
- **Publication simultanée sur la page Facebook du club**, en cochant l'option au moment de publier (avec un mode *debug* qui crée un post caché, visible des seuls administrateurs de la page). Nécessite qu'une page soit connectée — voir *Comptes sociaux*.
- Table `actus` exposée en lecture publique au rôle `anon` (préparation PWA, uniquement les actus publiées)

### Matches par équipe
- Gestion des **rencontres interclubs** du club (back-office), indépendamment des événements
- **Vue « grille de saison »** : lignes = équipes groupées par compétition, colonnes = journées de poule puis tours de phase finale. Chaque cellule est une rencontre colorée par état (victoire, défaite, nul, score à saisir, à venir, WO, à programmer) et cliquable — **saisir un score prend 2 clics**
- Deux vues alternatives sur les mêmes données : **Agenda** (à saisir / ce week-end / toutes les rencontres à venir semaine par semaine / déjà jouées) et **Liste** (une ligne par équipe, avancement, bilan, état)
- **Export du calendrier** en image PNG : une grille date × équipe de toutes les rencontres à venir (à domicile / à l'extérieur), aussi disponible dans la PWA pour tout membre connecté
- **Panneau latéral** : détail de la rencontre sélectionnée (score, matches individuels, raccourcis Live Score / Photos / Actu / WO) ou générateur d'affiche
- Un compteur d'en-tête remonte les **scores à saisir** — les rencontres jouées sans score ne se découvrent plus par hasard
- **Référentiel** (carte « Saisons & équipes » sur l'accueil) : saisons (une seule active à la fois), compétitions (nom, type adultes/jeunes, genre, catégorie d'âge libre — ex. « +70 ans », suggestions proposées et déduite du nom au préremplissage Ten'Up —, format) et équipes (création/suppression)
- Une compétition peut être marquée **« terminée »** : elle quitte la grille active pour une section repliée, sans disparaître
- **Équipes** par compétition : division, nombre de journées de poule (les journées sont générées automatiquement)
- **Synchronisation Ten'Up** d'une rencontre : la feuille officielle fait foi et **écrase tout** — compositions, classements, scores (y compris saisis en live), date et nom de l'adversaire ; la rencontre est confirmée. Un match terminé sur **abandon** (badge « A » sur Ten'Up) est importé comme tel (score suivi de « AB. »)
- **Synchronisation Ten'Up groupée** : sur la grille des matches par équipe, l'entrée « Synchroniser Ten'Up » du menu « ⋮ » (qui regroupe aussi l'export du calendrier et l'affiche) importe d'un coup les résultats des rencontres créées depuis Ten'Up et jouées sur les N derniers jours (7 par défaut, réglable), une rencontre après l'autre (environ 20 s chacune) ; une feuille pas encore publiée est simplement signalée.
- **Phase de poule** puis **phases finales** : qualification d'une équipe avec stade de départ (les stades 1/16 → finale sont générés automatiquement)
- **Rencontres** : club adverse, date/lieu, score final (saisie manuelle ou calculé depuis le Live Score selon le format)
- **Matches individuels** (simples/doubles) avec bascule en un clic vers le **Live Score** ; le résultat du live met à jour le gagnant et recalcule le score de la rencontre
- **Photos** de la rencontre (bucket dédié) et bouton **« Créer une actu »** qui préremplit le formulaire d'actu avec le titre et les photos
- **Génération d'affiche** des rencontres à venir, depuis le panneau latéral : les rencontres du week-end courant sont présélectionnées (max 8), l'aperçu suit la sélection → affiche JPEG téléchargée localement (`affiche-rencontres-AAAA-MM-JJ.jpg`). Le fond se choisit parmi les fonds du club, ajoutés dans *Admin › Configuration du site › Affiches* ; **sans aucun fond configuré, la génération est impossible**. Les **partenaires** sont ajoutés en bas de l'affiche (mêmes règles que l'affiche de programmation : 10 max, tirage au-delà, case pour les retirer) — le fond ne doit donc plus les contenir. L'affiche reprend la **couleur principale du club** (dates, pastille d'heure, case « Au club », fond), avec des nuances dérivées pour le fond et le séparateur de la date ; rouge `#c8102e` par défaut

### Cours

- Back-office `/courses` : types de cours, séances avec quotas femmes / hommes, responsable, validation des demandes et inscriptions manuelles. Les membres demandent une place depuis l'onglet Cours de la PWA. Un admin peut aussi **créer un cours directement depuis la PWA** (bouton « + » en bas à droite de l'onglet Cours). Quand les deux quotas sont pleins, le bouton affiche « Complet » et n'est plus cliquable.
- Une personne **sans compte** sur l'application (par exemple quelqu'un qui ne parvient pas à en créer un) peut être inscrite par un admin depuis la page d'inscriptions d'un cours : prénom, nom et sexe. Sa fiche est conservée pour les cours suivants ; l'inscription est confirmée directement, dans la limite du quota, sans notification.
- **Notifications push** (PWA) : la personne qui encadre un cours est prévenue de chaque nouvelle demande, le membre de l'acceptation ou du refus de la sienne. L'activation est proposée juste après une demande et dans l'onglet Encadrement ; on peut l'activer ou la couper à tout moment depuis **Mon profil**. Sur iPhone, l'application doit être ajoutée à l'écran d'accueil. Les emails continuent d'être envoyés en parallèle.
- **Alertes Live** (PWA) : quand on démarre un live (PWA ou BO), une case « Prévenir les abonnés du club » envoie une notification aux membres qui ont activé les alertes Live (bandeau de l'accueil des live ou Mon profil). La cloche d’un match envoie à ceux qui la touchent les fins de set, la fin du match et les nouveaux messages du fil. Réservé aux membres connectés.
- **Alertes actus et événements** (PWA) : à la publication d'une actu ou à la création d'un événement dans le BO, une case « Envoyer une notification aux membres du club » (cochée par défaut) prévient les appareils abonnés du club. La préférence « Actus et événements » de **Mon profil** est active par défaut et peut être coupée.

### PWA — navigation
- En haut à droite de chaque onglet : le **bouton profil** (prénom, nom, sexe, classement, notifications, déconnexion), ou « Connexion » si l'on n'est pas connecté
- Trois onglets en bas : **Actu**, **Match équipes**, **Live**
- Sur **Match équipes**, un membre connecté dispose d'un **bouton calendrier** (à gauche du profil) qui génère une image de toutes les rencontres à venir de la saison, à partager ou enregistrer
- **Actu** : Actualités et Événements fusionnés, basculables via des sous-onglets soulignés (l'URL conserve `?tab=…`, pull-to-refresh sur les deux flux)
- **Match équipes** : rencontres interclubs d'une équipe du club en **lecture** — à venir / passées, filtrables par saison et par équipe (bottom sheet). Une rencontre commencée affiche son **score provisoire** (« En cours » pendant un live, sinon « Provisoire ») ; cellule en mode résultat (victoire/défaite/nul + score) pour les rencontres passées. Les membres saisissent les matchs depuis la rencontre : un **live terminé valide automatiquement le résultat du match**, une saisie directe aussi, et le score de la rencontre suit ; la vérification se fait une fois, à la **confirmation de la rencontre**
  - Fiche d'une rencontre : un membre connecté peut **prendre en photo la compo** des deux équipes : les feuilles sont lues automatiquement (IA), vérifiées puis tous les simples sont créés en une fois (sinon « Ajouter match manuellement »), joueurs du club reconnus parmi les membres, classement de la feuille repris (et mis à jour sur la fiche du membre si on le souhaite)
  - Ajout manuel d'un double : les joueurs ayant déjà joué un simple dans la rencontre (club et adversaires) se cochent en tête d'écran, les deux en deux taps sans défiler ; un autre joueur se saisit à la main
  - Les **admins et gestionnaires** du club voient un bouton **« Changer la date »** sous la date de la rencontre (date et heure). La synchronisation Ten'Up se fait uniquement depuis le back-office
- **Live** : suivi du live score (inchangé)

### PWA — écran de démarrage
- À l'ouverture, un écran plein aux couleurs du club, logo centré, s'affiche le temps du chargement, comme sur une app native
- Au tout premier lancement, l'écran est blanc (les couleurs du club ne sont pas encore connues) ; elles sont mémorisées pour les lancements suivants
- Sur Android, l'écran de lancement natif de l'app installée prend lui aussi la couleur du club

### PWA — bannière d'incitation à l'installation
- Bannière fixe en bas (au-dessus de la barre de navigation) qui invite à installer l'app sur l'écran d'accueil
- Variante Android Chrome/Edge : bouton « Installer » qui déclenche le prompt natif (`beforeinstallprompt`)
- Variante iOS Safari : instructions visuelles « Touche [Partager] · puis [+] Sur l'écran d'accueil »
- Masquée si l'app est déjà installée (mode standalone)
- Fermeture (croix ou « Plus tard ») : reproposée 7 jours plus tard

### Comptes, rôles et invitations
- Accès au back-office **sur invitation** : tout se passe sur l'écran *Admin › Membres* (`/admin/members`), réservé aux administrateurs du club. L'ancienne adresse `/admin/invite` y redirige.
- **Inviter** : par email, ou en générant un lien à copier (utile en cas de blocage SMTP). L'invitation porte un **rôle**, choisi à l'envoi (défaut : Membre, le moins privilégié) :
  - **Administrateur** — tous les modules + gestion des membres
  - **Membre** — Live Score uniquement (profil adhérent PWA)
  - Le rôle **Gestionnaire** n'est plus proposé depuis le 26/10/2026 (les gestionnaires existants passent Membre) ; il est remplacé par les **capitaines d'équipe**
- **Capitaines d'équipe** : depuis la liste des équipes (*Saisons & équipes*, colonne Capitaines) ou sur la fiche d'une équipe, un administrateur déclare un ou plusieurs capitaines parmi les membres du club. Un capitaine garde les droits d'un membre et peut en plus **changer la date et l'heure** des rencontres de son équipe depuis la PWA (la rencontre repasse alors à confirmer). Une équipe étant liée à une saison, les capitaines se redéclarent à chaque saison
- **Photos de rencontre dans la PWA** : sur la fiche d'une rencontre, tout le monde voit les photos ; les administrateurs et les capitaines de l'équipe en ajoutent (réduites automatiquement), et chacun ne peut retirer que les siennes. Elles alimentent ensuite, au BO, le visuel de résultat et les actus
- Le rôle définit ce que la personne **voit** dans le back-office : le dashboard n'affiche que les modules autorisés
- **Gérer les membres** depuis le même écran : liste (nom, email, rôle, statut), changement de rôle, retrait du club, et relance de l'invitation pour quelqu'un qui n'a jamais activé son compte
  - Une invitation non activée apparaît dans la liste avec le badge *Invitation en attente* — c'est l'email qui identifie la personne tant qu'elle n'a pas rempli son profil
  - **Retirer** quelqu'un coupe son accès immédiatement, mais ne supprime pas son compte : une nouvelle invitation le rattachera
  - Un club doit toujours garder **au moins un administrateur** : rétrograder ou retirer le dernier est refusé
- Un compte qui n'appartient pas au club du back-office ouvert se voit refuser l'accès avec un message explicite (et un bouton de déconnexion), au lieu d'un back-office aux listes vides
- Inviter un email qui a déjà un compte le **rattache** au club courant, sans nouvel email

### Configuration du site
Écran *Admin › Configuration du site* (`/admin/site`), réservé aux **administrateurs** du club — un gestionnaire n'y a pas accès.

- Permet de renseigner les informations publiques du club **sans passer par la base** : identité (nom, sport, ville, logos, **couleurs**), page d'accueil (bandeau, chiffres clés, teasers école et infrastructures, appel à l'action), **Le Club** (président·e, encadrant, valeurs, méthodes et niveaux, programmes, bureau), **Infrastructures** (courts, club house, vestiaires), **Tarifs** (adhésion, cours, autres frais), coordonnées (adresse, téléphone, e-mail, lien Maps, horaires d'accueil), réseaux sociaux, partenaires, mentions légales et affichage des sections.
- Ces informations alimentent le **site vitrine** du club (voir *Site vitrine* ci-dessous). Elles ne changent **ni le back-office, ni l'application des adhérents**, à **deux exceptions près** : les **couleurs** (voir ci-dessous) et le panneau ***Affiches***, qui porte des réglages utilisés par le back-office lui-même.
- **Un bouton d'enregistrement par panneau** : corriger un numéro de téléphone ne réécrit pas l'identité du club, et deux personnes qui modifient deux panneaux différents ne s'écrasent pas.
- Les panneaux sont **repliés par défaut** — cliquer sur un titre le déplie. Chacun indique s'il est *Configuré* ou *À compléter*, ce qui donne une vue d'avancement de la saisie ; un panneau qui porte des **modifications non enregistrées** le signale plutôt que de les cacher, et replier ne perd jamais une saisie en cours.
- Pour les photos recadrées sur la vitrine, cliquez sur le sujet à garder visible dans l’aperçu de l’image entière pour définir son **point d’intérêt**, puis enregistrez le panneau. **Recentrer** rétablit le cadrage par défaut.
- Les champs marqués ⬤ sont ceux qu'attend le site vitrine, mais **un panneau incomplet s'enregistre** : on peut compléter plus tard.
- Les listes (chiffres clés, valeurs du club, programmes, membres du bureau, courts, formules de tarifs, horaires…) s'ajoutent, se retirent et se réordonnent. Une **entrée à demi remplie est refusée**, en la nommant (« 2ᵉ horaire — « Jour » est obligatoire. ») : la laisser passer ferait perdre toute la liste au rechargement suivant.
- Le panneau **Partenaires** tient la bande « Ils soutiennent le club » : un logo par partenaire (obligatoire), un nom et un lien facultatifs. Les partenaires se réordonnent, et retirer un partenaire supprime son logo.
- Le panneau **Affichage des sections** décide des blocs visibles sur le site vitrine (actualités, prochains rendez-vous, partenaires, chiffres clés). Les quatre sont **cochés par défaut** : un club qui n'a jamais ouvert cet écran affiche tout. Décocher masque le bloc **sur le site vitrine seulement** — les actus et les événements restent publiés dans l'application des adhérents.
- Dans le panneau **Tarifs**, les tarifs des formules d'adhésion et de cours se saisissent **en chiffres seuls** (« 210 ») — laissés vides, aucun tarif n'est affiché, et surtout pas « 0 € ». Les **autres frais** sont l'exception : leur tarif est du texte libre (« 15€ / h »), l'unité y étant variable.
- Le panneau **Affiches** — le dernier, et le seul qui ne concerne pas le site vitrine — porte les **fonds des affiches générées par le back-office** : celles de la programmation TMC et celles des rencontres par équipes.
  - **Plusieurs fonds par affiche.** Chacun porte un **nom** (« Tournoi de la Pentecôte », « Été 2026 ») et une **image** : au moment de générer, vous choisissez lequel appliquer parmi des vignettes. Les fonds s'ajoutent, se réordonnent et **se suppriment** ; retirer un fond efface aussi son image du stockage.
  - **Format attendu : A4 portrait** (ratio 0,71) — *794 × 1123 px minimum* pour la programmation TMC, *1414 × 2000 px minimum* pour les rencontres. **Plus grand est accepté** : un 2480 × 3508 (A4 à 300 dpi) convient pour les deux, et la même image peut servir aux deux affiches.
  - Le fond n'est pas un décor mais un cadre : les textes s'écrivent par-dessus, à des emplacements fixes que le champ indique (haut de l'affiche et grille des matchs d'un côté, bande centrale de l'autre), et les **logos des partenaires sont ajoutés en bas** des deux affiches — **laissez ces zones libres et ne dessinez pas les partenaires dans le fond**.
  - Une image aux mauvaises proportions est **refusée au choix du fichier**, en annonçant le ratio attendu et celui reçu ; rien n'est envoyé. Une image trop petite est refusée aussi : elle sortirait floue à l'export.
  - ⚠️ **Sans aucun fond configuré, l'affiche ne peut pas être générée** — le bouton est désactivé et un message renvoie vers cet écran. Un fond au minimum par affiche est donc à prévoir avant d'utiliser les deux modules.
- Les images sont envoyées **à l'enregistrement du panneau**, pas au choix du fichier ; remplacer ou retirer une image supprime l'ancienne.

#### Couleurs du club
Trois champs dans *Identité du club › Couleurs*, qui repeignent **le back-office et l'application des adhérents** :

| Champ | Effet |
|---|---|
| **Couleur principale** (obligatoire) | Boutons, liens, en-têtes, anneaux de focus. C'est elle qui **teinte tout le reste** : fonds, bordures, textes secondaires et dégradé de la page en sont dérivés. |
| **Couleur secondaire** | Boutons secondaires. Laissée vide : dérivée de la principale (même teinte, plus claire). |
| **Couleur d'accent** | Fonds doux, survols, badges. Laissée vide : dérivée de la principale. |

Le **logo principal** sert aussi d'**icône d'onglet** (favicon) au back-office et à l'application, et d'icône d'écran d'accueil sur iOS et Android. Une image **carrée** rend donc mieux qu'un logo large, que le navigateur déformera.

- La couleur du texte posé sur la principale et la secondaire (blanc ou foncé) est **choisie automatiquement** selon le contraste — une couleur claire ne donne pas du blanc sur blanc.
- Les couleurs de **sens** ne changent jamais : rouge d'erreur et bouton *Supprimer*, vert/rouge/jaune des résultats gagné / perdu / nul.
- L'effet est **immédiat** sur cet écran après enregistrement ; les autres écrans le prennent au prochain chargement.
- Les **affiches générées** (Programmation Image, rencontres à venir et résultats des Matches par équipe) suivent la **couleur principale** ; sans couleur principale lisible, elles retombent sur le rouge historique de l'affiche.

### Site vitrine

Sur mobile, le menu de navigation couvre entièrement la page et reste défilable sur les petits écrans.
Site **public** du club, servi sur `<slug>.feelike.pro` (application séparée, dossier `web/`).

- **Cinq pages** : Accueil, Le Club, Infrastructures, Tarifs, Contact — plus un panneau de contact accessible depuis n'importe quelle page.
- **Tout le contenu vient de l'écran *Configuration du site*** : textes, images, tarifs, horaires, partenaires, mentions légales, et la **couleur** du club, qui colore boutons, badges et liens du site.
- **Toute couleur reste lisible** : le texte des boutons et pastilles passe en blanc ou en foncé selon le contraste, et la couleur est automatiquement foncée là où elle sert de texte ou de fond trop moyen (contraste WCAG AA 4,5:1). Une couleur claire ne donne donc jamais du blanc sur jaune.
- **Ce qui n'est pas renseigné ne s'affiche pas.** Un club qui vient d'être créé a un site vide mais propre : pas de bloc à moitié rempli, pas de cadre d'image cassé, aucun texte d'exemple emprunté à un autre club. Remplir un panneau au back-office fait apparaître la section correspondante au rechargement.
- **Référencement automatique** : contenu et métadonnées sont présents dans le HTML initial. Les titres, descriptions, URL canoniques et données structurées viennent des informations publiées. Aucun champ SEO obligatoire.
- **Affichage initial** : les styles sont chargés avant l’affichage du contenu, y compris en développement, sans attendre le JavaScript.
- **Publication des pages** : une page intérieure vide est retirée du menu et retourne 404. La case *Rendre cette page accessible* permet aussi de la retirer explicitement. Deux surcharges facultatives (titre et description pour les moteurs) sont repliées dans chaque panneau.
- **Pendant la préparation**, le site reste exclu de l’indexation. L’ouverture automatique exige un domaine de production, une page Tarifs avec saison et prix renseignés, et un Contact avec adresse complète et téléphone ou email. Le panneau *Affichage des sections* permet de suspendre le référencement. Les previews restent toujours exclues ; les textes et coordonnées doivent être relus avant publication.
- Les mises à jour du BO sont reprises à chaque navigation ou rechargement, sans purge manuelle. Les photos originales sont conservées ; Vercel peut les servir à une taille adaptée à l’écran.
- Les sections *Actualités* et *Prochains rendez-vous* de l'accueil, ainsi que l'**envoi** du formulaire de contact, arrivent dans une prochaine livraison : en attendant, le formulaire est affiché mais son bouton est inactif, et les blocs d'actualités ne s'affichent pas du tout.

### Landing `www.feelike.pro`

Site marketing de la plateforme (application séparée, dossier `landing/`) : présentation du produit, récit d’un match (photo de la compo, matchs créés, live, notifications, story, affiche), tarifs (essai 30 jours sans carte, Saison 250 €/an), FAQ et appel à l'essai ou à un call de 20 minutes.

- **Tant que l'inscription en ligne n'est pas ouverte**, les boutons d'essai affichent « Demander un accès » et mènent au call. Il suffit de renseigner `PUBLIC_SIGNUP_URL` dans Vercel pour les rebrancher.
- Lien de réservation, mention TVA, e-mail de contact et mesure d'audience (Plausible, sans cookie ni bandeau) se règlent par variables d'environnement : voir `landing/README.md`.
- Mentions légales et CGV : pages prêtes mais **contenu à fournir**, exclues de l'indexation d'ici là.

### Inscription d'un club `admin.feelike.pro/inscription`

Un club crée son espace seul, en quatre écrans et moins de deux minutes, avec 30 jours d'essai sans carte bancaire.

- **Club** (nom, ville, sport), **Logo** (la couleur du club est tirée du logo ; sans logo, trois couleurs proposées ou une couleur libre ; photo du club facultative), **Adresse** (`<slug>.feelike.pro`, proposée depuis le nom et vérifiée en direct ; si elle est prise, une variante avec la ville est proposée), **Compte** (e-mail, acceptation des CGU et de la politique de confidentialité, vérification anti-robot).
- À droite, le **site et l'app du club se construisent pendant la saisie**, à ses couleurs et tels que le produit les affichera ; l'app montre des rencontres d'exemple. Sur téléphone, l'aperçu s'ouvre avec « Voir l'aperçu ».
- Logos et photos acceptés : PNG, JPEG ou WebP. Les photos de téléphone sont réduites automatiquement avant l'envoi.
- À la fin, un **lien de connexion** part par e-mail : le club est confirmé et l'essai démarre au clic. L'écran de confirmation permet de **renvoyer le lien** ou de corriger l'adresse e-mail. Sans clic sous 7 jours, l'inscription est effacée.
- La saisie survit à un rechargement de la page (dans le même onglet).
- **Pas encore ouvert au public** : la page affiche « Les inscriptions ouvrent bientôt » tant que la clé anti-robot et les adresses des CGU et de la politique de confidentialité ne sont pas configurées.

### Comptes sociaux
Écran *Admin › Comptes sociaux* (`/admin/social`), réservé aux **administrateurs** du club.

- Connecte la **page Facebook** sur laquelle le club publie ses actualités. Chaque club a la sienne : rien n'est partagé entre clubs.
- Un seul champ à remplir, le **token d'accès de la Page**. Il n'y a **pas d'ID de page à saisir** : la page est reconnue à partir du token, et son vrai nom s'affiche une fois la connexion établie — c'est la confirmation qu'on a connecté la bonne.
- Le token est **vérifié auprès de Facebook avant d'être enregistré**. Un token invalide, expiré, ou qui est en réalité un token *utilisateur* et non un token de *Page*, est refusé en le disant — et ne remplace pas une connexion qui fonctionnait.
- Le token **n'est jamais réaffiché** ensuite, ni renvoyé au navigateur : l'écran montre la page connectée et l'échéance du token, pas le secret. Pour le renouveler, on en colle un nouveau.
- **Tant qu'aucune page n'est connectée**, l'option « Publier aussi sur Facebook » d'une actu échoue avec un message qui renvoie ici. L'option reste proposée aux gestionnaires : eux publient les actus, mais ne voient pas les identifiants.

### Console plateforme (super-admin)
Réservée au **super-admin** de la plateforme, sur `/super-admin` (carte *Plateforme › Console plateforme* du dashboard). Invisible et inaccessible pour un administrateur de club.

- **Créer un club** : nom, slug et sport. Le slug est le sous-domaine du club (`<slug>.feelike.pro`) : minuscules, chiffres et tirets, 2 à 32 caractères, ni préfixe `app-` (réservé à la PWA) ni slug réservé par la plateforme. Sa ligne de configuration est créée automatiquement.
- **Lister** les clubs avec leur statut, leur date de création, leur nombre de membres et un marqueur **« aucun admin »** — l'état d'un club fraîchement créé, dont l'action suivante est l'invitation.
- Les clubs créés par l'**inscription en ligne** apparaissent **« En attente de confirmation »** tant que leur créateur n'a pas cliqué le lien reçu par email : ils ne sont ni suspendables ni réactivables, et sont supprimés automatiquement au bout de 7 jours sans confirmation. Une fois confirmés, ils affichent la date de **fin de leur essai** (30 jours).
- **Inviter le premier administrateur** d'un club, par email ou en générant un lien à copier.
- **Suspendre / réactiver** un club. Un club suspendu n'est plus accessible à ses membres (back-office et PWA). Suspendre le club dans lequel on se trouve est refusé.
- **Entrer dans un club en support** : le back-office bascule sur ce club (même suspendu, pour diagnostic), avec un bandeau permanent rappelant où l'on se trouve et un bouton *Quitter*. Ça ne donne aucun droit supplémentaire : le club affiché change, pas les permissions.

Le **tout premier super-admin** se pose à la main dans le SQL Editor Supabase — il n'existe volontairement aucune interface de promotion (personne ne peut se promouvoir soi-même) :

```sql
UPDATE public.profiles SET is_super_admin = true
WHERE id = (SELECT id FROM auth.users WHERE email = '<email>');
```

### Général
- Authentification via Supabase
- Sauvegarde automatique avec localStorage (TMC) et Supabase (Events)

## Installation

```bash
# Installer les dépendances
npm install

# Lancer en mode développement
npm run dev

# Compiler pour la production
npm run build
```

### Configuration de l'environnement (nouveau dev)

L'application pointe sur Supabase via des variables d'environnement. **En local, on travaille toujours sur le projet Supabase de développement** — jamais sur la production.

Pour le back-office (racine du projet) :

```bash
# Copier le modèle versionné
cp .env.example .env.local

# Puis éditer .env.local et renseigner les clés du projet Supabase de DEV :
#   VITE_SUPABASE_URL      → dashboard Supabase (dev) → Project Settings → API
#   VITE_SUPABASE_ANON_KEY → idem
#   VITE_ENV=development    (à garder tel quel en local)
```

Faire de même pour la PWA :

```bash
cp pwa/.env.example pwa/.env.local
# puis renseigner les mêmes clés du projet Supabase de DEV
```

Et pour le site vitrine :

```bash
cd web && npm install
cp .env.example .env.local
# puis renseigner les mêmes clés du projet Supabase de DEV
# VITE_DEV_CLUB_SLUG choisit le club affiché en local (en production, c'est le sous-domaine)
npm run dev -- --port 0
# Tests : npm test ; npm run build ; npm run check:build
```

Déploiement de la vitrine : preset Vercel **Other**, Root `web/`, Node 22,
build `npm run build`, sortie Build Output API (retirer l’ancien override `dist`).
Le domaine Vercel de production fourni par `VERCEL_PROJECT_PRODUCTION_URL` affiche
le club défini par `VITE_DEV_CLUB_SLUG`, en `noindex`. Les domaines des clubs gardent
leur résolution et leur référencement habituels.
Procédure : [WEB_SITE.md](docs/specs/WEB_SITE.md#9-développement-tests-et-déploiement).

Notes :
- `.env` et `.env.local` sont gitignorés : **aucune clé réelle n'est versionnée**.
- `VITE_ENV` vaut `development` en local et `production` sur les déploiements. Si un serveur de dev local démarre avec `VITE_ENV=production`, un avertissement est loggé dans la console pour éviter d'atteindre la prod par erreur.

### Whitelist des URLs de redirection (obligatoire pour les invitations)

Le flux d'invitation renvoie l'invité sur `<origin>/accept-invite`, où `<origin>` est
l'origine réelle de l'app (`window.location.origin` — aucun port n'est codé en dur). Supabase
n'autorise cette redirection que si elle figure dans **Authentication → URL Configuration →
Redirect URLs** du projet concerné ; sinon il retombe **silencieusement** sur le *Site URL* et
l'invité n'atteint jamais l'écran d'activation (il reçoit bien l'email, mais le lien le dépose
ailleurs).

À déclarer une fois par projet Supabase :

| Projet | Entrée |
|---|---|
| dev | `http://localhost:*/**` — glob de port : survit au décalage de Vite (5173 → 5174 → …) quand plusieurs serveurs de dev tournent |
| prod | l'origine de déploiement, ex. `https://<projet>.vercel.app/**` (puis `https://*.feelike.pro/**` au passage au wildcard) |

## Utilisation

### Planification TMC

#### 1. Configuration Générale

- **Date de début/fin** : Définissez la période du tournoi
- **Nombre de courts** : Nombre de courts disponibles
- **Durée d'un match** : Durée estimée en minutes (par défaut 90min)

#### 2. Créneaux Horaires

Pour chaque jour du tournoi, définissez :
- La date
- L'heure du premier match
- L'heure du dernier match (dernière heure de début autorisée)

#### 3. Tournois

Ajoutez autant de tournois que nécessaire :
- **Sexe** : Homme ou Femme
- **Nombre de joueurs** : 4, 8, 12 ou 16 (12 joueurs = tableau asymétrique, 4 joueurs exemptés du 1er tour)
- **Classement minimum et maximum** : De NC (le plus bas) à 15 (le plus haut)

#### 4. Génération du Planning

Une fois tous les paramètres renseignés, cliquez sur "Générer le Planning" pour obtenir :
- Une vue calendrier jour par jour avec déplacement des matches par glisser-déposer
- Une vue tableau complète
- L'identification de chaque match par tournoi et type (quart, demi, finale, etc.)

### Génération d'affiches de programmation

Accessible depuis le menu principal → **Programmation Image**.

#### 1. Import des données

Deux méthodes disponibles :
- **Import PDF** : Importer directement une feuille de programmation FFT/TEN'UP. L'application extrait automatiquement les joueurs, classements, clubs et horaires.
- **Saisie CSV** : Saisir manuellement les données des matches au format CSV (sans club). La section « Données CSV » est repliée par défaut : cliquer sur son titre pour l'ouvrir.

#### 2. Export en image

Une fois les matches chargés, cliquez sur "Télécharger", en tête de l'aperçu, pour générer une image JPEG par page.
- Chaque page contient jusqu'à 8 matches
- Le fond de l'affiche se choisit **parmi les fonds du club**, ajoutés dans *Admin › Configuration du site › Affiches* : une rangée de vignettes au-dessus de l'aperçu, le premier fond par défaut. **Sans aucun fond configuré, la génération est impossible.**

#### 3. Animation vidéo (story ou carré)

Sous l'aperçu, la section **« Animation vidéo »** s'ouvre une fois l'affiche téléchargée : la vidéo reprend exactement ses réglages (matchs, club mis en valeur, partenaires). Modifier l'un d'eux demande de régénérer l'affiche.
- La case **« Générer aussi la vidéo dans la foulée »**, sous le bouton de téléchargement de l'affiche et cochée par défaut, lance la vidéo (au format choisi, story par défaut) juste après l'image
- Choisir le format : **story** (1080 × 1920, pour les stories Facebook / Instagram) ou **carré** (1080 × 1080, pour une publication)
- Le titre est prérempli avec l'événement choisi dans « Envoyer vers Live Score », modifiable
- **Télécharger la vidéo (MP4)** la génère dans le navigateur (Chrome, Edge ou Safari récents) : garder l'onglet ouvert et visible, la génération se met en pause sinon

#### 4. Basculer les matches vers Live Score

Sous l'aperçu, la zone **« Envoyer vers Live Score »** permet de créer en un clic tous les matches détectés dans le module Live Score :
- Sélection optionnelle d'un événement à associer aux matches
- Tous les matches sont créés avec le statut « En attente » et devront être démarrés manuellement depuis `/live-score`
- Le bouton se réinitialise dès qu'un nouveau PDF/CSV est importé

## Technologies

- **React 19** : Framework UI
- **TypeScript** : Typage statique
- **Vite** : Build tool
- **Tailwind CSS** : Styling
- **Supabase** : Authentification et base de données
- **html-to-image** : Génération d'images depuis le DOM
- **pdfjs-dist** : Parsing des PDFs FFT/TEN'UP
- **localStorage** : Persistance locale des données

## Structure du Projet

```
src/
├── pages/
│   ├── AppHomePage.tsx             # Dashboard principal
│   ├── HomePage.tsx                # Liste des tournois
│   ├── TournamentPage.tsx          # Configuration et planning d'un tournoi
│   ├── ProgrammationImagePage.tsx  # Générateur d'affiches
│   ├── EventsPage.tsx              # Liste des événements du club
│   ├── LiveScorePage.tsx           # Liste des matchs en live score
│   ├── LiveMatchPage.tsx           # Saisie du score d'un match
│   ├── ActusPage.tsx               # Liste des actus du club (brouillons + publiées)
│   └── LoginPage.tsx               # Authentification
├── components/
│   ├── ConfigurationForm.tsx       # Formulaire de configuration TMC
│   ├── ScheduleView.tsx            # Vues calendrier et tableau avec drag-and-drop
│   ├── ConfigDropdown.tsx          # Sélecteur de configurations prédéfinies
│   ├── EventCard.tsx               # Carte d'un événement
│   ├── EventForm.tsx               # Formulaire création/édition d'événement
│   ├── LiveMatchCard.tsx           # Carte d'un match dans la liste Live Score
│   ├── LiveMatchForm.tsx           # Formulaire de création d'un match en live
│   ├── LiveScoreEntry.tsx          # Interface +/- de saisie de score
│   └── ActuForm.tsx                # Formulaire création/édition d'actu (Markdown + multi-images)
├── hooks/
│   └── useLocalStorage.ts          # Hook pour localStorage
├── lib/
│   └── supabase.ts                 # Client Supabase
├── types.ts                        # Définitions TypeScript
├── tmcLogic.ts                     # Logique de génération des matches TMC
├── scheduler.ts                    # Algorithme de planification
├── moveMatch.ts                    # Logique de déplacement des matches
├── exportScheduleCsv.ts            # Export du planning TMC en CSV
├── liveScoreRules.ts               # Règles de score tennis (sets, tiebreak, super TB)
├── App.tsx                         # Configuration du routeur
└── main.tsx                        # Point d'entrée
```

## Licence

MIT


## Corrections de sécurité de l'audit PWA (05/09/2026)

Le premier lot limite les écritures métier aux administrateurs/gestionnaires
(les membres conservent Live Score), bloque les clubs suspendus côté API et
assainit les contenus HTML affichés. Réinviter un membre ne change plus son rôle ;
un club ne peut plus perdre son dernier administrateur.

La publication Facebook vérifie le club, le rôle et la publication de l'actualité.
La variable serveur `FACEBOOK_CLUB_ID` devait identifier le club associé aux
credentials existants — **elle n'est plus lue depuis que chaque club a sa propre
page connectée** (voir *Comptes sociaux* plus haut) et peut être retirée.

Ces protections SQL nécessitent l'application de la nouvelle migration ; elles ne
s'activent pas par la seule mise à jour du frontend. Voir
[les consignes et limites](docs/SECURITY_AUDIT_FIXES.md).

Tests isolés, sans connexion à Supabase : `npm run test:security`.


### PWA : cache et appels réseau

Les contenus consultés sont réutilisés pendant 60 secondes lors des allers-retours entre pages.
Le tirer-pour-rafraîchir force toujours leur rechargement. L'identité visuelle du club est
chargée une seule fois pour les composants qui l'utilisent (cache 5 minutes).
Le Live conserve ses notifications temps réel et son contrôle de secours toutes les 30 secondes ;
les rafales de notifications sont regroupées et les profils ne sont plus rechargés à chaque score.
Le cache mémoire est renouvelé au changement de compte et à la déconnexion.

Vérification locale : `npm run test:pwa-network` à la racine, puis `npm --prefix pwa run build`.
Ce lot ne nécessite aucune migration Supabase ni déploiement d'Edge Function.


### Fiabilité du Live Score (BO et PWA)

La saisie affiche « Enregistrement… » pendant la confirmation du score et bloque brièvement
les commandes. Une reprise depuis un autre compte passe l'ancien gestionnaire en lecture seule.
En cas de conflit ou de coupure, un message propose de recharger le score sans répéter
l'écriture. Les notifications retardées ne remplacent plus un score plus récent.

Pré-requis : appliquer `supabase/migrations/20260907_live_match_consistency.sql` avant
les nouveaux clients, puis recharger les deux applications. Tests : `npm run test:live-score`.

La migration `20260908_live_matches_public_read.sql` permet aux visiteurs non connectés de suivre les matchs des clubs actifs ; la connexion reste nécessaire pour leur gestion.

Dans la PWA, la page live d'un match affiche la durée du match et celle de chaque set, mise à jour en direct pendant le match. La durée des sets nécessite `supabase/migrations/2026101301_live_set_times.sql` ; sans elle, seule la durée du match s'affiche.

Les listes Live du BO et de la PWA masquent les matchs terminés depuis plus de trois jours après `finished_at` et affichent les matchs terminés du plus récent au plus ancien. Les données restent conservées en base ; aucune migration n’est nécessaire pour ce filtre.

### Formulaire de contact (PR11)

Le formulaire de la vitrine envoie au destinataire configuré dans `/admin/site`.
Installation Supabase et vérifications : [docs/CONTACT_DELIVERY.md](docs/CONTACT_DELIVERY.md).

### Récupération de compte

Le back-office et la PWA proposent « Mot de passe oublié ». Les liens sont gérés par
Supabase Auth ; l’envoi via Brevo exige de configurer le SMTP personnalisé du projet
(et sa limite d’emails), indépendamment de la clé API du formulaire de contact.
Configuration et recette : [ACCOUNT_RECOVERY.md](docs/ACCOUNT_RECOVERY.md).

## Domaines de la plateforme (PR13)

Domaine racine confirmé : **feelike.pro**, enregistré chez OVHcloud.
Vitrine : `<club>.feelike.pro` ; PWA : `app-<club>.feelike.pro` ; BO central avec sélection
du club après connexion : `admin.feelike.pro`. Landing marketing : `www.feelike.pro` (apex redirigé),
projet Vercel séparé, cf. `landing/README.md`.
Le code ne met pas les DNS en service : suivre [la procédure OVH/Vercel](docs/DOMAINS_DELIVERY.md)
avant de clôturer la PR13. Le domaine propre de CAC est prévu en PR14.
