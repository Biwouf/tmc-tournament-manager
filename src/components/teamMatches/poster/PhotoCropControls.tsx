import type { PhotoCrop } from '../../../types';
import type { CropSaveStatus } from './photoCrops';

const LABELS = { x: 'Focus horizontal', y: 'Focus vertical', zoom: 'Zoom' } as const;
const STATUS: Record<CropSaveStatus, string> = {
  local: 'Le cadrage d’une image importée n’est pas enregistré.',
  idle: 'Le cadrage est enregistré automatiquement pour cette photo.',
  saving: 'Enregistrement du cadrage…',
  saved: 'Cadrage enregistré pour cette photo.',
  error: 'Cadrage non enregistré. Modifiez-le pour réessayer.',
};

/** Curseurs focus x/y + zoom du visuel « Esprit d'équipe », avec l'état de l'enregistrement. */
export default function PhotoCropControls({ crop, onChange, status }: { crop: PhotoCrop; onChange: (crop: PhotoCrop) => void; status: CropSaveStatus }) {
  return <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 text-sm font-medium">Cadrage</legend>
    {(['x', 'y', 'zoom'] as const).map(key => <label key={key} className="text-sm">
      {LABELS[key]}
      <input aria-label={LABELS[key]} type="range" className="mt-2 block w-full" min={key === 'zoom' ? 1 : 0} max={key === 'zoom' ? 3 : 100} step={key === 'zoom' ? 0.05 : 1} value={crop[key]} onChange={event => onChange({ ...crop, [key]: Number(event.target.value) })} />
    </label>)}
    <p role="status" className={`text-xs sm:col-span-3 ${status === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>{STATUS[status]}</p>
  </fieldset>;
}
