export function BrandMark({ size = 36 }: { size?: number }) {
  const wave = (y: number, delay: string, cls: string) => (
    <path
      className={`surf-wave ${cls}`}
      d={`M 4 ${y} Q 16 ${y - 5} 28 ${y}`}
      stroke="#9BEFC0"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <animate
        attributeName="d"
        dur="2.4s"
        begin={delay}
        repeatCount="indefinite"
        calcMode="spline"
        keyTimes="0;0.5;1"
        keySplines="0.45 0 0.55 1;0.45 0 0.55 1"
        values={`M 4 ${y} Q 16 ${y - 5} 28 ${y};M 4 ${y} Q 16 ${y + 5} 28 ${y};M 4 ${y} Q 16 ${y - 5} 28 ${y}`}
      />
    </path>
  );

  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
    >
      {wave(11, "0s", "surf-wave-a")}
      {wave(17, "-0.8s", "surf-wave-b")}
      {wave(23, "-1.6s", "surf-wave-c")}
      <path
        className="surf-spark"
        fill="#9BEFC0"
        d="M16 2.2 16.9 4.2 18.9 5.1 16.9 6 16 8 15.1 6 13.1 5.1 15.1 4.2Z"
      />
    </svg>
  );
}
