import './globals.css';
import type { ReactNode } from 'react';
import TopNav from '../components/TopNav';
import { ThemeProvider } from '../components/ThemeProvider';

export const metadata = {
  title: 'Ikigai',
  description: 'Plan and reflect on your week with calm structure.',
};

// Inline script applies the saved theme before paint to avoid a flash of the
// default theme on every navigation. Kept tiny on purpose.
const themeBootstrap = `(() => {
  try {
    var t = window.localStorage.getItem('ikigai-theme');
    if (t === 'aurora' || t === 'sunset' || t === 'ocean' || t === 'current') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <TopNav />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
