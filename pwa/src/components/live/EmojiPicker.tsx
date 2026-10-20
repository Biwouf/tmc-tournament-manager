import { memo, useEffect, useMemo, useRef, useState } from 'react';
import tabs from '../../lib/emojiData.json';

type Emojis = (typeof tabs)[number]['emojis'];
// Même normalisation que pwa/scripts/build-emoji-data.mjs : sans casse, accents ni
// ligatures ; apostrophe typographique du clavier iOS ramenée à la droite.
const searchKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/’/g, "'")
    .trim();

// Mémoïsée : changer d'onglet actif en défilant ne recalcule pas ~1 900 boutons.
const EmojiGrid = memo(function EmojiGrid({
  emojis,
  selected,
  onPick,
}: {
  emojis: Emojis;
  selected: string | null;
  onPick: (emoji: string) => void;
}) {
  return (
    <div className="emoji-grid">
      {emojis.map(([emoji, label]) => (
        <button
          key={emoji}
          aria-label={label}
          aria-pressed={selected === emoji}
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
});

/**
 * Tous les emojis par catégorie, comme le clavier de WhatsApp, avec recherche en français.
 * Données embarquées (`emojiData.json`), chargées avec ce composant à l'ouverture.
 */
export default function EmojiPicker({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (emoji: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Première catégorie seule à l'ouverture, les autres juste après le premier affichage.
  const [shown, setShown] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const search = searchKey(query);
  // Chaque mot saisi doit commencer un mot du libellé ou des mots-clés.
  const results = useMemo(() => {
    if (!search) return null;
    const words = search.split(/\s+/);
    return tabs.flatMap((t) =>
      t.emojis.filter(([, , key]) =>
        words.every((w) => ` ${key}`.includes(` ${w}`)),
      ),
    );
  }, [search]);
  useEffect(() => {
    const showAll = () => setShown(tabs.length);
    let timer: ReturnType<typeof setTimeout>;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(showAll);
    });
    // Secours si le navigateur suspend les images (vue masquée).
    const fallback = setTimeout(showAll, 250);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      clearTimeout(fallback);
    };
  }, []);
  const grid = (emojis: Emojis) => (
    <EmojiGrid emojis={emojis} selected={selected} onPick={onPick} />
  );
  return (
    <div className="emoji-picker">
      <input
        type="search"
        className="emoji-search"
        aria-label="Rechercher un emoji"
        placeholder="Rechercher"
        enterKeyHint="search"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // Résultats, ou retour à la grille, toujours depuis le haut.
          if (scroller.current) scroller.current.scrollTop = 0;
          setActive(0);
        }}
      />
      <div
        ref={scroller}
        className="emoji-scroll"
        onScroll={(e) => {
          if (results) return;
          // Onglet actif : dernière catégorie dont le titre a atteint le haut.
          const top = e.currentTarget.scrollTop + 8;
          let i = 0;
          sections.current.forEach((s, j) => {
            if (s && s.offsetTop <= top) i = j;
          });
          setActive(i);
        }}
      >
        {results ? (
          results.length > 0 ? (
            grid(results)
          ) : (
            <p className="emoji-empty">Aucun emoji trouvé</p>
          )
        ) : (
          tabs.slice(0, shown).map((t, i) => (
            <section
              key={t.name}
              ref={(el) => {
                sections.current[i] = el;
              }}
              aria-label={t.name}
            >
              <h3>{t.name}</h3>
              {grid(t.emojis)}
            </section>
          ))
        )}
      </div>
      {!results && (
        <nav className="emoji-tabs" aria-label="Catégories">
          {tabs.map((t, i) => (
            <button
              key={t.name}
              aria-label={t.name}
              aria-current={active === i}
              onClick={() => {
                const s = sections.current[i];
                if (s && scroller.current)
                  scroller.current.scrollTop = s.offsetTop;
                setActive(i);
              }}
            >
              {t.icon}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
