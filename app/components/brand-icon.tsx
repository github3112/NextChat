import Image from "next/image";

export function BrandIcon({
  size = 42,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/favicon.ico"
      alt="Pyjri"
      width={size}
      height={size}
      unoptimized
      className={className}
    />
  );
}
