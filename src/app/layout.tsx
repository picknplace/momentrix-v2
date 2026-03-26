import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Momentrix V2',
  description: 'E-commerce Order Management & Analytics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
