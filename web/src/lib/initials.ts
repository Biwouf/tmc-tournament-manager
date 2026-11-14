// Initiales d'un nom : placeholder du bureau (PR9-bis) et du président·e (S8b-bis).
/**
 * Initiales d'un membre : première lettre des deux premiers mots du nom (maquette : rien —
 * c'est le repli demandé au brief PR9-bis §4). Chaîne vide si le nom ne donne rien, et
 * l'appelant n'affiche alors aucun carré : un carré vide serait le « trou » que la règle §10
 * de PR9 interdit.
 */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

