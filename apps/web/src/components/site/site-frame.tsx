import { Manrope, Sora } from "next/font/google";
import { SiteFooter, SiteHeader } from "@/components/site/site-shell";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  weight: ["600", "700", "800"],
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700", "800"],
});

export const siteFontClass = `${sora.variable} ${manrope.variable} ${manrope.className}`;

export function SiteFrame({
  children,
  footer = true,
}: {
  children: React.ReactNode;
  footer?: boolean;
}) {
  return (
    <div className={`synap-site ${siteFontClass}`}>
      <SiteHeader />
      {children}
      {footer ? <SiteFooter /> : null}
    </div>
  );
}
