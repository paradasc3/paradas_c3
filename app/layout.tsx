import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parada U-700",
  description: "Acompanhamento da Parada U-700",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
