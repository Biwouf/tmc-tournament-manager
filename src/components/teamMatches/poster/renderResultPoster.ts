import type { ClubConfig } from '../../../lib/clubConfig';
import type { TeamMatchLine, TeamRencontre } from '../../../types';
import { orderedResultLines, photoCrop, posterPlayerLabel } from './resultPoster';

export interface ResultPosterInput {
  rencontre: TeamRencontre;
  lines: TeamMatchLine[];
  config: ClubConfig;
  clubName: string;
  heading: string;
  stage: string;
  result: { club: number; adverse: number };
  model: 'photo' | 'details';
  photo: string;
  crop: { x: number; y: number; zoom: number };
}

function imageUrl(value: string) {
  if (/^(https?:|data:|blob:)/.test(value)) return value;
  return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/content-images/${value.split('/').map(encodeURIComponent).join('/')}`;
}

export function loadPosterImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timeout = window.setTimeout(() => { image.src = ''; reject(new Error('Chargement de l’image trop long. Réessayez.')); }, 15000);
    image.onload = () => { clearTimeout(timeout); resolve(image); };
    image.onerror = () => { clearTimeout(timeout); reject(new Error('Une photo ou un logo ne peut pas être chargé. Vérifiez l’image et son accès public.')); };
    image.src = imageUrl(src);
  });
}

export async function renderResultPoster(input: ResultPosterInput): Promise<string> {
  const { rencontre, config, result, model, crop } = input;
  const partners = config.partners.filter(p => p.logo || p.name);
  const sources = [...partners.map(p => p.logo), config.brand.logo || '', model === 'photo' ? input.photo : ''];
  const images = await Promise.all(sources.map(src => src ? loadPosterImage(src) : null));
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Votre navigateur ne permet pas de générer cette image.');
  const ctx = context;
  const brand = /^#[\da-f]{6}$/i.test(config.brand.color || '') ? config.brand.color! : '#e51828';
  const ink = '#191919';
  const ivory = '#faf7f1';
  const footerHeight = Math.max(190, 76 + Math.ceil(partners.length / 4) * 92);
  if (footerHeight > 460) throw new Error('Trop de partenaires pour ce format (16 maximum).');
  const footerY = 1350 - footerHeight;
  ctx.fillStyle = ivory;
  ctx.fillRect(0, 0, 1080, 1350);
  function text(value: string, x: number, y: number, size: number, color = ink, maxWidth = 980, align: CanvasTextAlign = 'left', weight = 700) {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let fitted = size;
    do { ctx.font = `${weight} ${fitted}px Arial, sans-serif`; if (ctx.measureText(value).width <= maxWidth) break; fitted--; } while (fitted > 20);
    if (ctx.measureText(value).width > maxWidth) {
      while (value.length && ctx.measureText(value + '…').width > maxWidth) value = value.slice(0, -1);
      value += '…';
    }
    ctx.fillText(value, x, y);
  }
  function contain(image: HTMLImageElement, x: number, y: number, w: number, h: number) {
    const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
    const iw = image.naturalWidth * scale, ih = image.naturalHeight * scale;
    ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  function rule(y: number) { ctx.fillStyle = '#dedbd5'; ctx.fillRect(50, y, 980, 2); }
  function centeredText(value: string, x: number, y: number, size: number, color = ink, maxWidth = 980, align: CanvasTextAlign = 'left', weight = 700) {
    ctx.save();
    ctx.textBaseline = 'middle';
    text(value, x, y, size, color, maxWidth, align, weight);
    ctx.restore();
  }
  function clubLabel(value: string, x: number, y: number) {
    const words = value.toUpperCase().split(/\s+/);
    const rows: string[] = [];
    ctx.font = '700 29px Arial, sans-serif';
    let row = '';
    for (const word of words) {
      const next = row ? `${row} ${word}` : word;
      if (row && ctx.measureText(next).width > 300) { rows.push(row); row = word; }
      else row = next;
    }
    if (row) rows.push(row);
    const visible = rows.slice(0, 3);
    if (rows.length > 3) visible[2] += '…';
    visible.forEach((label, index) => centeredText(label, x, y + (index - (visible.length - 1) / 2) * 36, 29, ink, 300, 'center'));
    ctx.fillStyle = brand;
    ctx.fillRect(x - 48, y + 64, 96, 3);
  }
  // Identical, balanced header for both models: context, date/location, then club emblem.
  ctx.fillStyle = brand;
  ctx.fillRect(0, 0, 1080, 150);
  centeredText(input.heading.toUpperCase(), 50, 57, 27, '#ffffff', 520);
  centeredText(input.stage.toUpperCase(), 50, 99, 22, '#ffffff', 520, 'left', 400);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(606, 43, 1, 64);
  centeredText(new Date(rencontre.date_heure).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).toUpperCase(), 641, 57, 21, '#ffffff', 260);
  centeredText(rencontre.domicile ? 'À DOMICILE' : 'À L’EXTÉRIEUR', 641, 99, 21, '#ffffff', 260, 'left', 400);
  const logo = images[partners.length];
  if (logo) {
    ctx.save();
    ctx.beginPath(); ctx.arc(978, 75, 44, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.clip();
    contain(logo, 937, 34, 82, 82);
    ctx.restore();
  }
  const verdict = rencontre.wo ? 'FORFAIT (WO)' : result.club > result.adverse ? 'VICTOIRE' : result.club === result.adverse ? 'MATCH NUL' : 'DÉFAITE';
  const score = `${result.club} – ${result.adverse}`;
  if (model === 'photo') {
    const photo = images[partners.length + 1];
    if (!photo) throw new Error('Choisissez une photo pour ce modèle.');
    const height = footerY - 150;
    const { sx, sy, sw, sh } = photoCrop(photo.naturalWidth, photo.naturalHeight, 1080, height, crop.x, crop.y, crop.zoom);
    ctx.drawImage(photo, sx, sy, sw, sh, 0, 150, 1080, height);
    const gradient = ctx.createLinearGradient(0, footerY - 510, 0, footerY);
    gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(0.5, 'rgba(0,0,0,0.65)'); gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = gradient; ctx.fillRect(0, footerY - 510, 1080, 510);
    text(score, 540, footerY - 205, 180, '#ffffff', 900, 'center');
    text(input.clubName.toUpperCase(), 280, footerY - 137, 34, '#ffffff', 445, 'center');
    text(rencontre.club_adverse.toUpperCase(), 800, footerY - 137, 34, '#ffffff', 445, 'center');
    ctx.fillStyle = brand; ctx.fillRect(355, footerY - 95, 370, 58);
    text(verdict, 540, footerY - 54, 29, '#ffffff', 345, 'center');
  } else {
    clubLabel(input.clubName, 215, 290);
    clubLabel(rencontre.club_adverse, 865, 290);
    centeredText(score, 540, 295, 146, brand, 330, 'center');
    centeredText(verdict, 540, 388, 22, ink, 900, 'center', 400);
    const lines = orderedResultLines(input.lines);
    const hasGroups = lines.some(line => line.match_type === 'simple') && lines.some(line => line.match_type === 'double');
    const groupGap = hasGroups ? 26 : 0;
    const top = 475;
    centeredText('CLUB', 240, 440, 19, '#555555', 325, 'left', 400);
    centeredText('ADVERSAIRES', 595, 440, 19, '#555555', 325, 'left', 400);
    const units = lines.reduce((sum, line) => sum + (line.match_type === 'double' ? 1.35 : 1), 0);
    const unitHeight = Math.min(140, (footerY - 55 - top - groupGap) / Math.max(units, 1));
    const counts = { simple: 0, double: 0 };
    let y = top;
    rule(y);
    if (!lines.length || rencontre.wo) centeredText(rencontre.wo ? 'Rencontre décidée par forfait' : 'Détail des matchs non renseigné', 540, 700, 32, ink, 950, 'center', 400);
    else lines.forEach((line, index) => {
      if (index > 0 && line.match_type === 'double' && lines[index - 1].match_type === 'simple') { y += groupGap; rule(y); }
      const rowHeight = unitHeight * (line.match_type === 'double' ? 1.35 : 1);
      const center = y + rowHeight / 2;
      const number = ++counts[line.match_type];
      centeredText(`${line.match_type === 'simple' ? 'SIMPLE' : 'DOUBLE'} ${number}`, 50, center, 22, ink, 155);
      ctx.fillStyle = '#dedbd5'; ctx.fillRect(206, center - 20, 1, 40);
      const playerCount = Math.max(line.joueurs_club.length, line.joueurs_adverse.length, 1);
      const spacing = Math.min(30, rowHeight / (playerCount + 1));
      const startY = center - playerCount * spacing / 2;
      for (const [players, x] of [[line.joueurs_club, 240], [line.joueurs_adverse, 595]] as const) {
        if (!players.length) centeredText('Joueur non renseigné', x, startY, 22, ink, 325, 'left', 400);
        players.forEach((player, playerIndex) => centeredText(posterPlayerLabel(player), x, startY + playerIndex * spacing, 24, ink, 325, 'left', 400));
      }
      centeredText(line.score || 'Score non renseigné', 540, startY + playerCount * spacing, 23, ink, 690, 'center', 700);
      ctx.beginPath(); ctx.arc(993, center, 23, 0, Math.PI * 2);
      ctx.fillStyle = line.gagnant === 'club' ? brand : ink; ctx.fill();
      // Draw the status marks directly: no dependency on a platform's symbol font.
      ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      if (line.gagnant === 'club') {
        ctx.moveTo(983, center); ctx.lineTo(990, center + 7); ctx.lineTo(1003, center - 7);
      } else {
        ctx.moveTo(987, center - 6); ctx.lineTo(999, center + 6);
        ctx.moveTo(999, center - 6); ctx.lineTo(987, center + 6);
      }
      ctx.stroke(); ctx.restore();
      y += rowHeight;
      rule(y);
    });
  }

  // Export always includes configured partners, independently of the website visibility flag.
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, footerY, 1080, footerHeight);
  rule(footerY);
  text(partners.length ? 'ILS SOUTIENNENT LE CLUB' : input.clubName.toUpperCase(), 540, footerY + 48, 22, ink, 950, 'center');
  partners.forEach((partner, index) => {
    const row = Math.floor(index / 4);
    const count = Math.min(4, partners.length - row * 4);
    const width = 980 / count;
    const x = 50 + (index % 4) * width;
    const y = footerY + 72 + row * 92;
    const image = images[index];
    if (image) contain(image, x + 20, y, width - 40, 66);
    else text(partner.name || '', x + width / 2, y + 43, 26, ink, width - 40, 'center');
  });
  return canvas.toDataURL('image/png');
}
