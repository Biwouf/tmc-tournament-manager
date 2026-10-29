import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => vite.close());
const { brandTokens } = await vite.ssrLoadModule('/src/lib/tokens.ts');

// Contraste recalculé ici depuis les chaînes CSS produites, sans réutiliser le module testé.
function rgb(value) {
  const match = /^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)$/.exec(value);
  assert.ok(match, `couleur hsl attendue, reçu ${value}`);
  const [h, s, l] = match.slice(1).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
function luminance(channels) {
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const BG = hex('#f7f2ec');
const WHITE = 'hsl(0.0 0.0% 100.0%)';

for (const color of ['#e51828', '#e8c547', '#1d3f8f', '#3a9a5c', '#3a905c', '#ffffff', '#000000']) {
  test(`${color} : texte de marque lisible à 4,5:1`, () => {
    const tokens = brandTokens(color);
    assert.ok(ratio(rgb(tokens['--brand-foreground']), rgb(tokens['--brand-fill'])) >= 4.5);
    assert.ok(ratio(rgb(tokens['--brand-text']), BG) >= 4.5);
  });
}

test('CAC : les tokens historiques et le fond des boutons ne changent pas', () => {
  const tokens = brandTokens('#e51828');
  // Valeurs produites avant l'ajout des tokens de contraste.
  assert.equal(tokens['--brand'], 'hsl(355.3 81.0% 49.6%)');
  assert.equal(tokens['--brand-dark'], 'hsl(355.3 81.0% 41.7%)');
  assert.equal(tokens['--brand-soft'], 'hsl(355.3 81.0% 49.6% / 0.1)');
  assert.equal(tokens['--brand-fill'], tokens['--brand']);
  assert.equal(tokens['--brand-foreground'], WHITE);
});

test('couleur claire : encre sur la couleur du club, telle quelle', () => {
  const tokens = brandTokens('#e8c547');
  assert.equal(tokens['--brand-fill'], tokens['--brand']);
  assert.notEqual(tokens['--brand-foreground'], WHITE);
});

test('couleur sombre : blanc sur la couleur du club, telle quelle', () => {
  const tokens = brandTokens('#1d3f8f');
  assert.equal(tokens['--brand-fill'], tokens['--brand']);
  assert.equal(tokens['--brand-foreground'], WHITE);
  assert.equal(tokens['--brand-text'], tokens['--brand']);
});

// `#3a9a5c` (exemple du brief) atteint tout juste 4,5:1 avec l'encre : il garde son fond.
test('vert du brief : encre à 4,5:1, fond conservé', () => {
  const tokens = brandTokens('#3a9a5c');
  assert.equal(tokens['--brand-fill'], tokens['--brand']);
  assert.notEqual(tokens['--brand-foreground'], WHITE);
});

test('couleur moyenne (ni blanc ni encre à 4,5:1) : fond assombri pour que le blanc passe', () => {
  const tokens = brandTokens('#3a905c');
  assert.notEqual(tokens['--brand-fill'], tokens['--brand']);
  assert.equal(tokens['--brand-foreground'], WHITE);
});

test('couleur absente ou illisible : repli sur le rouge du brief', () => {
  assert.deepEqual(brandTokens(undefined), brandTokens('#e51828'));
  assert.deepEqual(brandTokens('rouge'), brandTokens('#e51828'));
});
