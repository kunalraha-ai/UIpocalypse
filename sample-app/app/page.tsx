import SearchBox from '@/components/SearchBox';
import PromoButton from '@/components/PromoButton';
import Recommendations from '@/components/Recommendations';
import { products } from '@/lib/store';

export default function HomePage() {
  return (
    <div>
      <section>
        <h2>Welcome to CreditCraft</h2>
        <p className="muted">Sample store used for UIpocalypse Phase 0 spikes.</p>
        <SearchBox />
        <PromoButton />
        <Recommendations />
      </section>
      <section>
        <h2>Products</h2>
        <div className="grid">
          {products.map((p) => (
            <div className="card" key={p.id}>
              <h3>{p.name}</h3>
              <p>${p.price}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <h3>Newsletter</h3>
        {/* Planted bug #2: form has no submit handler or action. */}
        <form>
          <label>
            Email
            <input type="email" name="email" placeholder="you@example.com" />
          </label>
          <button type="submit">Subscribe</button>
        </form>
      </section>
    </div>
  );
}
