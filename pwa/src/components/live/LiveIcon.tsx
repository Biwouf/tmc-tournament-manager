export default function LiveIcon({
  kind,
}: {
  kind: 'poll' | 'info' | 'photo' | 'reaction';
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'poll' ? (
        <path d="M5 20V10m7 10V4m7 16v-7" />
      ) : kind === 'reaction' ? (
        <>
          <circle cx="10.5" cy="13.5" r="7.5" />
          <path d="M7.5 15.5c1.6 1.8 4.4 1.8 6 0M8 11.5v.01m5 0v.01M19.5 2v5M17 4.5h5" />
        </>
      ) : kind === 'photo' ? (
        <>
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6m0-10v.01" />
        </>
      )}
    </svg>
  );
}
