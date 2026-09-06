import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSite } from '../../contexts/SiteContext';
import { useContactDrawer } from '../../contexts/ContactDrawerContext';
import { configImageUrl } from '../../lib/configImage';
import { NAV_ITEMS } from './navItems';

/** Header sticky : logo + nom + ville, navigation, CTA contact, et menu mobile plein écran. */
export default function Header() {
  const { config, clubName } = useSite();
  const { openDrawer } = useContactDrawer();
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const logo = configImageUrl(config.brand.logo);

  const identity = (
    <>
      {/* Pas de logo saisi → pas d'`<img>` sans `src` : le nom seul tient la place. */}
      {logo && <img src={logo} alt="" className="h-11 w-11 object-contain" />}
      <span className="flex flex-col leading-tight">
        <span className="text-[16.5px] font-extrabold tracking-tight">{clubName}</span>
        {config.brand.city && (
          <span className="text-[12.5px] font-semibold text-muted">{config.brand.city}</span>
        )}
      </span>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="shell flex items-center gap-7 py-3">
        <NavLink to="/" className="flex items-center gap-3">
          {identity}
        </NavLink>

        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `rounded-full px-4 py-2 text-[14.5px] font-semibold transition-colors hover:bg-brand-soft hover:text-brand ${
                  isActive ? 'text-brand' : 'text-text'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <button type="button" onClick={openDrawer} className="btn btn-primary ml-3 px-5 py-2.5">
            Nous contacter
          </button>
        </nav>

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Ouvrir le menu"
          className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-xl text-white lg:hidden"
        >
          ≡
        </button>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg p-6 lg:hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">{identity}</div>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Fermer le menu"
              className="h-11 w-11 text-2xl"
            >
              ✕
            </button>
          </div>
          <nav className="mt-8 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMenuOpen(false)}
                className={`rounded-soft px-3 py-4 text-lg font-bold ${
                  pathname === item.to ? 'text-brand' : 'text-text'
                }`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              openDrawer();
            }}
            className="btn btn-primary mt-6 w-full"
          >
            Nous contacter
          </button>
        </div>
      )}
    </header>
  );
}
