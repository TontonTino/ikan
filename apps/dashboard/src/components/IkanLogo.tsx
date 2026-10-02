/**
 * Optional shared logo component for the dashboard.
 * The active dashboard navigation uses the same official horizontal wordmark.
 */
interface IkanLogoProps {
  height?: number;
  className?: string;
}

export function IkanLogo({ height = 36, className }: IkanLogoProps) {
  const width = height * 3.65;
  return (
    <img
      src="/ikanai-logo-horizontal.png"
      alt="IKAN AI"
      width={width}
      height={height}
      className={className}
      style={{ minHeight: 32, display: 'block', objectFit: 'contain' }}
      draggable={false}
    />
  );
}

export default IkanLogo;