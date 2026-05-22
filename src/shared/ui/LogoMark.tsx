export function LogoMark({ size = 24, light = false }: { size?: number; light?: boolean }) {
  return (
    <img
      src={light ? "/logo-mark-white.png" : "/logo-mark.png"}
      width={size} height={size}
      style={{ display: "inline-block", objectFit: "contain", userSelect: "none", flexShrink: 0 }}
      alt="Ai NoteTaking" draggable={false}
    />
  );
}
