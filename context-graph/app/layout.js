import { Fraunces, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata = {
  title: "Context Graph — SAP O2C Explorer",
  description: "Interactive graph visualization and natural language query interface for SAP Order-to-Cash data. Explore sales orders, deliveries, billing documents, journal entries, payments, and more.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${sourceSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
