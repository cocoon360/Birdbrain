import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bird Brain',
  description: 'Local-first project intelligence console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
