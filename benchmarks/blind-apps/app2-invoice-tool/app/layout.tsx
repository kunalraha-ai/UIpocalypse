import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Freelance Invoices',
  description: 'Invoice management for freelancers — create, send, and get paid.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                $
              </span>
              <span className="brand-name">Freelance Invoices</span>
            </Link>
            <nav className="main-nav">
              <Link href="/" className="nav-link">
                Dashboard
              </Link>
              <Link href="/invoices/new" className="btn btn-primary btn-sm">
                + New Invoice
              </Link>
            </nav>
          </div>
        </header>
        <main className="container page">{children}</main>
        <footer className="site-footer">
          <div className="container footer-inner">
            <span>
              Invoices are stored locally in <code>data/invoices.json</code> · Stripe runs in
              test mode only
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
