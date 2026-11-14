import { QrCode } from '../firstSteps/QrCode';
import { useCopy } from '../firstSteps/useCopy';
import { shareMessage } from '../../lib/dashboardChecklist';
import Modal from './Modal';

// SaaS S8 — « Partager l'app aux adhérents » : QR code et copie de l'écran final des premiers pas,
// plus un message prêt à coller. Chunk à part (`lazy`) : le QR code ne pèse pas sur le tableau de bord.
export default function AppShareDialog({ host, clubName, onClose }: { host: string; clubName: string; onClose: () => void }) {
  const link = useCopy();
  const message = useCopy();
  const text = shareMessage(clubName, host);
  const button = 'min-h-11 rounded-lg border border-border bg-card px-4 text-sm font-medium transition hover:bg-muted';
  return (
    <Modal title="Partager l’app aux adhérents" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <QrCode value={`https://${host}`} className="h-36 w-36 shrink-0 rounded-lg border" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <a href={`https://${host}`} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-primary underline-offset-2 hover:underline">{host}</a>
            <span className="text-sm text-muted-foreground">À scanner en réunion, ou à afficher au club.</span>
            <button type="button" className={button} onClick={() => link.copy(`https://${host}`)}>
              {link.state === 'copied' ? 'Lien copié ✓' : 'Copier le lien'}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="checklist-share-message" className="text-sm font-medium">Message prêt à coller</label>
          <textarea id="checklist-share-message" readOnly value={text} rows={4} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={button} onClick={() => message.copy(text)}>
            {message.state === 'copied' ? 'Message copié ✓' : 'Copier le message'}
          </button>
        </div>
        {(link.state === 'failed' || message.state === 'failed') && (
          <p role="alert" className="text-sm text-destructive">Copie impossible : sélectionnez le texte à la main.</p>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Fermer</button>
        </div>
      </div>
    </Modal>
  );
}
