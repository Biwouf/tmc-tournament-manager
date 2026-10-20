// Génère pwa/src/lib/emojiData.json (sélecteur d'emojis du live) depuis emojibase-data.
// Usage : npm pack emojibase-data@18.0.0 && tar xzf emojibase-data-18.0.0.tgz
//         node pwa/scripts/build-emoji-data.mjs <dossier package/ extrait>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Emoji 15.0 : affichés par iOS 16.4+ et Android 14+ ; les plus récents s'afficheraient
// en morceaux sur une bonne partie des téléphones.
const MAX_VERSION = 15;
// Onglets dans l'ordre du clavier WhatsApp ; groupes emojibase (2 = composants, exclus).
const TABS = [
  { name: 'Émoticônes et personnes', icon: '😀', groups: [0, 1] },
  { name: 'Animaux et nature', icon: '🐻', groups: [3] },
  { name: 'Nourriture et boissons', icon: '🍔', groups: [4] },
  { name: 'Activités', icon: '⚽', groups: [6] },
  { name: 'Voyages et lieux', icon: '🚗', groups: [5] },
  { name: 'Objets', icon: '💡', groups: [7] },
  { name: 'Symboles', icon: '🔣', groups: [8] },
  { name: 'Drapeaux', icon: '🏳️', groups: [9] },
];

const dir = process.argv[2];
if (!dir) throw new Error('Chemin du paquet emojibase-data attendu.');
const data = JSON.parse(readFileSync(resolve(dir, 'fr/data.json'), 'utf8'));
// Recherche insensible à la casse, aux accents et aux ligatures (« coeur »), comme
// `searchKey` côté client.
const key = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/’/g, "'");

const tabs = TABS.map(({ name, icon, groups }) => ({
  name,
  icon,
  emojis: data
    .filter((e) => groups.includes(e.group) && e.version <= MAX_VERSION)
    .sort((a, b) => a.order - b.order)
    .map((e) => [e.emoji, e.label, key([e.label, ...(e.tags ?? [])].join(' '))]),
}));
const out = new URL('../src/lib/emojiData.json', import.meta.url);
writeFileSync(out, JSON.stringify(tabs));
console.log(tabs.map((t) => `${t.icon} ${t.emojis.length}`).join('  '));
