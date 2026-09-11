# Audit SEO et GEO — vitrine web

Date : 7 septembre 2026. Code audité : `main`, commit `caabb42`.

> Audit initial conservé ; les améliorations et preuves de vérification sont décrites dans
> **« Mise en œuvre et vérifications — 8 septembre 2026 »**, en fin de document.

GEO désigne ici la visibilité dans les réponses des moteurs IA. Le référencement local est également couvert.

## Périmètre et conclusion

Inspection du code de `web/`, des réponses HTTP du serveur local et des cinq pages rendues avec la configuration Supabase de développement. Aucun changement applicatif ni écriture en base. Le domaine public, les réglages Vercel, Search Console, les positions et les liens entrants n'ont pas été audités. Aucun score Lighthouse ou résultat Core Web Vitals terrain n'a été mesuré.

Le socle fonctionnel est présent, mais le rendu et l'identification des pages ne sont pas encore préparés pour une bonne exposition aux moteurs. La priorité est de fournir le contenu et les métadonnées dans le HTML initial, puis de maîtriser les URL et de compléter les informations du club. Les contenus déjà saisis restent utilisables.

Points positifs : URLs simples, cinq pages distinctes, navigation et footer avec de vrais liens après rendu, HTML en français, contenu textuel plutôt que texte incorporé dans des images, police auto-hébergée, identité et coordonnées centralisées dans la configuration.

## Constats reproductibles

### 1. Priorité haute — contenu absent du HTML initial

`web/index.html:12` contient un titre générique et une racine React vide. `web/src/contexts/SiteContext.tsx:40` attend deux lectures successives : résolution du club, puis configuration. Pendant cette attente, aucun contenu du site n'est rendu.

Les requêtes locales vers `/`, `/club` et `/tarifs` ont retourné `200 text/html`, le titre « Site du club » et `<div id="root"></div>`. Un client qui ne rend pas JavaScript ne reçoit donc pas les informations du club dans ce HTML.

Google sait rendre JavaScript ; une SPA n'est pas automatiquement non indexable. Mais les dépendances réseau et le rendu différé compliquent l'exploration. Ne pas supposer que tous les moteurs de réponse ont les mêmes capacités. [Documentation Google sur le SEO JavaScript](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

**Action proposée :** conserver les composants React, ajouter un rendu serveur avec cache par club et par route, ou un prérendu avec régénération lors des modifications du BO. Servir la même information aux visiteurs et aux robots. Ne pas générer seulement les balises de tête en laissant le corps vide.

Le cache doit tenir compte du domaine/club, de la route et des changements de configuration. Une suspension doit aussi invalider les pages publiques. Un simple prérendu global du club de développement ne convient pas à une plateforme multi-tenant. Choisir l'implémentation après confirmation de l'hébergement et de la stratégie de domaines ; changer de framework n'est pas une obligation.

### 2. Priorité haute — identité SEO identique ou absente

`SiteContext.tsx:76` donne uniquement le nom du club à `document.title`. Les cinq pages rendues avaient « CAC Tennis Club » comme titre. Aucune description, canonical ou donnée JSON-LD n'a été trouvée. Pas de balises Open Graph dans le code.

**Action proposée :** générer titre et description propres à chaque route, canonical absolue et métadonnées de partage dès le serveur. Exemple pour les tarifs : « Tarifs et cours de tennis à Castelsarrasin | CAC Tennis Club ». La description doit résumer les informations effectivement publiées. Open Graph améliore les aperçus de partage ; ce n'est pas une garantie de classement.

Définir une origine publique officielle par club : domaine personnalisé ou sous-domaine canonique. Ne pas utiliser aveuglément le nom d'hôte de la requête pour construire les canonical. Rediriger les alias publics vers l'origine retenue. [Canonicalisation Google](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).

### 3. Priorité haute — fausses pages et contrôle d'indexation

`web/src/App.tsx:40` affiche l'accueil pour toute route inconnue ; `web/vercel.json:2` réécrit toutes les routes vers `index.html`. Le chemin local de test `/seo-audit-page-inexistante` retourne ainsi un HTTP 200. Cela crée un risque de pages dupliquées et de soft 404.

Il n'existe pas de fichiers dédiés `robots.txt` ou `sitemap.xml` dans `web/`. En local, ces deux chemins renvoient également le HTML de la SPA. L'absence de sitemap ou de robots.txt n'interdit pas en elle-même l'indexation.

**Actions proposées :** vraies réponses 404 pour routes et clubs inconnus ; réponse d'erreur adaptée à une indisponibilité temporaire ; sitemap des pages publiées uniquement ; robots.txt valide ; politique explicite pour les previews. Vérifier les réponses HTTP sur le déploiement final, car le serveur Vite ne prouve pas à lui seul le comportement de Vercel.

Le repli vers `cac-tennis` sur tout hôte non reconnu dans `SiteContext.tsx:32` doit être limité au développement/aux previews autorisées. Un domaine inconnu ne doit pas publier accidentellement une copie indexable de CAC.

Pour les previews accessibles publiquement, vérifier la protection de déploiement et/ou un `X-Robots-Tag: noindex`. Un `Disallow` dans robots.txt ne remplace pas `noindex` et peut empêcher sa lecture. Le localhost n'est pas un site public à désindexer. [Directive noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

### 4. Priorité haute avant publication — contenu et titres intérieurs

État de la configuration de développement observée, susceptible d'évoluer pendant la saisie :

| Page | H1 rendu | Contenu principal |
|---|---|---|
| Accueil | Oui | Bandeau, chiffres, école, infrastructures, partenaires |
| Le Club | Non | Présidente et texte de test « Coucou » |
| Infrastructures | Non | Deux catégories de courts |
| Tarifs | Non | Vide |
| Contact | Non | Formulaire désactivé, ville/code postal, un horaire |

`web/src/components/layout/PageHeader.tsx:14` ne rend le H1 que si le titre a été renseigné. Prévoir un titre de page par défaut utile, dérivé de la route et du club. Le but est une structure claire, pas une règle magique sur le nombre de H1.

Ne pas indexer les pages en brouillon ou vides. Prévoir une disponibilité/publication par page, utilisée aussi par le sitemap et la navigation. Remplacer les textes de test avant mise en ligne.

Vérifier la cohérence de l'adresse : le footer affiche une rue via l'identité, alors que le bloc Contact n'affichait que le code postal et la ville. Renseigner les champs structurés de coordonnées plutôt qu'une adresse uniquement dans un texte de marque. Corriger également « Couts intérieurs » et « éclaires ».

### 5. Priorité moyenne — identité locale et données structurées

Aucun JSON-LD n'est actuellement produit. Ajouter une entité stable correspondant réellement au club/lieu, par exemple `SportsClub`, avec un `@id` fondé sur son domaine officiel. Réutiliser nom, adresse, téléphone, URL, photos, profils officiels et horaires vérifiés. Ne pas inventer de notes, d'avis ou de coordonnées géographiques.

Les horaires sont aujourd'hui du texte libre (`opening_hours: day/time`) : ne pas convertir arbitrairement « sur rendez-vous » en horaires précis. Ajouter une représentation structurée si nécessaire et garder le texte visible cohérent.

Le balisage aide à décrire les faits ; il ne garantit ni résultat enrichi ni citation IA. [Schema.org SportsClub](https://schema.org/SportsClub), [données LocalBusiness Google](https://developers.google.com/search/docs/appearance/structured-data/local-business).

Hors code : vérifier la fiche Google Business Profile du club, son URL, ses coordonnées et ses horaires, puis la cohérence avec les pages de la mairie et des organismes sportifs. Solliciter des avis authentiques. La distance fait partie des critères locaux et ne se corrige pas par une balise SEO. [Conseils officiels pour le classement local](https://support.google.com/business/answer/7091?hl=fr).

### 6. Priorité moyenne — liens et images

Les boutons « Découvrir le club » et « Voir les formules » utilisent `navigate()` sans `href`. Les pages sont déjà reliées par le menu/footer, donc elles ne sont pas orphelines. Utiliser néanmoins des `Link` pour ces navigations et conserver les boutons pour l'ouverture du panneau Contact. [Liens explorables](https://developers.google.com/search/docs/crawling-indexing/links-crawlable).

Les photos de courts et d'école utilisent des alternatives vides. Donner une alternative descriptive aux images informatives ; garder `alt=""` pour les images décoratives ou redondantes. Ajouter `srcset`/`sizes`, des formats adaptés et un chargement différé sous la ligne de flottaison. Ne pas charger paresseusement l'image principale ; examiner sa priorité de chargement. Réserver la place des images : des ratios CSS existent déjà, donc l'absence de largeur/hauteur HTML ne suffit pas à conclure à un CLS dégradé. [SEO des images](https://developers.google.com/search/docs/appearance/google-images).

Les dépendances de configuration retardent aussi la découverte de l'image principale. Le bénéfice exact doit être mesuré sur un build de production. À la mise en ligne, contrôler LCP, INP et CLS, sur mobile et avec les données terrain lorsqu'elles existent. [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals).

## GEO : contenus à préparer maintenant

Publier des réponses précises aux questions réelles : à partir de quel âge apprendre, accueil des adultes débutants, fréquence des cours, tarifs de la saison et licence incluse ou non, réservation des courts, séance d'essai, accès et stationnement. Employer les faits du club ; ne pas affirmer une prestation encore non confirmée.

Placer ces réponses dans les pages concernées, avec des sous-titres clairs, des paragraphes courts et, pour les formules, un tableau lisible. Une petite FAQ peut être utile sans promettre un affichage enrichi. Mentionner la saison tarifaire et les qualifications vérifiées des encadrants. Pour les futurs événements/actualités, prévoir des URLs propres, des dates réelles et une attribution éditoriale.

Ces propositions visent à rendre les informations faciles à retrouver, comprendre et citer. Ce ne sont pas des garanties de présence dans ChatGPT ou d'autres moteurs. Google indique que ses expériences IA reposent sur les fondamentaux SEO et n'exigent ni fichier `llms.txt` ni balisage spécial. Ne pas en faire une priorité pour ce site. Vérifier ultérieurement l'accès des robots de recherche concernés dans le CDN et robots.txt, en distinguant recherche et entraînement. [Guide Google sur les expériences IA](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide).

## Proposition de réalisation

1. **Socle avant indexation :** choisir le rendu HTML, définir les domaines canoniques par club, gérer 404 et previews, générer métadonnées et sitemap à partir des pages publiées.
2. **Configuration utile :** titres SEO/descriptions calculés par défaut, quelques surcharges facultatives par page, image de partage, alternatives des photos informatives et état de publication. Les données structurées restent générées depuis les coordonnées existantes ; ne pas exposer du JSON-LD à saisir dans le BO.
3. **Contenus et performance :** terminer les pages, vérifier les informations locales, optimiser les images, puis mesurer le build public.
4. **Suivi après déploiement :** vérifier Search Console et Bing Webmaster Tools, soumettre le sitemap, inspecter les cinq URLs, surveiller indexation, requêtes locales et visites qualifiées. Vérifier manuellement un petit ensemble de questions réelles dans les moteurs de réponse, sans présenter les réponses variables comme une mesure exhaustive.

Critères d'acceptation : une requête HTTP sans JavaScript expose le contenu et les métadonnées propres à la route ; une URL inconnue retourne 404 ; le sitemap ne contient que des URLs canoniques publiées ; previews exclues de l'indexation ; même club et mêmes faits dans le HTML, le rendu hydraté et le JSON-LD ; mise à jour du BO répercutée dans le cache ; aucune contamination entre deux clubs ; tarifs et contacts complets avant ouverture à l'indexation.

**Décision conseillée :** continuer la saisie actuelle, puis réaliser une PR dédiée au socle SEO/GEO avant la publication et l'indexation du site. Les modifications proposées ici restent à implémenter.

---

## Mise en œuvre et vérifications — 8 septembre 2026

Les constats ci-dessus sont conservés comme **audit initial du 7 septembre**. Les numéros de
ligne et les observations de contenu décrivent cet état antérieur ; le club poursuit sa saisie.
Le rapport a été copié depuis le dossier d’origine dans ce worktree avant modification.
Aucune donnée réelle, image ou texte n’a été réécrit en base dans cette tâche.

### Décision de rendu

**SSR React/Vite à chaque requête**, sans changement de framework, empaqueté en fonction
Node 22 par la Build Output API Vercel. Une requête jointe anon lit l’identité, le statut et
la configuration du seul club résolu. Le serveur fournit le corps public, le H1, les tokens
couleur, les métadonnées et le JSON-LD. `hydrateRoot` reprend le snapshot sérialisé et échappé.
Les liens `reloadDocument` donnent une nouvelle réponse serveur à chaque navigation.

Un prérendu global aurait figé le tenant au build et nécessité une régénération depuis le BO.
Un cache de HTML aurait ajouté une stratégie de purge et une fenêtre de contenu obsolète lors
des suspensions. **Aucun cache de contenu n’est donc activé** : `private, no-store`, y compris
pour les caches CDN/Vercel. Le coût assumé est une lecture DB + un rendu par requête ; mesurer
le TTFB sur Vercel avant de décider d’un cache. Tout cache futur devra inclure origine, club,
route et version de configuration, avec invalidation sur publication et suspension.

Références d’implémentation vérifiées : [SSR Vite](https://vite.dev/guide/ssr.html),
[Build Output API et images](https://vercel.com/docs/build-output-api/configuration),
[fonction Node Vercel](https://vercel.com/docs/build-output-api/primitives).

### Livré dans le worktree

| Sujet | Comportement implémenté |
|---|---|
| HTML initial | Texte de la route + H1 + métadonnées + JSON-LD, même snapshot pour React ; plus de racine vide en attente de Supabase. |
| Titres / descriptions | Automatiques par route et club, avec ville/saison lorsqu’elles sont renseignées ; deux surcharges facultatives repliées dans le BO. |
| Canonical | Origine issue de `clubs.slug` ou `clubs.custom_domain`, URL absolue sans paramètres ; alias du sous-domaine vers le custom domain en 308. Aucun champ canonical à saisir. |
| HTTP | 404 pour routes inconnues, clubs inconnus/suspendus, pages intérieures vides/retirées ; 503 et Retry-After pour indisponibilité DB/réseau ou relation de configuration invisible. HEAD sans corps, méthodes non supportées en 405. |
| Publication | `published` par page, défaut positif ; détection automatique de contenu utile. L’accueil vide présente le nom du club en H1 en noindex. Menus, liens de découverte et sitemap suivent la publication. |
| Préparation à l’indexation | Production Vercel + base prod + accueil avec contenu + tarifs accessibles avec saison et montants + contact accessible avec adresse complète et téléphone/email. Sinon noindex, follow. `settings.search_indexing` permet de suspendre globalement. |
| Previews | Noindex dans les balises et en-têtes ; repli de club seulement sur les hôtes de preview reconnus. Domaine inconnu sans repli CAC. |
| Découverte | robots.txt text/plain explorable pour lire noindex ; sitemap XML des URLs canoniques publiées et indexables. Sitemap vide en dev/preview ou tant que le site n’est pas prêt. |
| Identité locale | SportsClub `origine/#club` relié aux WebPage ; seulement nom, logo, adresse, téléphone/email et profils visibles. Aucun horaire précis déduit du texte libre, aucune note, aucun avis ni GPS inventé. |
| Images | Originaux conservés, priorité haute/eager du hero, lazy sous le bandeau, dimensions des logos, alternatives dérivées des libellés. Sur Vercel : srcset/sizes, tailles bornées et WebP via l’optimiseur du bucket du club ; repli original après hydratation en cas d’échec. |
| Actualisation / isolation | Une lecture jointe par requête, aucun état mutable de tenant partagé ; modifications et suspensions prises en compte à la prochaine navigation/requête, sans webhook. |
| Configuration | Contrat additif version 1, copies BO/vitrine synchronisées. Aucun nouveau champ obligatoire, aucun JSON-LD à saisir et aucune migration. |

### Résultats obtenus

- `npm ci` à la racine et dans `web/` exécutés. Seule dépendance ajoutée : `@types/node` dans
  `web/`. Les `.env.local` correspondants ont été repris en développement, valeurs non
  affichées et fichiers ignorés par Git.
- Build BO **réussi**. Build web client + serveur + sortie Vercel **réussi**.
- `npm --prefix web test` : **26 tests réussis**, dont cinq routes, titres/descriptions distincts,
  sitemap, previews, domaines personnalisés/alias, erreurs DB, configs vides, retrait de pages,
  tarifs incomplets, échappement HTML/JSON, validation des options BO, images et copies du contrat.
- **20 requêtes concurrentes** alternant deux clubs et deux routes : identité, canonical,
  JSON-LD et bootstrap isolés. Mutation de fixture représentant une sauvegarde BO, puis
  suspension : changement puis retrait dès la requête suivante. **Aucune mutation Supabase**.
- `npm --prefix web run check:build` : fonction Node empaquetée réellement chargée et exécutée,
  template privé, assets présents, réponses HTML/HEAD/404, robots/sitemap et noindex vérifiés
  avec fixtures locales. L’artefact ne contient aucun `static/index.html` de repli.
- `npm --prefix web run check:http -- http://127.0.0.1:PORT` : requêtes HTTP réelles sans JS
  sur le serveur du build, HEAD/POST et hôte inconnu ; lecture anon des deux clubs existants
  **`cac-tennis` et `test-club`**, HTML et bootstrap distincts. Le contrôle Host utilise
  `node:http` explicitement, car `fetch` normalise cet en-tête dans l’environnement utilisé.
- Navigateur : rendu du Club vérifié visuellement, navigation avec changement du titre,
  ouverture du drawer Contact fonctionnelle, **aucune erreur/warning relevé** lors de ce
  parcours. Mode dev SSR vérifié également, `/club/` redirige vers `/club` sans désaccord
  d’hydratation.
- ESLint ciblé sur les fichiers modifiés et nouveaux **réussi**, ainsi que `git diff --check`.
  Un contrôle élargi a retrouvé la règle Fast Refresh déjà présente dans le fichier inchangé
  `ContactDrawerContext.tsx` ; le lint complet historique du dépôt n’est pas déclaré propre.

État des routes avec la configuration dev **au moment du contrôle** :

| Route | Statut | Résultat |
|---|---|---|
| `/` | 200 | « CAC Tennis Club à Castelsarrasin » ; texte du hero dans le HTML. |
| `/club` | 200 | « Le club à Castelsarrasin \| CAC Tennis Club » ; contenu réel actualisé. |
| `/infrastructures` | 200 | Titre propre, catégories de courts et H1 présents. |
| `/tarifs` | 404 | Page encore vide, retirée des liens et du sitemap. |
| `/contact` | 200 | Titre et H1 propres, coordonnées/horaires actuellement saisis. |
| `/inconnue`, `/index.html` | 404 | Aucune substitution par l’accueil. |
| `/robots.txt` | 200 text/plain | Explorable ; aucun sitemap de preview annoncé. |
| `/sitemap.xml` | 200 application/xml | Vide en développement. |

Toutes les réponses documentaires locales contrôlées portent `noindex` et `no-store`.
Le Contact n’a pas encore d’adresse structurée complète et de téléphone/email au moment de
ce relevé : la rue figure dans un texte d’identité libre, et **n’est pas extraite/inventée**
par le code. Les nouveaux textes du Club remplacent déjà le « Coucou » de l’audit initial,
suite à la saisie de l’utilisateur, sans intervention de cette tâche.

### Prérequis et limites avant déploiement

1. **Aucun merge, push ou déploiement effectué.** Projet Vercel séparé, Root Directory `web/`,
   preset **Other**, Node **22.x**, build `npm run build`, installer avec `npm ci`. Retirer
   l’override de sortie `dist` et le rewrite SPA précédent : Vercel doit utiliser
   `.vercel/output` (Build Output API). Procédure détaillée : `docs/specs/WEB_SITE.md` §9.
2. Variables build VITE par environnement, et variables système `VERCEL_ENV`, `VERCEL_URL`,
   `VERCEL_BRANCH_URL` disponibles au runtime. Production reliée à Supabase prod ; previews
   reliées à dev. La migration `20260909` est confirmée appliquée en prod ; **aucune nouvelle
   migration** ni Edge Function. Aucune copie dev → prod.
3. Rattacher le domaine canonique avec HTTPS (wildcard = PR13). Ne remplir un custom domain
   qu’après vérification/provisioning. La PR ne réalise pas le DNS ni le rattachement Vercel.
4. Compléter et relire tarifs, saison, adresse structurée, téléphone/email et horaires depuis
   le BO. Le garde-fou vérifie la présence, **pas la véracité** des faits ni l’absence de texte
   de test. Les textes existants et éventuelles fautes restent à corriger par le club.
5. Valider **sur une preview Vercel**, puis sur les domaines publics autorisés : statuts,
   redirections, absence de cache HTML, noindex preview, HTML sans JS, sitemap et JSON-LD.
   Le test de bundle local ne remplace pas celui du routage réel et du CDN. L’optimiseur
   `/_vercel/image` et son quota Vercel restent à contrôler à ce stade ; aucun gain chiffré de
   performance n’est revendiqué. Pas de mesure Lighthouse ou Core Web Vitals terrain réalisée.
6. Une page déjà ouverte n’est pas réactualisée en temps réel ; la navigation ou le rechargement
   relit le statut et la config. Les images d’un bucket public restent publiques après une
   suspension : la suspension retire les pages, pas les objets Storage.
7. Actualités/agenda, envoi du formulaire et installation PWA restent dans leurs PR dédiées.
   Après publication : Search Console/Bing, fiche locale et cohérence des coordonnées externes,
   réponses factuelles aux questions des visiteurs. Aucun engagement de classement ou citation IA,
   aucun fichier `llms.txt` ajouté.

### Correctif d’affichage initial — 9 septembre 2026

Le HTML SSR pouvait apparaître sans styles en développement : `main.tsx` importait la
feuille CSS, injectée seulement à l’exécution du JavaScript. `index.html` contient désormais
un lien CSS dans le head, que Vite transforme en asset en production. Les tokens de marque
SSR utilisent `html:root` afin de primer sur les valeurs de repli même après déplacement
du lien CSS par le build.

Validation : le contrôle du head échouait sur les cinq routes avant correction ; les
26 tests passent ensuite, ainsi que le build et le contrôle du bundle Vercel empaqueté.
Le contrôle HTTP du serveur dev vérifie le lien initial, la réponse CSS 200 et son type
`text/css` sur les cinq pages. Aucun contrôle visuel supplémentaire : le service navigateur
était indisponible pendant ce correctif. Aucun déploiement effectué.
