import type { Metadata } from "next";
import { Big_Shoulders, Manrope } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({ subsets: ["latin"], axes: ["opsz"], variable: "--font-display-face" });
const body = Manrope({ subsets: ["latin"], variable: "--font-body-face" });

export const metadata: Metadata = {
  title: "NexForce Agent",
  description: "A local-first AI browser operator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <div className="cine-backdrop" aria-hidden />
        {children}
      </body>
    </html>
  );
}