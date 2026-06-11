import { useSearchParams } from 'react-router-dom';
import ActuTabSwitcher from '../components/actu/ActuTabSwitcher';
import ActusFeed from '../components/actu/ActusFeed';
import EventsFeed from '../components/actu/EventsFeed';

export default function ActuPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') === 'events' ? 'events' : 'actus') as 'actus' | 'events';
  const setTab = (t: 'actus' | 'events') => setParams({ tab: t }, { replace: true });

  return (
    <div className="flex flex-col h-full">
      <ActuTabSwitcher tab={tab} onChange={setTab} />
      <div className="flex-1 min-h-0">
        {tab === 'actus' ? <ActusFeed /> : <EventsFeed />}
      </div>
    </div>
  );
}
