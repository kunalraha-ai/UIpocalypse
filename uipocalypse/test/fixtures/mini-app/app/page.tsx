'use client';

export default function Page() {
  const defined = process.env.DEFINED_VAR;
  const missing = process.env.TOTALLY_MISSING;
  void defined;
  void missing;

  return (
    <div>
      {/* dead-handler: empty onClick */}
      <button onClick={() => {}}>Dead button</button>
      {/* negative: real handler */}
      <button onClick={() => console.log('clicked')}>Alive button</button>
      {/* negative: decorative, hidden from a11y */}
      <button aria-hidden="true">✦</button>

      {/* unwired-form: no onSubmit, no action, no method */}
      <form aria-label="Newsletter">
        <input type="email" name="email" />
        <button type="submit">Subscribe</button>
      </form>
      {/* negative: wired form */}
      <form
        aria-label="Working"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <button type="submit">Good form</button>
      </form>

      {/* missing-endpoint + no-error-state: no catch in the handler */}
      <button onClick={() => { fetch('/api/missing'); }}>Call missing</button>
      {/* negative: endpoint exists, error handled */}
      <button onClick={() => { fetch('/api/exists').catch(() => {}); }}>Call exists</button>

      {/* FP gates from the real-repo audit — none of these may fire: */}
      <button disabled>Coming soon</button>
      <form aria-label="Skeleton">
        <input type="email" placeholder="search..." />
      </form>
      <form aria-label="ServerActions">
        <button formAction={() => {}} formMethod="post">
          Server action
        </button>
      </form>

      {/* Vercel serverless catch-all (GrowthSent eval): /api/v1/* resolves
          through api/v1/[...path].ts — must not fire missing-endpoint */}
      <button onClick={() => { fetch('/api/v1/auth/google/start'); }}>Catch-all fetch</button>
      {/* bare VERCEL is platform-injected — must not fire undefined-env */}
      {void process.env.VERCEL}
      {/* PaaS/Figma-Make platform vars likewise */}
      {void process.env.PORT}
      {void process.env.FIGMA_PUBLIC_URL}
    </div>
  );
}
