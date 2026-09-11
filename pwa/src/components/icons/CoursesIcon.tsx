export default function CoursesIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m2 8 10-5 10 5-10 5L2 8Z" />
      <path d="M6 10v6c4 3 8 3 12 0v-6M22 8v7" />
    </svg>
  );
}
