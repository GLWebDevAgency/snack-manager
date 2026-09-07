import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ErrorReporter } from "@/components/ErrorReporter";
import { platformMetadata } from "@/lib/platform-metadata";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = platformMetadata;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className={`${inter.variable} font-sans antialiased`}>
        {/* Les erreurs de TOUTES les surfaces web remontent au journal
            /sm/erreurs — actif en production seulement. */}
        <ErrorReporter />
        {children}
      </body>
    </html>
  );
}
