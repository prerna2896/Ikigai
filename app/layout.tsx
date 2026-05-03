import './globals.css';
import type { ReactNode } from 'react';
import TopNav from '../components/TopNav';

export const metadata = {
  title: 'Ikigai',
  description: 'Plan and reflect on your week with calm structure.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <TopNav />
        {children}
      </body>
    </html>
  );
}
