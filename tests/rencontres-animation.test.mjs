import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { buildRencontresTimeline, buildRencontresStoryParts, shareableStory, splitOpponent, dayParts, toAnimRencontre } from '../src/components/rencontresAnimation/timeline.ts';

let id = 0;
const r = (date, time, opponent, location = 'home', extra = {}) => ({
  id: String(++id), competitionName: 'Thénégal', gender: 'hommes', ageCategory: 'seniors', teamNumber: 1,
  opponent, location, date, time, ...extra,
});

test('Opponent names are split into town and club, as on the poster', () => {
  assert.deepEqual(splitOpponent('LAUNAGUET RACING TENNIS CLUB 1'), { name: 'LAUNAGUET', sub: 'RACING TENNIS CLUB 1' });
  assert.deepEqual(splitOpponent('TENNIS CLUB GRISOLLES 1'), { name: 'GRISOLLES', sub: 'TENNIS CLUB 1' });
  assert.deepEqual(splitOpponent('LACROIX FALGARDE T.C 1'), { name: 'LACROIX FALGARDE', sub: 'T.C 1' });
  assert.deepEqual(splitOpponent('Figeac Tennis Club'), { name: 'FIGEAC', sub: 'TENNIS CLUB' });
  assert.deepEqual(splitOpponent('TENNIS CLUB AUCAMVILLE 82 1'), { name: 'AUCAMVILLE 82', sub: 'TENNIS CLUB 1' });
  assert.deepEqual(splitOpponent('Villemur A.S Tennis 1'), { name: 'VILLEMUR', sub: 'A.S TENNIS 1' });
  assert.deepEqual(splitOpponent("VALENCE D'AGEN TENNIS CLUB 4"), { name: "VALENCE D'AGEN", sub: 'TENNIS CLUB 4' });
  assert.deepEqual(splitOpponent('  '), { name: 'À DÉTERMINER', sub: '' });
  assert.deepEqual(splitOpponent('TENNIS'), { name: 'TENNIS', sub: '' });
});

test('Dates read like the skill (1er for the first of the month)', () => {
  assert.deepEqual(dayParts('2026-11-01'), { day: 'DIMANCHE', num: '1er', month: 'NOVEMBRE', label: 'Dimanche 1er novembre' });
  assert.deepEqual(dayParts('2026-11-08'), { day: 'DIMANCHE', num: '8', month: 'NOVEMBRE', label: 'Dimanche 8 novembre' });
});

test('Card data: time, category tag, team and home/away', () => {
  const m = toAnimRencontre(r('2026-11-08', '09:00', 'MOISSAC TENNIS CLUB 1', 'away', { gender: 'femmes', ageCategory: '35_ans', teamNumber: 3 }));
  assert.deepEqual(m, { time: '9h', comp: 'Thénégal', tag: 'FEMMES · +35 ANS', team: 'ÉQUIPE 3', opp: { name: 'MOISSAC', sub: 'TENNIS CLUB 1' }, home: false });
});

test('Durations: 1 day / 1 match ≈ 11 s, 1 day / 3 matches ≈ 14 s, no recap on one screen', () => {
  const one = buildRencontresTimeline([r('2026-11-08', '09:00', 'A TC 1')]);
  assert.equal(one.total.toFixed(1), '11.4');
  assert.equal(one.recap, null);
  assert.deepEqual([one.W, one.H], [1080, 1920]);
  assert.equal(one.cards[0].CH, 400);

  const three = buildRencontresTimeline([r('2026-11-08', '09:00', 'A TC 1'), r('2026-11-08', '09:00', 'B TC 1', 'away'), r('2026-11-08', '14:00', 'C TC 1', 'away')]);
  assert.equal(three.total.toFixed(1), '14.4');
  assert.equal(three.recap, null);
  assert.deepEqual(three.cards.map((c) => c.CH), [320, 320, 320]);
  assert.equal(three.days[0].hours, '9h · 14h');
  assert.deepEqual([three.nHome, three.nAway], [1, 2]);
});

// 0,9 + 2 × (2,3 + 6,5) + récap 6,5 + clôture 4,7
test('2 days / 6 matches: one screen per day, recap, 30.2 s', () => {
  const sat = ['09:00', '09:00', '14:00'].map((t, i) => r('2026-11-07', t, `S${i} TC 1`, i % 2 ? 'away' : 'home'));
  const sun = ['09:00', '09:00', '09:00'].map((t, i) => r('2026-11-08', t, `D${i} TC 1`));
  const tl = buildRencontresTimeline([...sat, ...sun]);
  assert.deepEqual(tl.days.map((d) => [d.label, d.matches.length]), [['Samedi 7 novembre', 3], ['Dimanche 8 novembre', 3]]);
  assert.ok(tl.recap);
  assert.equal(tl.total.toFixed(1), '30.2');
  // balayages : changement de jour, récap, écran final
  assert.equal(tl.wipes.length, 3);
});

test('4 matches on a day split 2 + 2, 5 split 3 + 2', () => {
  const day = (n) => buildRencontresTimeline(Array.from({ length: n }, (_, i) => r('2026-11-08', '09:00', `X${i} TC 1`)));
  assert.deepEqual(day(4).cards.map((c) => c.CH), [400, 400, 400, 400]);
  assert.ok(day(4).recap);
  assert.deepEqual(day(5).cards.map((c) => c.CH), [320, 320, 320, 400, 400]);
});

test('Recap of 8 matches on 3 days stays above the bottom safe zone', () => {
  const dates = ['2026-11-06', '2026-11-07', '2026-11-07', '2026-11-07', '2026-11-08', '2026-11-08', '2026-11-08', '2026-11-08'];
  const tl = buildRencontresTimeline(dates.map((d, i) => r(d, '09:00', `X${i} TC 1`)));
  const rows = tl.recap.items.filter((it) => it.type === 'row');
  assert.equal(rows.length, 8);
  assert.ok(rows.at(-1).y + tl.recap.rowH <= 1650, `dernière ligne à ${rows.at(-1).y + tl.recap.rowH}`);
  assert.ok(tl.recap.rowH >= 80);
});

test('Facebook story: one part under 30 s, otherwise split between screens, each part a full story', () => {
  const day = (date, n) => Array.from({ length: n }, (_, i) => r(date, '09:00', `CLUB${i} TC 1`));
  const three = day('2026-11-08', 3);
  assert.deepEqual(buildRencontresStoryParts(three), [buildRencontresTimeline(three)]);

  // Un jour de 6 : 3 + 3 et un récap, 28,2 s → une seule story
  const six = day('2026-11-08', 6);
  assert.deepEqual(buildRencontresStoryParts(six), [buildRencontresTimeline(six)]);

  // Deux jours de 3 : un écran par jour et un récap, 30,2 s → une story par jour, sans récap
  const twoDays = [...day('2026-11-07', 3), ...day('2026-11-08', 3)];
  assert.ok(buildRencontresTimeline(twoDays).total > 30);
  const p6 = buildRencontresStoryParts(twoDays);
  assert.deepEqual(p6.map((tl) => [tl.cards.length, tl.recap]), [[3, null], [3, null]]);

  // Deux jours de 4 (l'affiche en compte 8 au plus) : une story par jour, chacune avec son récap
  const eight = [...day('2026-11-14', 4), ...day('2026-11-15', 4)];
  const p8 = buildRencontresStoryParts(eight);
  assert.deepEqual(p8.map((tl) => tl.days.map((d) => d.date)), [['2026-11-14'], ['2026-11-15']]);
  assert.ok(p8.every((tl) => tl.total <= 30 && tl.recap));
  assert.equal(buildRencontresStoryParts(eight, 60).length, 1);
});

test('Onboarding (W1): under 30 s the whole story is shared; above, only the first part, the full length kept to say so', () => {
  const day = (date, n) => Array.from({ length: n }, (_, i) => r(date, '09:00', `CLUB${i} TC 1`));
  const three = day('2026-11-22', 3);
  const one = shareableStory(three);
  assert.deepEqual([one.parts, one.tl, one.fullSeconds], [1, buildRencontresTimeline(three), buildRencontresTimeline(three).total]);
  const eight = [...day('2026-11-21', 4), ...day('2026-11-22', 4)];
  const first = shareableStory(eight);
  assert.equal(first.parts, 2);
  assert.deepEqual(first.tl, buildRencontresStoryParts(eight)[0]);
  assert.deepEqual(first.tl.days.map((d) => d.date), ['2026-11-21']);
  assert.ok(first.tl.total <= 30);
  assert.equal(first.fullSeconds, buildRencontresTimeline(eight).total);
});

// `encodeAnimation.ts` sans navigateur : WebCodecs, canvas et muxer simulés, rendu neutralisé.
function loadEncoder() {
  const ts = createRequire(import.meta.url)('typescript');
  const file = new URL('../src/components/programmeAnimation/encodeAnimation.ts', import.meta.url);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  const stubs = {
    'mp4-muxer': { ArrayBufferTarget: class { buffer = new ArrayBuffer(8); }, Muxer: class { constructor(o) { this.target = o.target; } addVideoChunk() {} finalize() {} } },
    './palette': { animationPalette: () => ({}) },
    './renderFrame': { renderFrame() {} },
    '../rencontresAnimation/renderFrame': { renderRencontresFrame() {} },
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)((name) => stubs[name] ?? {}, mod, mod.exports);
  return mod.exports;
}

test('Encoding bitrate: 8 Mb/s by default (/medias), 4 Mb/s when asked (onboarding share)', async () => {
  const configured = [];
  globalThis.VideoEncoder = class {
    static async isConfigSupported(config) { return { supported: config.codec === 'avc1.640032' }; }
    state = 'configured'; encodeQueueSize = 0;
    configure(config) { configured.push(config.bitrate); }
    encode() {} async flush() {} close() { this.state = 'closed'; }
  };
  globalThis.VideoFrame = class { close() {} };
  globalThis.OffscreenCanvas = class { getContext() { return {}; } };
  // Le `MessageChannel` de `yieldTask` garderait le processus ouvert : un tour de boucle suffit ici.
  const Channel = globalThis.MessageChannel;
  globalThis.MessageChannel = class { port1 = {}; port2 = { postMessage: () => setImmediate(() => this.port1.onmessage()) }; };
  try {
    const { pickEncoderConfig, encodeAnimation, DEFAULT_BITRATE, SHARE_BITRATE } = loadEncoder();
    assert.deepEqual([DEFAULT_BITRATE, SHARE_BITRATE], [8_000_000, 4_000_000]);
    assert.equal((await pickEncoderConfig(1080, 1920)).bitrate, 8_000_000);
    assert.equal((await pickEncoderConfig(1080, 1920, SHARE_BITRATE)).bitrate, 4_000_000);
    const tl = { W: 1080, H: 1920, total: 0.2 };
    await encodeAnimation({ kind: 'rencontres', tl, color: '#f26524', texts: {}, assets: {} }, () => {});
    await encodeAnimation({ kind: 'rencontres', tl, color: '#f26524', texts: {}, assets: {}, bitrate: SHARE_BITRATE }, () => {});
    assert.deepEqual(configured, [8_000_000, 4_000_000], 'the job bitrate reaches the encoder, /medias unchanged');
  } finally {
    delete globalThis.VideoEncoder; delete globalThis.VideoFrame; delete globalThis.OffscreenCanvas;
    globalThis.MessageChannel = Channel;
  }
});
