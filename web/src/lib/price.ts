/**
 * Montant du contrat (`pricing.lessons[].price`, `pricing.membership[].price`) → texte affiché.
 *
 * Le contrat porte un NOMBRE et laisse la mise en forme à la vitrine ; il omet la clé quand le
 * tarif n'est pas renseigné (absent ≠ gratuit). D'où le `null` : pas de prix, pas de ligne.
 * Aucune période n'est ajoutée (« / an »…) — le contrat n'en porte pas, l'inventer serait
 * supposer le modèle tarifaire d'un club.
 */
export function formatPrice(price: number | undefined): string | null {
  if (price === undefined) return null;
  // Un entier reste sans décimales (« 210 € ») ; un montant qui en a les garde toutes
  // (« 295,50 € » et non « 295,5 € »).
  const decimals = Number.isInteger(price) ? 0 : 2;
  const amount = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(price);
  return `${amount} €`;
}
