import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Ikigai',
  description: 'Plan and reflect on your week with calm structure.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {children}
      </body>
    </html>
  );
}
