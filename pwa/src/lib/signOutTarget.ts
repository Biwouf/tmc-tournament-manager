// Destination d'une déconnexion volontaire depuis une page protégée. Hors de React : la déconnexion
// remonte tout l'arbre (SessionQueryProvider), et la page ne doit être quittée qu'une fois réussie.
let target: string | null = null;
export const leaveAfterSignOut = (path: string | null) => { target = path; };
export const signOutTarget = () => target;
