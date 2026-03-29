# Objectif
Générer une affiche d'une programmation d'un jour de tournoi.

# Fonctionnement
Pour l'affiche, il faut repartir d'un template qui est fourni au niveau du projet.
En entrée, l'app web doit permettre de fournir un CSV qui liste les matches du jour.

# Input

## Data
Tous les matches ont donc la même date.
Un match est composé de : 
- Un tournoi soit homme soit femme. En plus : 
	- Cela peut être une catégorie d'âge
	- Ou une échelle de classement
- De de deux adversaires (Prénom et Nom). Chaque adversaire a : 
	- Un classement
	- Un club
- Un horaire

### Mapping
À faire. Je n'ai pas encore la structure de la donnée disponible.
Pour tester, on peut essayer avec un export CSV de la partie "génération planning" en sachant qu'il n'y a aucune information sur les adversaires.

# Output

## Format
Une image JPEG

## Logique
Reprendre l'image, au format A4, disponible dans la projet. C'est la structure fixe évitée plus haut.
La structure fixe a :
- Un header (logo(s))
- Un footer (les sponsors)
Au milieu il faut insérer autant de cellules que de matches programmés.

Dans le header, il faut mettre la date du jour qui correspond aux matches.
Format de la date : jour complet (jj dans template) + numéro jour (nn dans template) + mois (mm dans template). Soit par exemple "samedi 28 mars".

### Composition cellule
Le template fournit une cellule.
Une cellule est composée de : 
- Heure
	- Format : hh + "h" + mm
	- Soit par exemple "10h30"
	- Si l'heure n'a pas de minutes associés, ne mettre que l'heure. Soit par exemple => "9h".
- Type de tournoi (catégorie âge, échelle classement, etc.)
	- Type tournoi dans le template
- Adversaires : 
	- Prénom et nom
	- Classements


### Gestion
Il est possible que toutes les cellules à créer ne rentrent pas sur une seule feuille A4.
Plus de 8 cellules par feuille semble compliqué.
Le cas écéhant, plusieurs possibilités : 
- Faire une feuille par type de tournoi
- Faire une feuille par moment de la journée (matin, après midi, soir)
Un petit algo est à prévoir à mon avis.
