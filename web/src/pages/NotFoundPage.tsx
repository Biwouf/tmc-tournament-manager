import { NavLink } from 'react-router-dom';
import { useSite } from '../contexts/SiteContext';
import { useContactDrawer } from '../contexts/ContactDrawerContext';
import './NotFoundPage.css';

export default function NotFoundPage() {
  const { clubName, config } = useSite();
  const { openDrawer } = useContactDrawer();
  const city = config.brand.city.trim();

  return <>
    <section className="shell section not-found-hero flex flex-col items-center text-center">
      <p className="eyebrow">Erreur 404</p>
      <div className="not-found-score" aria-hidden="true">
        <span>4</span><span className="not-found-ball" /><span>4</span>
      </div>
      <h1 className="page-h1 mt-[22px]">Faute !</h1>
      <p className="lede mt-[14px] max-w-[46ch] text-pretty">La page que vous cherchez est sortie du court. Le point est perdu — le match, lui, continue.</p>
      <div className="mt-7 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <NavLink reloadDocument to="/" className="btn btn-primary min-h-12">Retour à l'accueil</NavLink>
        <button type="button" onClick={openDrawer} className="btn btn-outline min-h-12">Nous contacter</button>
      </div>
    </section>
    <section className="shell section not-found-illustration">
      <div className="not-found-fence" aria-hidden="true">
        <div className="not-found-rail" />
        <div className="not-found-banner">
          <div className="not-found-ties">{Array.from({ length: 8 }, (_, i) => <span key={i} />)}</div>
          <div className="not-found-print">
            <span className="not-found-name">{clubName}</span>
            {city && <><span className="not-found-rule" /><span className="not-found-city">{city}</span></>}
          </div>
        </div>
      </div>
      <p className="mt-[14px] text-center font-mono text-[13.5px] font-semibold text-muted">ça ressemble à une bâche — code HTTP 404</p>
    </section>
  </>;
}
