import { Inter } from "next/font/google";
import "./portal.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return <div className={`portal-route ${inter.className}`}>{children}</div>;
}
