interface IconProps {
  color?: string;
  size?: number;
  className?: string;
}

export default function TeamMatchesIcon({
  color = 'currentColor',
  size = 24,
  className,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3 4.5 5.5v6c0 4.5 3.4 8 7.5 9 4.1-1 7.5-4.5 7.5-9v-6L12 3Z" />
      <path d="M9 12.5l2 2 4-4.5" />
    </svg>
  );
}
