// Header fixe en haut — logo CAC Tennis + nom de l'app
// Hauteur : 56px. Fond blanc, ombre légère.
// Le logo PNG est à placer dans pwa/public/icons/icon-192.png (ou un fichier dédié logo.png).

export default function AppHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-card border-b border-border flex items-center px-4 gap-3 shadow-sm">
      <img src="/icons/icon-192.png" alt="CAC Tennis" className="h-8 w-8 rounded-full object-cover" />
      <span className="font-bold text-lg text-foreground tracking-tight">CAC Tennis</span>
    </header>
  );
}
