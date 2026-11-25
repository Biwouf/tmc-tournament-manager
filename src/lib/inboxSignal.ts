// PR-BO2 — « une action vient de changer ce qui est à traiter » : appelé après une écriture, il fait
// relire `admin_inbox` par `AdminInboxProvider` (compteurs de la barre, accueil). Sans React ni DOM :
// importable par les helpers d'écriture.
const listeners = new Set<() => void>();

export function notifyInboxChanged(): void {
  listeners.forEach((listener) => listener());
}

export function onInboxChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
