import { Link } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';

// SaaS S4 — écran provisoire d'arrivée après l'activation par lien magique. S5 le remplace par
// les premiers pas (première actu, écran final).
export default function FirstStepsPage() {
  const { club } = useClub();
  return (
    <main className="mx-auto max-w-xl p-6 sm:p-10">
      <h1 className="text-2xl font-semibold">Votre club est prêt</h1>
      <p className="mt-2 text-muted-foreground">{club?.name} est activé : votre essai de 30 jours commence.</p>
      <Link to="/" className="mt-6 inline-block rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
        Aller au tableau de bord
      </Link>
    </main>
  );
}
