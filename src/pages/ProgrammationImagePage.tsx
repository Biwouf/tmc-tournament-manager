import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toJpeg } from 'html-to-image';
import * as pdfjsLib from 'pdfjs-dist';
import PDFWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFWorkerUrl;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Match {
  date: string;
  heure: string;
  type_tournoi: string;
  j1_prenom: string;
  j1_nom: string;
  j1_classement: string;
  j2_prenom: string;
  j2_nom: string;
  j2_classement: string;
}

// ---------------------------------------------------------------------------
// Données de test
// ---------------------------------------------------------------------------

const FAKE_CSV = `date,heure,type_tournoi,j1_prenom,j1_nom,j1_classement,j2_prenom,j2_nom,j2_classement
2026-05-30,09:00,Hommes 3ème série,Jean,Dupont,15/4,Pierre,Martin,15/2
2026-05-30,09:00,Femmes 30/3 15/2,Marie,Leblanc,30,Sophie,Durand,30/1
2026-05-30,10:30,Hommes 34ème série,Thomas,Leroy,30/5,Lucas,Petit,30/4
2026-05-30,10:30,Femmes 30/3 15/2,Camille,Bernard,15/2,Julie,Robert,15/3
2026-05-30,12:00,Hommes 4ème série,Antoine,Simon,NC,Maxime,Laurent,30/5
2026-05-30,14:00,Hommes 4ème séire,Quentin, Le Bras,15/2,Maxime, Tresal-Mauroz,15/2
2026-05-30,15:30,Femmes 30/3 15/2,Léa,Moreau,30/3,Emma,Garnier,30/2
2026-05-30,17:00,Hommes 4ème série,Nicolas,Fontaine,30/1,Hugo,Blanc,30/1`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCSV(text: string): Match[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const [date, heure, type_tournoi, j1_prenom, j1_nom, j1_classement, j2_prenom, j2_nom, j2_classement] =
      line.split(',').map(s => s.trim());
    return { date, heure, type_tournoi, j1_prenom, j1_nom, j1_classement, j2_prenom, j2_nom, j2_classement };
  });
}

// ---------------------------------------------------------------------------
// PDF parsing
// ---------------------------------------------------------------------------

type PdfItem = { x: number; y: number; str: string };

// Retire les diacritiques pour les comparaisons
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseDateFromText(text: string): string {
  const normalized = stripAccents(text).toUpperCase();
  const m = normalized.match(
    /(\d{1,2})\s+(JANVIER|FEVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOUT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE)/
  );
  if (!m) return '';
  const MONTHS: Record<string, string> = {
    JANVIER: '01', FEVRIER: '02', MARS: '03', AVRIL: '04', MAI: '05', JUIN: '06',
    JUILLET: '07', AOUT: '08', SEPTEMBRE: '09', OCTOBRE: '10', NOVEMBRE: '11', DECEMBRE: '12',
  };
  const yearMatch = text.match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : String(new Date().getFullYear());
  return `${year}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}`;
}

// Distingue un nom de joueur (contient des minuscules) d'un nom de club (tout en majuscules)
function hasMixedCase(s: string): boolean {
  return s !== s.toUpperCase();
}

function parseFullName(str: string): { nom: string; prenom: string } {
  const words = str.trim().split(/\s+/);
  // Tous les mots consécutifs tout en majuscules forment le nom (ex: "DE MARIA")
  // Le premier mot avec des minuscules marque le début du prénom
  let i = 0;
  while (i < words.length - 1 && words[i] === words[i].toUpperCase()) {
    i++;
  }
  return { nom: words.slice(0, i).join(' '), prenom: words.slice(i).join(' ') };
}

// Dans le PDF "Feuille de programmation" FFT/TEN'UP :
//  - La page est en mode paysage : les matchs sont des colonnes (distincts par X)
//  - Les types d'information sont des lignes (distincts par Y) :
//      y ≈ 60-65  → catégorie (NC-30/3), type (SM Senior), heure du match
//      y ≈ 150    → noms des joueurs + noms des clubs
//      y ≈ 323    → classements des joueurs (séparés des noms)
//  - Chaque colonne-match est ancrée par un item "N° Court"
async function parsePDF(file: File): Promise<Match[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const RANK_RE = /^(2\/6|5\/6|15\/[1-5]|15|30\/[1-5]|30|40|NC)$/;
  const TIME_RE = /^\d{1,2}:\d{2}$/;
  const Y_TOL = 12;

  const allMatches: Match[] = [];

  // Chaque page est traitée indépendamment : les coordonnées X se répètent d'une page à l'autre
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();

    const items: PdfItem[] = [];
    for (const raw of tc.items as Array<{ str: string; transform: number[] }>) {
      const str = raw.str.trim();
      if (str) items.push({ x: Math.round(raw.transform[4]), y: Math.round(raw.transform[5]), str });
    }

    // Date depuis l'en-tête (ex: "PROGRAMMATION DU VENDREDI 20 FÉVRIER 2026")
    const headerItem = items.find(it => it.str.includes('PROGRAMMATION'));
    const date = headerItem ? parseDateFromText(headerItem.str) : '';

    // Chaque "N° Court" ancre une colonne-match sur cette page
    for (const nc of items.filter(it => it.str === 'N° Court')) {
      const xMin = nc.x - 15;
      const xMax = nc.x + 50;
      const col = items.filter(it => it.x >= xMin && it.x <= xMax);

      const rankings = col
        .filter(it => Math.abs(it.y - 323) <= Y_TOL && RANK_RE.test(it.str))
        .sort((a, b) => a.x - b.x);

      const names = col
        .filter(it => Math.abs(it.y - 150) <= Y_TOL && hasMixedCase(it.str))
        .sort((a, b) => a.x - b.x);

      const metaItems = col.filter(it => it.y < 100);
      const timeItem = metaItems.find(it => TIME_RE.test(it.str));
      const nonTime = metaItems.filter(it => it !== timeItem).sort((a, b) => a.x - b.x);
      const categoryItem = nonTime[0];
      const typeItem = nonTime[1];

      if (!timeItem || names.length < 2 || rankings.length < 2) continue;

      const p1 = parseFullName(names[0].str);
      const p2 = parseFullName(names[1].str);

      allMatches.push({
        date,
        heure: timeItem.str,
        type_tournoi: [categoryItem?.str, typeItem?.str].filter(Boolean).join(' '),
        j1_prenom: p1.prenom,
        j1_nom: p1.nom,
        j1_classement: rankings[0].str,
        j2_prenom: p2.prenom,
        j2_nom: p2.nom,
        j2_classement: rankings[1].str,
      });
    }
  }

  return allMatches;
}

function formatTime(heure: string): string {
  const [h, m] = heure.split(':');
  return m === '00' || !m ? `${parseInt(h)}h` : `${parseInt(h)}h${m}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00'); // évite les décalages UTC
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${jours[date.getDay()]} ${date.getDate()} ${mois[date.getMonth()]}`;
}

// Poster A4 (794 × 1123 px) — template : /public/tmcs_pentecote.png
const W = 794;
const H = 1123;

const GRID_TOP = 305;
const GRID_LEFT = 18;
const GRID_RIGHT = 18;
const GRID_GAP = 20;

const MAX_PER_PAGE = 8; // 2 colonnes × 4 lignes

function MatchCell({ match }: { match: Match }) {
  return (
    <div
      style={{
        background: 'white',
        borderRadius: 18,
        padding: '12px 16px 16px',
        boxShadow: '5px 6px 0px rgba(200, 16, 46, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Heure + type */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            background: '#C8102E',
            color: 'white',
            borderRadius: 999,
            padding: '0 11px',
            height: 24,
            display: 'inline-block',
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: 0.2,
            whiteSpace: 'nowrap',
            lineHeight: '24px',
          }}
        >
          {formatTime(match.heure)}
        </span>
        <span style={{ color: '#C8102E', fontWeight: 700, fontSize: 15 }}>
          {match.type_tournoi}
        </span>
      </div>

      {/* Adversaires */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0, fontFamily: "'Prompt', sans-serif" }}>
          <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{match.j1_prenom}</div>
          <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{match.j1_nom}</div>
          <div style={{ color: '#C8102E', fontSize: 15, fontWeight: 700 }}>{match.j1_classement}</div>
        </div>

        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" fill="none" style={{ height: 44, width: 44, flexShrink: 0, marginTop: 4, alignSelf: 'flex-start' }}>
          <defs>
            <mask id="bolt">
              <rect width="300" height="200" fill="white"/>
              <path d="M112,8 L122,0 L134,8 L168,95 L184,80 L210,192 L216,200 L204,192 L178,108 L162,122 Z" fill="black"/>
            </mask>
          </defs>
          <text x="2" y="180" fontFamily="'Arial Black', Impact, Arial, sans-serif" fontSize="182" fontWeight="900" fontStyle="italic" fill="#C8102E" mask="url(#bolt)">VS</text>
        </svg>

        <div style={{ flex: 1, textAlign: 'center', minWidth: 0, fontFamily: "'Prompt', sans-serif" }}>
          <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{match.j2_prenom}</div>
          <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{match.j2_nom}</div>
          <div style={{ color: '#C8102E', fontSize: 15, fontWeight: 700 }}>{match.j2_classement}</div>
        </div>
      </div>
    </div>
  );
}

function PosterPage({ matches, date }: { matches: Match[]; date: string }) {
  return (
    <div
      data-page
      style={{
        position: 'relative',
        width: W,
        height: H,
        overflow: 'hidden',
        fontFamily: "'Arial', sans-serif",
        background: '#C8102E',
      }}
    >
      {/* Image template en fond */}
      <img
        src="/tmcs_pentecote.png"
        alt=""
        style={{ position: 'absolute', top: 0, left: 0, width: W, height: H, objectFit: 'cover' }}
        crossOrigin="anonymous"
      />

      {/* Date */}
      <div
        style={{
          position: 'absolute',
          top: 170,
          left: 0,
          width: W,
          textAlign: 'center',
          fontSize: 36,
          fontWeight: 700,
          color: 'white',
          letterSpacing: -0.5,
        }}
      >
        Programme du {formatDate(date)}
      </div>

      {/* Grille de cellules */}
      <div
        style={{
          position: 'absolute',
          top: GRID_TOP,
          left: GRID_LEFT,
          width: W - GRID_LEFT - GRID_RIGHT,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridAutoRows: 'auto',
          gap: GRID_GAP,
        }}
      >
        {matches.map((m, i) => (
          <MatchCell key={i} match={m} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------

export default function ProgrammationImagePage() {
  const [csvText, setCsvText] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const posterRef = useRef<HTMLDivElement>(null);

  function handleParse() {
    setMatches(parseCSV(csvText));
  }

  async function handlePDFUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsParsing(true);
    setPdfError('');
    try {
      const result = await parsePDF(file);
      if (result.length === 0) {
        setPdfError('Aucun match trouvé dans ce PDF. Vérifiez que le format correspond bien à une feuille de programmation.');
      } else {
        setMatches(result);
      }
    } catch (err) {
      setPdfError(`Erreur lors de la lecture du PDF : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsParsing(false);
      e.target.value = '';
    }
  }

  function handleLoadFake() {
    setCsvText(FAKE_CSV);
    setMatches(parseCSV(FAKE_CSV));
  }

  async function handleDownload() {
    if (!posterRef.current) return;
    setIsGenerating(true);
    const pages = posterRef.current.querySelectorAll<HTMLElement>('[data-page]');
    for (let i = 0; i < pages.length; i++) {
      const dataUrl = await toJpeg(pages[i], { quality: 0.92, pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = pages.length === 1 ? 'programmation.jpg' : `programmation-page-${i + 1}.jpg`;
      link.href = dataUrl;
      link.click();
    }
    setIsGenerating(false);
  }

  const date = matches[0]?.date ?? '';

  // Découpage en pages de MAX_PER_PAGE matches
  const pages: Match[][] = [];
  for (let i = 0; i < matches.length; i += MAX_PER_PAGE) {
    pages.push(matches.slice(i, i + MAX_PER_PAGE));
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto px-4 py-8">
          <Link
            to="/"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            ← Accueil
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Affiche programmation</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Import PDF */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">Import PDF</h2>
          <p className="text-xs text-muted-foreground">
            Feuille de programmation exportée depuis Ten'Up / FFT.
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <span className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
              {isParsing ? 'Lecture…' : 'Choisir un PDF'}
            </span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              disabled={isParsing}
              onChange={handlePDFUpload}
            />
            <span className="text-sm text-muted-foreground">ou glisser-déposer</span>
          </label>
          {pdfError && <p className="text-sm text-destructive">{pdfError}</p>}
        </div>

        {/* Saisie CSV */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Données CSV</h2>
            <button
              onClick={handleLoadFake}
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              Charger des données de test
            </button>
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            Format attendu : date,heure,type_tournoi,j1_prenom,j1_nom,j1_classement,j2_prenom,j2_nom,j2_classement
          </p>
          <textarea
            className="w-full rounded-lg border border-border bg-background p-3 text-sm font-mono h-36 resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Colle ton CSV ici ou utilise les données de test…"
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
          />
          <div className="flex gap-3">
            <button
              onClick={handleParse}
              disabled={!csvText.trim()}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
            >
              Générer l'aperçu
            </button>
            {matches.length > 0 && (
              <button
                onClick={handleDownload}
                disabled={isGenerating}
                className="rounded-lg border border-border px-5 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-40"
              >
                {isGenerating ? 'Génération…' : `Télécharger${pages.length > 1 ? ` (${pages.length} pages)` : ''}`}
              </button>
            )}
          </div>
        </div>

        {/* Aperçu */}
        {matches.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">
              Aperçu — {matches.length} match{matches.length > 1 ? 's' : ''} · {pages.length} page{pages.length > 1 ? 's' : ''}
            </h2>
            <div ref={posterRef} className="space-y-6">
              {pages.map((pageMatches, i) => (
                <div key={i} className="shadow-xl rounded-sm overflow-hidden" style={{ width: W }}>
                  <PosterPage matches={pageMatches} date={date} />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
