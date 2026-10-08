import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toJpeg } from 'html-to-image';
import * as pdfjsLib from 'pdfjs-dist';
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { supabase } from '../lib/supabase';
import { useClub } from '../contexts/ClubContext';
import { useClubConfig } from '../hooks/useClubConfig';
import PosterBackgroundPicker, { PosterBackgroundEmpty } from '../components/PosterBackgroundPicker';
import type { ClubEvent } from '../types';

// Worker fourni en tant qu'instance (workerPort) : Vite le bundle correctement
// et pdfjs n'a pas à le charger via un import dynamique d'URL (échec en dev).
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfjsWorker();

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
  j1_club: string;
  j2_prenom: string;
  j2_nom: string;
  j2_classement: string;
  j2_club: string;
  wo: boolean;
  // Résultat lu dans le PDF (zone « Score » + coupe sur la ligne du vainqueur). Vides pour un
  // match pas encore joué et pour tout import CSV.
  score: string;
  winner: 1 | 2 | null;
}

// ---------------------------------------------------------------------------
// Données de test
// ---------------------------------------------------------------------------

const TODAY = new Date().toISOString().split('T')[0];

const FAKE_CSV = `date,heure,type_tournoi,j1_prenom,j1_nom,j1_classement,j2_prenom,j2_nom,j2_classement
${TODAY},09:00,Hommes 3ème série,Jean,Dupont,15/4,Pierre,Martin,15/2
${TODAY},09:00,Femmes 30/3 15/2,Marie,Leblanc,30,Sophie,Durand,30/1
${TODAY},10:30,Hommes 34ème série,Thomas,Leroy,30/5,Lucas,Petit,30/4
${TODAY},10:30,Femmes 30/3 15/2,Camille,Bernard,15/2,Julie,Robert,15/3
${TODAY},12:00,Hommes 4ème série,Antoine,Simon,NC,Maxime,Laurent,30/5
${TODAY},14:00,Hommes 4ème séire,Quentin, Le Bras,15/2,Maxime, Tresal-Mauroz,15/2
${TODAY},15:30,Femmes 30/3 15/2,Léa,Moreau,30/3,Emma,Garnier,30/2
${TODAY},17:00,Hommes 4ème série,Nicolas,Fontaine,30/1,Hugo,Blanc,30/1`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Colonne `wo` CSV (optionnelle). Accepte WO / wo / 1 / true / oui (insensible à
// la casse). Tout le reste, y compris colonne absente, vaut false.
function parseWoCell(s: string | undefined): boolean {
  if (!s) return false;
  const v = s.trim().toLowerCase();
  return v === 'wo' || v === '1' || v === 'true' || v === 'oui';
}

function parseCSV(text: string): Match[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const [date, heure, type_tournoi, j1_prenom, j1_nom, j1_classement, j2_prenom, j2_nom, j2_classement, wo] =
      line.split(',').map(s => s.trim());
    return { date, heure, type_tournoi, j1_prenom, j1_nom, j1_classement, j1_club: '', j2_prenom, j2_nom, j2_classement, j2_club: '', wo: parseWoCell(wo), score: '', winner: null };
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
type Matrix = [number, number, number, number, number, number];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

// Ten'Up dessine une petite coupe (image ≈ 10 × 9) sur la ligne du vainqueur de chaque match
// joué. On rejoue la pile de transformations pour obtenir le centre de chaque image dans le
// même repère que le texte. Le logo d'en-tête, bien plus grand, est écarté par la taille.
async function findCupCenters(page: pdfjsLib.PDFPageProxy): Promise<{ x: number; y: number }[]> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const cups: { x: number; y: number }[] = [];
  fnArray.forEach((fn, i) => {
    if (fn === pdfjsLib.OPS.save) stack.push(ctm);
    else if (fn === pdfjsLib.OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === pdfjsLib.OPS.transform) ctm = multiply(ctm, argsArray[i] as Matrix);
    else if (fn === pdfjsLib.OPS.paintImageXObject) {
      const w = Math.hypot(ctm[0], ctm[1]);
      const h = Math.hypot(ctm[2], ctm[3]);
      if (w < 20 && h < 20) {
        cups.push({ x: ctm[4] + (ctm[0] + ctm[2]) / 2, y: ctm[5] + (ctm[1] + ctm[3]) / 2 });
      }
    }
  });
  return cups;
}

async function parsePDF(file: File): Promise<Match[]> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const RANK_RE = /^(2\/6|5\/6|15\/[1-5]|15|30\/[1-5]|30|40|NC)$/;
  const TIME_RE = /^\d{1,2}:\d{2}$/;
  const SCORE_RE = /^\d{1,2}\/\d{1,2}( \d{1,2}\/\d{1,2})*$/;
  const Y_TOL = 12;

  const allMatches: Match[] = [];

  // Chaque page est traitée indépendamment : les coordonnées X se répètent d'une page à l'autre
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const cups = await findCupCenters(page);

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

      // Un bloc valide a au moins un joueur identifié. Les blocs "Places X/Y"
      // n'ont aucun nom à y≈150 → ignorés.
      if (!timeItem || names.length === 0) continue;

      // Walkover : le token "WO" remplace les "... / ..." dans la zone score
      // (y≈668 sur les PDF observés). On scanne toute la colonne — "WO"
      // n'apparaît jamais ailleurs.
      const wo = col.some(it => it.str.trim().toUpperCase() === 'WO');

      // Dans la colonne-match, j1 ≈ nc.x − 6 et j2 ≈ nc.x + 24 (même bande Y).
      const slotSplit = nc.x + 9;

      const j1NameItem = names.find(it => it.x < slotSplit) ?? null;
      const j2NameItem = names.find(it => it.x >= slotSplit) ?? null;
      const bothPlayers = !!j1NameItem && !!j2NameItem;

      // Résultat : score (un seul token, ex. "3/6 6/0 10/8", y≈648–670, au-delà de "N° Court")
      // noté du point de vue du vainqueur, et coupe (y≈619) sur la ligne du vainqueur, de
      // part et d'autre de slotSplit comme les noms. Un match non joué n'a ni l'un ni l'autre.
      const score = col
        .map(it => it.str.replace(/\s+/g, ' '))
        .find((str, i) => col[i].y > nc.y && SCORE_RE.test(str)) ?? '';
      const cup = cups.find(c => c.x >= xMin && c.x <= xMax && c.y > nc.y);
      const winner: 1 | 2 | null = bothPlayers && cup ? (cup.x < slotSplit ? 1 : 2) : null;

      // Clubs : items en majuscules à y≈150. Peuvent être éclatés en plusieurs
      // tokens (noms longs) → on concatène.
      const clubTokens = col
        .filter(it => Math.abs(it.y - 150) <= Y_TOL && !hasMixedCase(it.str))
        .sort((a, b) => a.x - b.x);

      // Frontière X entre les deux joueurs (nom de j2). Avec un seul joueur,
      // classement et club lui reviennent intégralement.
      const splitX = j2NameItem?.x ?? 0;
      const buildSide = (nameItem: PdfItem | null, isJ1: boolean) => {
        if (!nameItem) return { prenom: '', nom: '', classement: '', club: '' };
        const { nom, prenom } = parseFullName(nameItem.str);
        const inSlot = (it: PdfItem) =>
          !bothPlayers || (isJ1 ? it.x < splitX : it.x >= splitX);
        return {
          prenom,
          nom,
          classement: rankings.find(inSlot)?.str ?? '',
          club: clubTokens.filter(inSlot).map(it => it.str).join(' '),
        };
      };

      let j1 = buildSide(j1NameItem, true);
      let j2 = buildSide(j2NameItem, false);

      // Normalisation : le joueur connu est toujours en position j1.
      if (!j1.nom && j2.nom) [j1, j2] = [j2, j1];

      allMatches.push({
        date,
        heure: timeItem.str,
        type_tournoi: [categoryItem?.str, typeItem?.str].filter(Boolean).join(' '),
        j1_prenom: j1.prenom,
        j1_nom: j1.nom,
        j1_classement: j1.classement,
        j1_club: j1.club,
        j2_prenom: j2.prenom,
        j2_nom: j2.nom,
        j2_classement: j2.classement,
        j2_club: j2.club,
        wo,
        score,
        winner,
      });
    }
  }

  return allMatches;
}

// Affiche de résultats : le vainqueur passe à gauche, le score (noté de son point de vue) se
// lit alors naturellement de gauche à droite.
function winnerFirst(m: Match): Match {
  if (m.winner !== 2) return m;
  return {
    ...m,
    j1_prenom: m.j2_prenom, j1_nom: m.j2_nom, j1_classement: m.j2_classement, j1_club: m.j2_club,
    j2_prenom: m.j1_prenom, j2_nom: m.j1_nom, j2_classement: m.j1_classement, j2_club: m.j1_club,
    winner: 1,
  };
}

type PosterMode = 'programmation' | 'resultats';

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

// Poster A4 (794 × 1123 px). Le fond est celui du club — `config.posters.tmc_background`
// (PR7) —, et non plus un chemin figé aux couleurs de CAC. Sans fond configuré, l'affiche se génère
// sur son aplat uni : c'est le cas NOMINAL d'un club qui n'a rien uploadé.
const W = 794;
const H = 1123;

const GRID_TOP = 255;
const GRID_LEFT = 18;
const GRID_RIGHT = 18;
const GRID_GAP = 20;

const MAX_PER_PAGE = 8; // 2 colonnes × 4 lignes

// Tournoi féminin : simple/double dames (« SD », « DD ») ou libellé CSV « Femmes » / « Dames ».
// Le double mixte et tout le reste retombent sur le masculin.
const FEMININE_RE = /\b(SD|DD|dames?|femmes?|f[ée]minin\w*)\b/i;

// Le bandeau partenaires des fonds commence vers y ≈ 1000 et la grille standard finit à 923 :
// ~75 px pour 4 rangées. Le cartouche se pose donc en pied, dans le padding bas de la cellule
// (+14 px : ~10 px d'air entre lui et le fond rosé qui déborde de 4 px), pas en tête (+31 px).
const BANNER_H = 16;
const BANNER_GAP = 14;

// Cartouche bordeaux en pied de cellule quand un joueur du club mis en valeur est impliqué.
function ClubBanner({ text }: { text: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        background: '#8E0B20',
        color: 'white',
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: 2,
        textAlign: 'center',
        padding: '0 16px',
        height: BANNER_H,
        lineHeight: `${BANNER_H}px`,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {text}
    </div>
  );
}

// Affiche le club sous le classement. Style "home" (rouge, gras) quand le joueur appartient au club mis en valeur.
function ClubLabel({ club, home = false }: { club: string; home?: boolean }) {
  if (!club) return null;
  return (
    <div
      style={{
        color: home ? '#C8102E' : '#6b6b6b',
        fontSize: home ? 9.5 : 9,
        fontWeight: home ? 700 : 500,
        letterSpacing: home ? 0.3 : 0,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        marginTop: 2,
      }}
    >
      {club}
    </div>
  );
}

// Nom / prénom : une ligne chacun, tronqué par ellipse si trop long → 2 lignes max.
const NAME_LINE: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  lineHeight: 1.3,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const VS_RULE: React.CSSProperties = { flex: 1, width: 1.5, background: 'rgba(200, 16, 46, 0.25)' };

// Fond rosé derrière le bloc d'un joueur du club mis en valeur. La marge négative annule le
// padding vertical : le fond déborde sans grandir la cellule.
const HOME_PLAYER_BG: React.CSSProperties = { background: '#FCEBEB', borderRadius: 10, padding: '4px 2px', margin: '-4px 0' };

// `result` : affiche de résultats — pas d'heure, score à la place du VS, vainqueur toujours
// en j1 (cf. winnerFirst), perdant estompé.
function MatchCell({ match, highlightedClub, result }: { match: Match; highlightedClub: string | null; result: boolean }) {
  const j1Home = !!highlightedClub && match.j1_club === highlightedClub;
  const j2Home = !!highlightedClub && match.j2_club === highlightedClub;
  const bothHome = j1Home && j2Home;
  const anyHome = j1Home || j2Home;
  const bannerText = bothHome
    ? `DERBY · ${highlightedClub}`
    : FEMININE_RE.test(match.type_tournoi) ? 'JOUEUSE DU CLUB' : 'JOUEUR DU CLUB';

  return (
    <div
      style={{
        background: 'white',
        borderRadius: 18,
        boxShadow: '5px 6px 0px rgba(200, 16, 46, 0.3)',
        // Passe-partout blanc décollé de la cellule : visible sur le fond rouge de l'affiche.
        outline: anyHome ? '2px solid white' : undefined,
        outlineOffset: anyHome ? 5 : undefined,
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {anyHome && <ClubBanner text={bannerText} />}

      <div
        style={{
          padding: anyHome ? `12px 16px ${BANNER_H + BANNER_GAP}px` : '12px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minWidth: 0,
        }}
      >
        {/* Heure + type (hauteur fixe : l'en-tête reste aligné sans badge d'heure) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 24 }}>
          {!result && <span
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
          </span>}
          <span style={{ color: '#C8102E', fontWeight: 700, fontSize: 15 }}>
            {match.type_tournoi}
          </span>
        </div>

        {/* Adversaires */}
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <div style={{ flex: 1, textAlign: 'center', minWidth: 0, fontFamily: "'Prompt', sans-serif", ...(j1Home ? HOME_PLAYER_BG : {}) }}>
            <div style={NAME_LINE}>{match.j1_prenom}</div>
            <div style={NAME_LINE}>{match.j1_nom}</div>
            <div style={{ color: '#C8102E', fontSize: 15, fontWeight: 700 }}>{match.j1_classement}</div>
            <ClubLabel club={match.j1_club} home={j1Home} />
          </div>

          {/* VS ancré par un filet vertical sur toute la hauteur des blocs joueurs */}
          <div style={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div style={VS_RULE} />
            {result ? (
              <div style={{ padding: '0 8px', textAlign: 'center', color: '#C8102E', fontSize: 17, fontWeight: 800, lineHeight: 1.25, whiteSpace: 'nowrap' }}>
                {/* Set par set, les jeux de celui qui a gagné le set en rouge gras, les autres en
                    gris. Gauche = vainqueur du match (cf. winnerFirst). */}
                {match.score.split(' ').map((set, i) => {
                  const [left, right] = set.split('/');
                  const leftWon = Number(left) > Number(right);
                  const lost: React.CSSProperties = { color: '#a3a3a3', fontWeight: 600 };
                  return (
                    <div key={i}>
                      <span style={leftWon ? undefined : lost}>{left}</span>
                      <span style={lost}>/</span>
                      <span style={leftWon ? lost : undefined}>{right}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" fill="none" style={{ height: 44, width: 44, flexShrink: 0 }}>
              <defs>
                <mask id="bolt">
                  <rect width="300" height="200" fill="white"/>
                  <path d="M112,8 L122,0 L134,8 L168,95 L184,80 L210,192 L216,200 L204,192 L178,108 L162,122 Z" fill="black"/>
                </mask>
              </defs>
              <text x="2" y="180" fontFamily="'Arial Black', Impact, Arial, sans-serif" fontSize="182" fontWeight="900" fontStyle="italic" fill="#C8102E" mask="url(#bolt)">VS</text>
            </svg>
            )}
            <div style={VS_RULE} />
          </div>

          <div style={{ flex: 1, textAlign: 'center', minWidth: 0, fontFamily: "'Prompt', sans-serif", ...(j2Home ? HOME_PLAYER_BG : {}), ...(result ? { opacity: 0.5 } : {}) }}>
            {match.j2_nom === '' ? (
              <div style={{ fontSize: 20, fontWeight: 400, lineHeight: 1.3, color: '#6b6b6b' }}>
                À déterminer
              </div>
            ) : (
              <>
                <div style={NAME_LINE}>{match.j2_prenom}</div>
                <div style={NAME_LINE}>{match.j2_nom}</div>
                <div style={{ color: '#C8102E', fontSize: 15, fontWeight: 700 }}>{match.j2_classement}</div>
                <ClubLabel club={match.j2_club} home={j2Home} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PosterPage({ matches, date, highlightedClub, background, mode }: { matches: Match[]; date: string; highlightedClub: string | null; background?: string; mode: PosterMode }) {
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
      {/* Image template en fond — celle du club, ou aucune. `crossOrigin` est ce qui laisse
          `html-to-image` inliner une image servie par le Storage (autre origine) : sans lui,
          l'aperçu resterait parfait et le JPEG EXPORTÉ sortirait sans fond. */}
      {background && (
        <img
          src={background}
          alt=""
          style={{ position: 'absolute', top: 0, left: 0, width: W, height: H, objectFit: 'cover' }}
          crossOrigin="anonymous"
        />
      )}

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
        {mode === 'resultats' ? 'Résultats' : 'Programme'} du {formatDate(date)}
      </div>

      {/* Grille de cellules */}
      <div
        style={{
          position: 'absolute',
          top: GRID_TOP,
          left: GRID_LEFT,
          width: W - GRID_LEFT - GRID_RIGHT,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gridAutoRows: 'auto',
          gap: GRID_GAP,
        }}
      >
        {matches.map((m, i) => (
          <MatchCell
            key={i}
            match={m}
            highlightedClub={highlightedClub}
            result={mode === 'resultats'}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------

type TransferStatus = 'idle' | 'loading' | 'done' | 'error';

function formatEventLabel(ev: Pick<ClubEvent, 'titre' | 'date_debut'>): string {
  const d = new Date(ev.date_debut);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${ev.titre} — ${dd}/${mm}/${d.getFullYear()}`;
}

export default function ProgrammationImagePage() {
  const { clubId } = useClub();
  // Une PAGE monte le hook elle-même. `TeamMatchImagePreview`, lui, reçoit son fond en prop :
  // il est monté deux fois sur le même écran (brief §8).
  // `loading` n'est pas décoratif : le hook rend les DÉFAUTS avant sa requête, donc une liste
  // vide. Sans cette garde, « aucun fond configuré » clignoterait à chaque chargement de page.
  const { config, loading: configLoading } = useClubConfig();
  const backgrounds = config.posters.tmc_backgrounds;
  /** Le choix est propre à la génération en cours : rien n'est enregistré, le premier fond
   *  s'applique par défaut. `?? backgrounds[0]` couvre un index devenu hors bornes. */
  const [backgroundIndex, setBackgroundIndex] = useState(0);
  const background = backgrounds[backgroundIndex] ?? backgrounds[0];
  const [csvText, setCsvText] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const posterRef = useRef<HTMLDivElement>(null);

  const [events, setEvents] = useState<Pick<ClubEvent, 'id' | 'titre' | 'date_debut'>[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [transferStatus, setTransferStatus] = useState<TransferStatus>('idle');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [highlightedClub, setHighlightedClub] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [listExpanded, setListExpanded] = useState(false);
  const [mode, setMode] = useState<PosterMode>('programmation');

  const availableClubs = useMemo(() => {
    const clubs = new Set<string>();
    matches.forEach((m) => {
      if (m.j1_club) clubs.add(m.j1_club);
      if (m.j2_club) clubs.add(m.j2_club);
    });
    return [...clubs].sort();
  }, [matches]);

  // Seuls les matchs aux deux joueurs identifiés et non-WO peuvent partir vers Live Score.
  const transferableMatches = useMemo(
    () => matches.filter((m) => !m.wo && m.j2_nom !== ''),
    [matches],
  );

  // Matchs terminés : score + vainqueur lus dans le PDF. Les WO sont exclus (décision produit),
  // même si Ten'Up leur pose une coupe.
  const resultMatches = useMemo(
    () => matches.filter((m) => !m.wo && m.j2_nom !== '' && m.score && m.winner).map(winnerFirst),
    [matches],
  );

  // Matchs affichés sur l'affiche : on exclut les WO (forfait, aucun match à jouer).
  // L'état `matches` source conserve tout — ce filtrage est purement applicatif.
  const displayMatches = useMemo(
    () => (mode === 'resultats' ? resultMatches : matches.filter((m) => !m.wo)),
    [mode, matches, resultMatches],
  );

  useEffect(() => {
    supabase
      .from('events')
      .select('id, titre, date_debut')
      .eq('club_id', clubId)
      .order('date_debut', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setEvents(data);
        setEventsLoading(false);
      });
  }, [clubId]);

  // Reset le bouton de basculement, le highlight et la sélection à chaque nouvelle importation (PDF/CSV).
  // La sélection est ré-initialisée à « tout coché » sur les matchs complets.
  useEffect(() => {
    setTransferStatus('idle');
    setTransferError(null);
    setHighlightedClub(null);
    setListExpanded(false);
    setMode('programmation');
    const completeCount = matches.filter((m) => !m.wo && m.j2_nom !== '').length;
    setSelectedIndices(new Set(Array.from({ length: completeCount }, (_, i) => i)));
  }, [matches]);

  const allSelected =
    transferableMatches.length > 0 && selectedIndices.size === transferableMatches.length;
  const noneSelected = selectedIndices.size === 0;
  const someSelected = !allSelected && !noneSelected;
  const selectionLocked = transferStatus === 'loading' || transferStatus === 'done';

  function toggleMaster() {
    if (noneSelected) {
      setSelectedIndices(new Set(transferableMatches.map((_, i) => i)));
    } else {
      setSelectedIndices(new Set());
    }
  }

  function toggleOne(i: number) {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleTransfer() {
    const selected = transferableMatches.filter((_, i) => selectedIndices.has(i));
    if (selected.length === 0) return;
    setTransferStatus('loading');
    setTransferError(null);

    const payload = selected.map((m) => ({
      match_date: m.date,
      start_time: m.heure || null,
      match_type: 'simple' as const,
      j1_prenom: m.j1_prenom,
      j1_nom: m.j1_nom,
      j1_classement: m.j1_classement,
      j1_club: m.j1_club ?? '',
      j2_prenom: m.j2_prenom,
      j2_nom: m.j2_nom,
      j2_classement: m.j2_classement,
      j2_club: m.j2_club ?? '',
      j3_prenom: null,
      j3_nom: null,
      j3_classement: null,
      j3_club: null,
      j4_prenom: null,
      j4_nom: null,
      j4_classement: null,
      j4_club: null,
      event_id: selectedEventId || null,
      type_tournoi: m.type_tournoi || null,
      status: 'pending' as const,
      club_id: clubId,
    }));

    const { error } = await supabase.from('live_matches').insert(payload);
    if (error) {
      setTransferStatus('error');
      setTransferError(error.message);
      return;
    }
    setTransferStatus('done');
  }

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
    // Sans fond, on ne génère pas : une affiche sur aplat uni est un brouillon qu'on diffuse
    // par mégarde. Le bouton est déjà désactivé — cette garde tient si l'état change entre
    // le rendu et le clic.
    if (!background || !posterRef.current) return;
    setIsGenerating(true);
    const pages = posterRef.current.querySelectorAll<HTMLElement>('[data-page]');
    for (let i = 0; i < pages.length; i++) {
      const dataUrl = await toJpeg(pages[i], { quality: 0.92, pixelRatio: 2 });
      const link = document.createElement('a');
      const base = mode === 'resultats' ? 'resultats' : 'programmation';
      link.download = pages.length === 1 ? `${base}.jpg` : `${base}-page-${i + 1}.jpg`;
      link.href = dataUrl;
      link.click();
    }
    setIsGenerating(false);
  }

  const date = displayMatches[0]?.date ?? '';

  // Découpage en pages de MAX_PER_PAGE matches (basé sur les matchs affichables, WO exclus)
  const pages: Match[][] = [];
  for (let i = 0; i < displayMatches.length; i += MAX_PER_PAGE) {
    pages.push(displayMatches.slice(i, i + MAX_PER_PAGE));
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
            Format attendu : date,heure,type_tournoi,j1_prenom,j1_nom,j1_classement,j2_prenom,j2_nom,j2_classement[,wo]
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
          </div>
        </div>

        {/* Affiche programmation / résultats */}
        {matches.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold">Type d'affiche</h2>
            <div className="inline-flex rounded-lg border border-border p-1">
              {([
                ['programmation', 'Programmation'],
                ['resultats', `Résultats (${resultMatches.length})`],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  disabled={value === 'resultats' && resultMatches.length === 0}
                  className={`rounded-md px-4 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${
                    mode === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {resultMatches.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucun match terminé détecté : les résultats sont lus dans le PDF Ten'Up (score + coupe du vainqueur), WO exclus.
              </p>
            )}
          </div>
        )}

        {/* Mise en valeur d'un club */}
        {/* Pas en mode Résultats : cartouche et fond rosé brouillent la lecture vainqueur / perdant. */}
        {availableClubs.length > 0 && mode === 'programmation' && (
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold">Mettre en valeur un club</h2>
            <select
              value={highlightedClub ?? ''}
              onChange={(e) => setHighlightedClub(e.target.value || null)}
              className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Aucun</option>
              {availableClubs.map((club) => (
                <option key={club} value={club}>
                  {club}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Basculer vers Live Score */}
        {transferableMatches.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold">Envoyer vers Live Score</h2>
            <p className="text-xs text-muted-foreground">
              Crée les matchs en attente dans Live Score. Ils devront être démarrés manuellement.
            </p>

            <div>
              <label className="block text-sm font-medium text-foreground">
                Événement lié <span className="text-muted-foreground">(optionnel)</span>
              </label>
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                disabled={eventsLoading || selectionLocked}
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
              >
                <option value="">{eventsLoading ? 'Chargement…' : 'Aucun événement'}</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {formatEventLabel(ev)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    checked={allSelected}
                    disabled={selectionLocked}
                    onChange={toggleMaster}
                  />
                  Tout sélectionner ({transferableMatches.length})
                </label>
                <button
                  type="button"
                  onClick={() => setListExpanded((v) => !v)}
                  className="text-sm text-muted-foreground underline hover:text-foreground"
                >
                  {listExpanded ? 'Masquer le détail' : 'Voir le détail'}
                </button>
              </div>
              {listExpanded && (
                <ul className="rounded-lg border border-border divide-y divide-border bg-background">
                  {transferableMatches.map((m, i) => (
                    <li key={i}>
                      <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 select-none">
                        <input
                          type="checkbox"
                          checked={selectedIndices.has(i)}
                          disabled={selectionLocked}
                          onChange={() => toggleOne(i)}
                        />
                        <span className="text-sm flex-1 min-w-0">
                          <span className="font-medium">{m.heure || '—'}</span>
                          <span className="text-muted-foreground"> · {m.type_tournoi || '—'} · </span>
                          {m.j1_prenom} {m.j1_nom} vs {m.j2_prenom} {m.j2_nom}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleTransfer}
                disabled={selectionLocked || selectedIndices.size === 0}
                className={
                  transferStatus === 'done'
                    ? 'rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-100'
                    : 'rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40'
                }
              >
                {transferStatus === 'loading' && 'Envoi…'}
                {transferStatus === 'done' && `${selectedIndices.size} match(s) ajouté(s) ✓`}
                {(transferStatus === 'idle' || transferStatus === 'error') &&
                  `Basculer ${selectedIndices.size} match(s) vers Live Score`}
              </button>
              {transferStatus === 'error' && transferError && (
                <p className="text-sm text-destructive">{transferError}</p>
              )}
            </div>
          </div>
        )}

        {/* Aperçu */}
        {displayMatches.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                Aperçu — {displayMatches.length} match{displayMatches.length > 1 ? 's' : ''} · {pages.length} page{pages.length > 1 ? 's' : ''}
              </h2>
              <button
                onClick={handleDownload}
                disabled={isGenerating || !background}
                title={background ? undefined : 'Aucun fond d’affiche configuré'}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
              >
                {isGenerating ? 'Génération…' : `Télécharger${pages.length > 1 ? ` (${pages.length} images)` : ' l’image'}`}
              </button>
            </div>
            {!configLoading && !background && <PosterBackgroundEmpty poster="la programmation TMC" />}
            <PosterBackgroundPicker
              backgrounds={backgrounds}
              selectedIndex={backgroundIndex}
              onSelect={setBackgroundIndex}
            />
            <div ref={posterRef} className="space-y-6">
              {pages.map((pageMatches, i) => (
                <div key={i} className="shadow-xl rounded-sm overflow-hidden" style={{ width: W }}>
                  <PosterPage
                    matches={pageMatches}
                    date={date}
                    highlightedClub={mode === 'resultats' ? null : highlightedClub}
                    background={background?.image}
                    mode={mode}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
