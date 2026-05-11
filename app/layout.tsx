import './globals.css';
import type { ReactNode } from 'react';
import BottomNav from '../components/BottomNav';
import TopNav from '../components/TopNav';
import { ThemeProvider } from '../components/ThemeProvider';

export const metadata = {
  title: 'Ikigai',
  description: 'Plan and reflect on your week with calm structure.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
};

// Inline script applies the saved theme before paint to avoid a flash of the
// default theme on every navigation. Kept tiny on purpose.
const themeBootstrap = `(() => {
  try {
    var t = window.localStorage.getItem('ikigai-theme');
    if (t !== 'aurora' && t !== 'sunset' && t !== 'ocean' && t !== 'current') {
      t = 'sunset';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'sunset');
  }
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen pb-[calc(env(safe-area-inset-bottom)+56px)] md:pb-0">
        <ThemeProvider>
          <TopNav />
          {children}
          <BottomNav />
        </ThemeProvider>
      </body>
    </html>
  );
}
