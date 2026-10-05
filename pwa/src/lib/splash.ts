// Splash de démarrage : l'écran `#splash` est posé par `index.html` avant React, aux couleurs
// lues dans le cache ci-dessous (la marque n'arrive qu'après l'appel `club_public_brand`).
// ⚠️ Même clé que le script inline de `index.html`. localStorage est par origine, donc par club.
const KEY = 'pwa-splash-brand';

export function rememberSplashBrand(brand: { color?: string; logo?: string }) {
  try {
    if (brand.color || brand.logo) {
      localStorage.setItem(KEY, JSON.stringify({ color: brand.color, logo: brand.logo }));
    } else {
      localStorage.removeItem(KEY);
    }
  } catch { /* stockage indisponible : le prochain lancement gardera le fond blanc */ }
}

export function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.dataset.hiding) return;
  splash.dataset.hiding = '1';
  splash.style.opacity = '0';
  setTimeout(() => splash.remove(), 300);
}
