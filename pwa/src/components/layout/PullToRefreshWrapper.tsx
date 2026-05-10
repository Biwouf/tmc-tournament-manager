import { useRef } from 'react';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';

interface Props {
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  children: React.ReactNode;
}

export default function PullToRefreshWrapper({ onRefresh, isRefreshing, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { pullProgress, isDragging } = usePullToRefresh({ onRefresh, isRefreshing, containerRef });

  const displayProgress = isRefreshing ? 1 : pullProgress;
  const indicatorY = -48 + 60 * displayProgress;
  const contentY = 60 * displayProgress;
  const rotation = pullProgress * 360;
  const transition = isDragging ? 'none' : 'transform 0.2s ease';

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto relative"
      style={{ overscrollBehaviorY: 'contain', touchAction: 'pan-y' }}
    >
      <div
        className="absolute left-1/2 top-0 -translate-x-1/2 pointer-events-none"
        style={{ zIndex: 10 }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `translateY(${indicatorY}px)`,
            transition,
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className={`text-primary ${isRefreshing ? 'animate-spin' : ''}`}
            style={isRefreshing ? undefined : { transform: `rotate(${rotation}deg)` }}
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
      <div style={{ transform: `translateY(${contentY}px)`, transition }}>
        {children}
      </div>
    </div>
  );
}
