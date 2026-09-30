// Isolated design preview. No Supabase imports, writes or persisted demo data.
// This entry is not part of the production application bundle.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import LiveScoreEntry from '../components/matches/LiveScoreEntry';
import type { LiveMatch } from '../types';
import { getSet, getSet3Normal, getNormalSetWinner, getMatchWinner, isSet3Needed, isNormalSetInTiebreak, incrementNormal, canIncrementNormal, setNormalIntoMatch } from '../liveScoreRules';
import { previewMatch } from './match';
import { nextReaction, type ReactionStreak } from './reactionCombo';

type Role = 'visitor' | 'spectator' | 'member';
type Panel = 'message' | 'poll' | 'login' | 'score' | 'vote' | 'details' | null;
type Post = { order: number; id: string; author: string; initials: string; time: string; score: string; text: string; own?: boolean };
type Poll = { order: number; id: string; question: string; options: string[]; counts: number[]; vote: number | null; closed: boolean; author: string };
const reactions = [['👏', 'Applaudir'], ['🔥', 'Quel match !'], ['💪', 'Encourager'], ['❤️', 'Soutenir'], ['😮', 'Incroyable'], ['🎉', 'Célébrer']];
const shortcuts = ['Quel échange ! 🔥', 'Ambiance au rendez-vous 👏', 'Petite pause ☀️'];
const initialPosts: Post[] = [
  { order: 3, id: '1', author: 'Camille R.', initials: 'CR', time: new Date(Date.now() - 60000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }), score: '6–4 · 3–2', text: 'Un échange de folie pour finir ce jeu ! Ça se bat sur tous les points 🔥' },
  { order: 1, id: '2', author: 'Alex M.', initials: 'AM', time: new Date(Date.now() - 8 * 60000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }), score: '6–4 · 2–2', text: 'Du monde au bord du court et de beaux encouragements pour les deux joueurs 👏' },
];
const initialPoll: Poll = { order: 2, id: 'initial-poll', question: 'Vous suivez le match d’où ?', options: ['Au bord du court 🎾', 'Depuis mon canapé 🛋️', 'Entre deux activités 👀'], counts: [8, 12, 4], vote: null, closed: false, author: 'Camille R.' };

function Icon({ kind }: { kind: 'message' | 'poll' | 'arrow' | 'close' | 'plus' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'message' ? <path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z" /> : kind === 'poll' ? <><path d="M5 20V10m7 10V4m7 16v-7" /></> : kind === 'arrow' ? <path d="m14 6-6 6 6 6" /> : kind === 'close' ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M12 5v14M5 12h14" />}
  </svg>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="live-sheet" aria-labelledby="sheet-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sheet-heading"><h2 id="sheet-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fermer"><Icon kind="close" /></button></div>
    {children}
  </dialog>;
}

export default function LivePreview() {
  const [role, setRole] = useState<Role>('member');
  const [finished, setFinished] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [posts, setPosts] = useState(initialPosts);
  const [polls, setPolls] = useState<Poll[]>([initialPoll]);
  const [match, setMatch] = useState(previewMatch);
  const history = useRef<LiveMatch[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [scoreVersion, setScoreVersion] = useState(0);
  const sequence = useRef(3);
  const scroll = useRef<HTMLDivElement>(null);
  const followFeed = useRef(true);
  const paletteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const palette = useRef<HTMLDivElement>(null);
  const reactionToggle = useRef<HTMLButtonElement>(null);
  const [reactionPicker, setReactionPicker] = useState(false);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const [selectedPollId, setSelectedPollId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [composer, setComposer] = useState(false);
  const [message, setMessage] = useState('');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [bursts, setBursts] = useState<{ id: string; emoji: string; combo: boolean }[]>([]);
  const streak = useRef<ReactionStreak | null>(null);
  const [notice, setNotice] = useState('');
  const member = role === 'member';
  const matchWinner = getMatchWinner(match);
  const ended = finished || !!matchWinner;
  const displayedMatch = finished ? { ...previewMatch, set2_j1: 6, set2_j2: 2 } : match;
  const sets = isSet3Needed(displayedMatch) ? [1, 2, 3] as const : [1, 2] as const;
  const currentSet = !getNormalSetWinner(getSet(match, 1)) ? 1 : !getNormalSetWinner(getSet(match, 2)) ? 2 : 3;
  const current = currentSet === 3 ? getSet3Normal(match) : getSet(match, currentSet);
  const scoreSnapshot = sets.map(n => `${displayedMatch[`set${n}_j1`] ?? 0}–${displayedMatch[`set${n}_j2`] ?? 0}`).join(' · ');
  function patchScore(patch: Partial<LiveMatch>) {
    history.current.push(match);
    setUndoCount(history.current.length);
    setMatch({ ...match, ...patch });
    setScoreVersion(v => v + 1);
  }
  function undoScore() {
    const previous = history.current.pop();
    if (!previous) return;
    setMatch(previous); setFinished(false);
    setUndoCount(history.current.length); setScoreVersion(v => v + 1);
  }
  function keepPaletteOpen() {
    if (paletteTimer.current) clearTimeout(paletteTimer.current);
    paletteTimer.current = setTimeout(() => {
      if (palette.current?.contains(document.activeElement)) reactionToggle.current?.focus();
      setReactionPicker(false);
    }, 3000);
  }
  useEffect(() => {
    if (reactionPicker) keepPaletteOpen();
    return () => { if (paletteTimer.current) clearTimeout(paletteTimer.current); };
  }, [reactionPicker]);
  useLayoutEffect(() => {
    if (followFeed.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [posts.length, polls.length, empty]);
  useLayoutEffect(() => {
    const input = messageInput.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 100)}px`; }
  }, [message]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (viewport && viewport.scale === 1) document.documentElement.style.setProperty('--live-viewport-height', `${viewport.height}px`);
    };
    resize(); viewport?.addEventListener('resize', resize);
    return () => { viewport?.removeEventListener('resize', resize); document.documentElement.style.removeProperty('--live-viewport-height'); };
  }, []);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(id); }, [notice]);
  useEffect(() => { if (!bursts.length) return; const id = setTimeout(() => setBursts([]), 2200); return () => clearTimeout(id); }, [bursts]);
  const announce = (text: string) => setNotice(text);
  function react(emoji: string) {
    if (role === 'visitor') { setPanel('login'); return; }
    if (ended || member) return;
    keepPaletteOpen();
    const result = nextReaction(streak.current, emoji, performance.now());
    streak.current = result.streak;
    setBursts(b => [...(result.combo ? b.filter(item => item.emoji !== emoji) : b).slice(-7), { id: crypto.randomUUID(), emoji, combo: result.combo }]);
  }
  function publish() {
    if (!message.trim()) return;
    followFeed.current = true;
    const order = ++sequence.current;
    setPosts(p => [{ order, id: crypto.randomUUID(), author: 'Vous', initials: 'VO', time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }), score: scoreSnapshot, text: message.trim(), own: true }, ...(empty ? [] : p)]);
    if (empty) setPolls([]);
    setEmpty(false); setMessage(''); setPanel(null); setComposer(false); announce('Message publié');
  }
  function publishPoll() {
    if (!question.trim() || options.some(o => !o.trim()) || new Set(options.map(o => o.trim().toLocaleLowerCase('fr'))).size !== options.length) return;
    followFeed.current = true;
    const order = ++sequence.current;
    setPolls(p => [{ order, id: crypto.randomUUID(), question: question.trim(), options: options.map(o => o.trim()), counts: options.map(() => 0), vote: null, closed: false, author: 'Vous' }, ...(empty ? [] : p)]);
    if (empty) setPosts([]);
    setEmpty(false); setPanel(null); setComposer(false); setQuestion(''); setOptions(['', '']); announce('Sondage publié');
  }
  function renderSelectedPoll() {
    const visiblePoll = polls.find(p => p.id === selectedPollId);
    if (!visiblePoll) return null;
            const activePoll = !visiblePoll.closed && !ended;
            const total = visiblePoll.counts.reduce((a, b) => a + b, 0) + (visiblePoll.vote === null ? 0 : 1);
            const results = visiblePoll.vote !== null || visiblePoll.closed || ended;
            const updatePoll = (patch: Partial<Poll>) => setPolls(p => p.map(item => item.id === visiblePoll.id ? { ...item, ...patch } : item));
            return <article className="poll-card expanded-poll">

            <div className="section-line"><span className="poll-label"><Icon kind="poll" /> LE SONDAGE</span><span className="poll-status">{activePoll ? 'Ouvert' : 'Clôturé'}</span></div>
            <h3>{visiblePoll.question}</h3><p className="poll-byline">Par {visiblePoll.author} · Un vote par compte</p>
            <div className="poll-options">{visiblePoll.options.map((option, i) => {
              const count = visiblePoll.counts[i] + (visiblePoll.vote === i ? 1 : 0);
              const percent = total ? Math.round(count / total * 100) : 0;
              return <button key={i} className={visiblePoll.vote === i ? 'selected' : ''} disabled={!activePoll} aria-pressed={visiblePoll.vote === i} onClick={() => { if (role === 'visitor') setPanel('login'); else { updatePoll({ vote: i }); announce('Vote enregistré'); } }}>
                {results && <span className="poll-bar" style={{ width: `${percent}%` }} />}<span className="option-label">{visiblePoll.vote === i ? <span className="vote-check">✓</span> : !results ? <span className="vote-circle" /> : null}{option}</span>{results && <b>{percent} %</b>}
              </button>;
            })}</div>
            <div className="poll-footer"><span>{total} vote{total !== 1 ? 's' : ''}{activePoll && (visiblePoll.vote === null ? ' · À vous de jouer' : ' · Vote modifiable')}</span>{member && activePoll && <button onClick={() => { updatePoll({ closed: true }); announce('Sondage clôturé'); }}>Clôturer</button>}</div>
          </article>;
  }
  return <div className="preview-layout">
    <aside className="preview-guide">
      <div className="preview-kicker"><span /> ATELIER PRODUIT · 04</div>
      <h1>Le match.<br />L’ambiance.<br /><em>Tout le monde.</em></h1>
      <p>Une place au bord du court,<br />même à distance.</p>
      <div className="preview-controls">
        <h2>Explorer le prototype</h2>
        <label htmlFor="preview-role">Point de vue</label>
        <select id="preview-role" value={role} onChange={e => { setRole(e.target.value as Role); setPanel(null); setComposer(false); setReactionPicker(false); streak.current = null; setBursts([]); }}>
          <option value="member">Membre · score et animation</option><option value="spectator">Spectateur connecté</option><option value="visitor">Visiteur non connecté</option>
        </select>
        <label className="preview-check"><input type="checkbox" checked={finished} onChange={e => { setFinished(e.target.checked); setPanel(null); setComposer(false); setBursts([]); streak.current = null; setNotice(''); }} /> Match terminé</label>
        <label className="preview-check"><input type="checkbox" checked={empty} onChange={e => setEmpty(e.target.checked)} /> Fil encore vide</label>
        <button className="preview-reset" onClick={() => { setPosts(initialPosts); setPolls([initialPoll]); setMatch(previewMatch); history.current = []; setUndoCount(0); followFeed.current = true; sequence.current = 3; setReactionPicker(false); setEmpty(false); setFinished(false); setMessage(''); setQuestion(''); setOptions(['', '']); setComposer(false); setNotice(''); setBursts([]); streak.current = null; }}>Réinitialiser la démo ↺</button>
      </div>
      <p className="preview-footnote">Maquette interactive · données fictives<br />Aucune publication réelle. Les actions sont locales et se réinitialisent au rechargement.</p>
    </aside>
    <section className="live-app" aria-label="Aperçu mobile du live">
      <header className="live-header"><span className="back-mark"><Icon kind="arrow" /></span><strong>Le live du match</strong><span className="club-mark">CAC</span></header>
        <section className="live-score" aria-label="Score du match">
          <div className="score-meta"><span className={ended ? 'status-finished' : 'status-live'}>{ended ? '✓ TERMINÉ' : '● EN DIRECT'}</span><span>Court 2 <span className="meta-dot">·</span> Simple messieurs</span></div>
          <table className="score-table"><caption className="sr-only">Score par set</caption><thead><tr><th scope="col"><span className="sr-only">Joueurs</span></th>{sets.map(n => <th key={n} scope="col">S{n}</th>)}{member && !ended && <th scope="col"><span className="sr-only">Saisie rapide</span></th>}</tr></thead><tbody>
            {(['j1', 'j2'] as const).map(player => <tr key={player}><th scope="row"><span className="player-name">{match[`${player}_prenom`]} <b>{match[`${player}_nom`]}</b></span></th>{sets.map(n => <td key={`${n}-${scoreVersion}`} className={n === currentSet ? `current-set ${scoreVersion ? 'score-changed' : ''}` : (scoreVersion ? 'score-changed' : '')}>{displayedMatch[`set${n}_${player}`] ?? 0}{displayedMatch[`set${n}_tb_${player}`] !== null && <sup>{displayedMatch[`set${n}_tb_${player}`]}</sup>}</td>)}{member && !ended && <td className="score-action"><button aria-label={`Ajouter ${isNormalSetInTiebreak(current) ? 'un point' : 'un jeu'} à ${match[`${player}_prenom`]}`} disabled={!canIncrementNormal(current)} onClick={() => patchScore(setNormalIntoMatch(currentSet, incrementNormal(current, player)))}>+ {isNormalSetInTiebreak(current) ? 'point' : 'jeu'}</button></td>}</tr>)}
          </tbody></table>
          <div className="score-tools"><button onClick={() => setPanel('details')}>{ended ? 'Match terminé' : `Set ${currentSet}${isNormalSetInTiebreak(current) ? ' · tie-break' : ''}`} · Détails</button><div>{member && undoCount > 0 && <button className="undo-score" onClick={undoScore}>↶ Annuler</button>}{member && <button onClick={() => { setMatch(displayedMatch); setFinished(false); setPanel('score'); }}>Corriger ↗</button>}</div></div>

        </section>
      <div className="live-scroll" ref={scroll} onScroll={() => { const el = scroll.current; if (el) followFeed.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70; }}>
        <div className="live-body">
          <div className="feed-heading"><div><span className="eyebrow">AU BORD DU COURT</span><h2>Le fil du match</h2></div><span className="feed-mode">{member ? 'Vous animez' : 'Côté tribunes'}</span></div>
          {!empty && <div className="feed-start"><span />Début du live<span /></div>}
          {!empty && [...polls.map(poll => ({ kind: 'poll' as const, order: poll.order, poll })), ...posts.map(post => ({ kind: 'post' as const, order: post.order, post }))].sort((a, b) => a.order - b.order).map(item => {
            if (item.kind === 'poll') { const poll = item.poll; return <article key={poll.id} className={`poll-summary ${poll.order > 3 ? 'new-feed-item' : ''}`}>
            <span className="summary-icon"><Icon kind="poll" /></span><div><span className="eyebrow">SONDAGE {poll.closed || ended ? '· CLÔTURÉ' : ''}</span><h3>{poll.question}</h3><span className="summary-meta">{poll.counts.reduce((a, b) => a + b, 0) + (poll.vote === null ? 0 : 1)} votes{poll.vote !== null ? ' · Vous avez voté' : ''}</span></div>
            <button onClick={() => { setSelectedPollId(poll.id); setPanel('vote'); }}>{poll.closed || ended || poll.vote !== null ? 'Voir' : 'Répondre'} <span aria-hidden="true">↗</span></button>
          </article>; }
            const post = item.post; return <article className={`feed-post ${post.order > 3 ? 'new-feed-item' : ''}`} key={post.id}>
            <div className="post-heading"><span className="avatar">{post.initials}</span><div><strong>{post.author}</strong></div><time>{post.time}</time>{member && post.own && <button className="icon-button" aria-label="Supprimer votre message" onClick={() => { setPosts(p => p.filter(item => item.id !== post.id)); announce('Message supprimé'); }}><Icon kind="close" /></button>}</div>
            <p>{post.text}</p><span className="post-score">Score à la publication <b>{post.score}</b></span>
          </article>;
          })}
          {empty ? <div className="empty-feed"><span>🎾</span><h3>Le match se vit aussi ici</h3><p>{member ? 'Un bel échange, une ambiance, un mot d’encouragement… Ouvrez le fil avec un premier message.' : 'Les nouvelles du bord du court apparaîtront ici. En attendant, place au match !'}</p>{member && !ended && <button className="primary-button" onClick={() => setPanel('message')}>Publier le premier message</button>}</div> : ended ? <p className="feed-end">Match terminé · Le fil reste disponible</p> : null}
        </div>
      </div>
      {member && !ended && <div className="member-dock">
        {composer && <div className="dock-options" aria-label="Options de publication">
          <button onClick={() => { setPanel('poll'); setComposer(false); }}><Icon kind="poll" /><span>Créer un sondage</span></button>
          <button onClick={() => { setPanel('message'); setComposer(false); }}><Icon kind="message" /><span>Messages rapides</span></button>
        </div>}
        <form className="dock-form" onSubmit={e => { e.preventDefault(); publish(); }}>
          <button type="button" className="dock-plus" aria-label="Options de publication" aria-expanded={composer} onClick={() => setComposer(!composer)}><Icon kind={composer ? 'close' : 'plus'} /></button>
          <textarea ref={messageInput} rows={1} maxLength={280} aria-label="Votre message au bord du court" placeholder="Au bord du court…" value={message} onChange={e => setMessage(e.target.value)} />
          <button className="dock-send" aria-label="Publier le message dans le fil" disabled={!message.trim()}>↑</button>
        </form><div className="dock-caption"><span>Visible par tous · signé par vous</span><span>{message.length}/280</span></div>
      </div>}
      {!member && !ended && <div className="spectator-dock">
        <div className="reaction-anchor">
          {reactionPicker && <div ref={palette} onPointerDown={keepPaletteOpen} onFocus={keepPaletteOpen} className="reaction-palette" aria-label="Choisir une réaction">
            {reactions.map(([emoji, label]) => <button key={emoji} aria-label={label} onClick={() => react(emoji)}>{emoji}</button>)}
          </div>}
          <div className="floating-bursts" aria-hidden="true">{bursts.map((b, i) => <span key={b.id} className={b.combo ? 'emoji-combo' : 'emoji-single'} onAnimationEnd={e => { if (e.target === e.currentTarget) setBursts(items => items.filter(item => item.id !== b.id)); }} style={b.combo ? undefined : { left: `${(i % 4) * 10}px` }}>{b.combo ? <><i className="combo-ghost ghost-one">{b.emoji}</i><i className="combo-ghost ghost-two">{b.emoji}</i><i className="combo-ghost ghost-three">{b.emoji}</i><i className="combo-halo" /><b className="combo-hero">{b.emoji}</b><i className="combo-spark spark-one">✦</i><i className="combo-spark spark-two">✦</i><small>×4</small></> : b.emoji}</span>)}</div>
          <button ref={reactionToggle} className="reaction-toggle" aria-label={reactionPicker ? 'Fermer les réactions' : 'Ouvrir les réactions'} aria-expanded={reactionPicker} onClick={() => { if (role === 'visitor') setPanel('login'); else setReactionPicker(!reactionPicker); }}>{reactionPicker ? '⌄' : '❤️'}</button>
        </div>
      </div>}
      <div className="live-toast" role="status">{notice && <span>{notice}</span>}</div>

    </section>
    {panel && <Sheet title={panel === 'message' ? 'Au bord du court' : panel === 'poll' ? 'Lancer un sondage' : panel === 'score' ? 'La saisie du score' : panel === 'vote' ? 'Le sondage du live' : panel === 'details' ? 'Le match' : 'Entrez dans le match'} onClose={() => setPanel(null)}>
      {panel === 'vote' && renderSelectedPoll()}
      {panel === 'details' && <div className="match-details"><p>Tournoi du club · Simple messieurs · Court 2</p>{(['j1', 'j2'] as const).map(player => <p key={player}><strong>{match[`${player}_prenom`]} {match[`${player}_nom`]}</strong><br />{match[`${player}_club`]} · {match[`${player}_classement`]}</p>)}<p>{member ? 'Vous tenez le score.' : 'Score tenu par Alex.'}</p></div>}
      {panel === 'message' && <form onSubmit={e => { e.preventDefault(); publish(); }}><p className="sheet-intro">Un mot suffit pour faire vivre le match.</p><div className="quick-messages">{shortcuts.map(text => <button type="button" key={text} onClick={() => setMessage(text)}>{text}</button>)}</div><label htmlFor="live-message">Votre message</label><textarea id="live-message" autoFocus maxLength={280} rows={4} value={message} placeholder="Que se passe-t-il au bord du court ?" onChange={e => setMessage(e.target.value)} /><div className="input-help"><span>Visible par tous · signé par vous</span><span>{message.length}/280</span></div><button className="primary-button" disabled={!message.trim()}>Publier le message</button></form>}
      {panel === 'poll' && <form onSubmit={e => { e.preventDefault(); publishPoll(); }}><p className="sheet-intro">Faites participer les spectateurs.</p><label htmlFor="poll-question">Votre question</label><input id="poll-question" autoFocus required maxLength={140} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Quel est votre rituel avant un match ?" /><div className="option-inputs">{options.map((option, i) => <div key={i}><label htmlFor={`answer-${i}`}>Réponse {i + 1}</label><div><input id={`answer-${i}`} required maxLength={60} value={option} onChange={e => setOptions(o => o.map((s, n) => n === i ? e.target.value : s))} />{options.length > 2 && <button type="button" className="icon-button" aria-label={`Retirer la réponse ${i + 1}`} onClick={() => setOptions(o => o.filter((_, n) => n !== i))}><Icon kind="close" /></button>}</div></div>)}</div>{options.length < 4 && <button type="button" className="add-option" onClick={() => setOptions(o => [...o, ''])}>+ Ajouter une réponse</button>}<p className="sheet-intro">Un vote par compte, modifiable jusqu’à la clôture.</p><button className="primary-button" disabled={!question.trim() || options.some(o => !o.trim()) || new Set(options.map(o => o.trim().toLocaleLowerCase('fr'))).size !== options.length}>Publier le sondage</button></form>}
      {panel === 'login' && <><p className="sheet-intro">Le score et le fil sont accessibles à tous. Connectez-vous pour voter et encourager les joueurs.</p><button className="primary-button" onClick={() => { setRole('spectator'); setPanel(null); announce('Vue spectateur connecté activée'); }}>Simuler la connexion</button><p className="simulation-note">Prototype : aucune connexion réelle.</p></>}
      {panel === 'score' && <><p className="sheet-intro">Corrigez les jeux ou les points du tie-break. Les changements sont visibles immédiatement dans cette démo.</p><LiveScoreEntry match={{ ...match, status: 'live' }} onPatch={patchScore} /><button className="primary-button" onClick={() => { setFinished(false); setPanel(null); }}>Revenir au live</button></>}

    </Sheet>}
  </div>;
}

