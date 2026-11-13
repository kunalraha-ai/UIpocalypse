import './globals.css';
import Nav from '@/components/Nav';
import { getSessionUser } from '@/lib/session';

export const metadata = {
  title: 'CreditCraft',
  description: 'Sample store used for UIpocalypse Phase 0 spikes',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en">
      <body>
        <Nav userName={user?.name ?? null} />
        <main className="container">{children}</main>
        <footer>
          <p>CreditCraft — sample app for UIpocalypse Phase 0</p>
          {/* Decoy #1: inert decorative button, hidden from the accessibility tree. */}
          <button aria-hidden="true" tabIndex={-1}>
            ✦
          </button>
        </footer>
      </body>
    </html>
  );
}
