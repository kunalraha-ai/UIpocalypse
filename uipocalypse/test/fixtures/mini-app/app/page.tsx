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
    </div>
  );
}
