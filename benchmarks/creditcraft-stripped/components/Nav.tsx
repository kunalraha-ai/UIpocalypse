import Link from 'next/link';

export default function Nav({ userName }: { userName: string | null }) {
  return (
    <header className="nav">
      <span className="brand">CreditCraft</span>
      <nav aria-label="Main">
        <Link href="/">Store</Link>
        <Link href="/credits">Credits</Link>
        <Link href="/checkout">Checkout</Link>
        <Link href="/orders">Orders</Link>
        <Link href="/profile">Profile</Link>
        <Link href="/settings">Settings</Link>
      </nav>
      {userName ? (
        <form action="/api/auth/logout" method="post">
          <button type="submit">Sign out</button>
        </form>
      ) : (
        <Link href="/login">Sign in</Link>
      )}
    </header>
  );
}
