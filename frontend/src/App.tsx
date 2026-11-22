import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, loadProject, saveProject, routeParts, type Report, type RunRow, type Status, type StaticIssue, type Graph, type Diff, type JobEvent } from './api'

type IconName =
  | 'arrow' | 'bolt' | 'bot' | 'check' | 'code' | 'copy' | 'eye' | 'file'
  | 'graph' | 'grid' | 'lock' | 'menu' | 'moon' | 'play' | 'plus' | 'report'
  | 'search' | 'settings' | 'shield' | 'spark' | 'stop' | 'sun' | 'terminal'
  | 'user' | 'warning' | 'x'

const iconPaths: Record<IconName, ReactNode> = {
  arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7z"/>,
  bot: <><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  code: <><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12"/><circle cx="12" cy="12" r="2.5"/></>,
  file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h4"/></>,
  graph: <><circle cx="5" cy="16" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="19" cy="14" r="2"/><path d="m6 14 5-6M14 7l4 5M7 16h10"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  moon: <path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5z"/>,
  play: <path d="m8 5 11 7-11 7z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  report: <><path d="M5 3h14v18H5z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></>,
  shield: <><path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
  spark: <path d="m12 2 1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5z"/>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c.5-4 3-6 8-6s7.5 2 8 6"/></>,
  warning: <><path d="M12 3 2 21h20z"/><path d="M12 9v5M12 18h.01"/></>,
  x: <path d="m6 6 12 12M18 6 6 18"/>,
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>
}

const route = () => window.location.hash.slice(1) || '/'
function navigate(to: string) { window.location.hash = to }

function Button({ children, to, variant = 'primary', icon, type = 'button', disabled, onClick }: {
  children: ReactNode; to?: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName;
  type?: 'button' | 'submit'; disabled?: boolean; onClick?: () => void
}) {
  const cls = `btn btn-${variant}`
  if (to) return <a className={cls} href={`#${to}`}>{children}{icon && <Icon name={icon}/>}</a>
  return <button className={cls} type={type} disabled={disabled} onClick={onClick}>{children}{icon && <Icon name={icon}/>}</button>
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral'|'critical'|'high'|'medium'|'good'|'blue' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

function Card({ children, className = '', interactive = false }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return <div className={`card ${interactive ? 'card-interactive' : ''} ${className}`}>{children}</div>
}

function Logo({ compact = false }: { compact?: boolean }) {
  return <a href="#/" className="logo" aria-label="UIpocalypse home">
    <span className="logo-mark"><span/><span/><span/></span>
    {!compact && <span>UI<span>pocalypse</span></span>}
  </a>
}

function ThemeToggle({ theme, setTheme }: { theme: string; setTheme: (x: string) => void }) {
  return <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
    <Icon name={theme === 'dark' ? 'sun' : 'moon'}/>
  </button>
}

const nav = [
  ['How it works', '/how-it-works'], ['Features', '/features'], ['Personas', '/personas'],
  ['Safety', '/safety'], ['Docs', '/docs'], ['Pricing', '/pricing'],
]

function MarketingHeader({ theme, setTheme }: { theme: string; setTheme: (x: string) => void }) {
  const [open, setOpen] = useState(false)
  return <header className="site-header">
    <div className="nav-wrap">
      <Logo/>
      <nav className={`main-nav ${open ? 'open' : ''}`} aria-label="Main navigation">
        {nav.map(([label, to]) => <a key={to} href={`#${to}`} onClick={() => setOpen(false)}>{label}</a>)}
      </nav>
      <div className="nav-actions">
        <ThemeToggle theme={theme} setTheme={setTheme}/>
        <Button to="/app/projects" variant="ghost">App preview</Button>
        <Button to="/early-access">Get early access</Button>
        <button className="icon-btn mobile-menu" aria-label="Toggle menu" onClick={() => setOpen(!open)}><Icon name={open ? 'x' : 'menu'}/></button>
      </div>
    </div>
  </header>
}

function Footer() {
  return <footer className="footer">
    <div className="footer-grid">
      <div><Logo/><p>Break it here, not in production.</p><Badge tone="blue">Private beta</Badge></div>
      <div><strong>Product</strong><a href="#/features">Features</a><a href="#/personas">Personas</a><a href="#/safety">Safety</a><a href="#/benchmarks">Benchmarks</a></div>
      <div><strong>Learn</strong><a href="#/docs">Documentation</a><a href="#/blog">Changelog</a><a href="#/about">About & contact</a><a href="#/badge">Badge</a></div>
      <div><strong>Legal</strong><a href="#/terms">Terms</a><a href="#/privacy">Privacy</a><a href="#/404">404 page</a></div>
    </div>
    <div className="footer-bottom"><span>© 2025 UIpocalypse. Preview content.</span><span>Designed for test copies, never production.</span></div>
  </footer>
}

function MarketingShell({ children, theme, setTheme }: { children: ReactNode; theme: string; setTheme: (x: string) => void }) {
  return <><MarketingHeader theme={theme} setTheme={setTheme}/><main>{children}</main><Footer/></>
}

function Eyebrow({ children }: { children: ReactNode }) { return <div className="eyebrow"><span/> {children}</div> }
function SectionTitle({ eyebrow, title, copy, center = false }: { eyebrow?: string; title: string; copy?: string; center?: boolean }) {
  return <div className={`section-title ${center ? 'center' : ''}`}>
    {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}<h2>{title}</h2>{copy && <p>{copy}</p>}
  </div>
}

function BotVisual() {
  return <div className="hero-visual" aria-label="Illustration of bot agents testing an application">
    <div className="scan-line"/>
    <div className="visual-top"><span><i/> localhost:3000 / checkout</span><Badge tone="good">TEST COPY</Badge></div>
    <div className="mock-app">
      <div className="mock-sidebar"><b/><i/><i/><i/><i/></div>
      <div className="mock-content">
        <div className="mock-heading"/><div className="mock-copy"/>
        <div className="mock-cards"><span/><span/><span/></div>
        <div className="mock-form"><i/><i/><b/></div>
      </div>
      {[
        ['bot-a','W','Clicking everything'], ['bot-b','D','Double submit'], ['bot-c','R','Racing request']
      ].map(([c,l,t]) => <div className={`bot-chip ${c}`} key={c}><span>{l}</span>{t}</div>)}
      <div className="cursor cursor-a">↖</div><div className="cursor cursor-b">↖</div><div className="cursor cursor-c">↖</div>
    </div>
    <div className="visual-report">
      <div><span className="status-dot"/><strong>Finding clustered</strong><small>High confidence</small></div>
      <p>Double-submit on <code>POST /api/credits/buy</code> creates duplicate rows</p>
      <span className="sample-label">SAMPLE DATA</span>
    </div>
  </div>
}

const features = [
  ['code','Static code scan','Find dead handlers, risky writes, missing guards, and testable actions before the browser opens.'],
  ['bot','Chaos personas','Purpose-built agents wander, double-click, paste garbage, abandon flows, and race each other.'],
  ['bolt','Race detection','Coordinate simultaneous actions to expose duplicate writes and single-use resources used twice.'],
  ['graph','State coverage','See which states, routes, and actions were reached, skipped, blocked, or remain unknown.'],
  ['spark','Fix prompts','Copy evidence-rich prompts into Cursor, Claude Code, or the AI coding tool you already use.'],
] as const

function Landing() {
  const [faq, setFaq] = useState(0)
  return <>
    <section className="hero page-width">
      <div className="hero-copy">
        <Eyebrow>Local-first chaos testing for AI-built apps</Eyebrow>
        <h1>An apocalypse for your UI. <em>For the better.</em></h1>
        <p>Launch an army of chaotic bot users into a real browser, catch what actually breaks, and take fix-ready evidence back to your coding agent.</p>
        <div className="button-row"><Button to="/early-access" icon="arrow">Get early access</Button><Button to="/how-it-works" variant="secondary" icon="play">See how it works</Button></div>
        <div className="trust-row"><span><Icon name="lock"/> Runs locally</span><span><Icon name="shield"/> Test copies only</span><span><Icon name="code"/> Code stays yours</span></div>
      </div>
      <BotVisual/>
    </section>

    <section className="signal-strip">
      <div className="page-width"><span>BUILT FOR</span><b>Lovable</b><i>×</i><b>Bolt</b><i>×</i><b>Cursor</b><i>×</i><b>Claude Code</b><i>×</i><b>and your terminal</b></div>
    </section>

    <section className="section page-width">
      <SectionTitle eyebrow="The pipeline" title="From codebase to bug trail in four steps." copy="UIpocalypse reads what could happen, then sends specialized agents to find out what actually breaks."/>
      <div className="steps-grid">
        {[
          ['01','Scan the code','Map routes, actions, forms, mutations, and safety risks.'],
          ['02','Plan the swarm','Choose personas and paths with the best chance of finding breakage.'],
          ['03','Release the bots','Run real browser sessions against your local test copy.'],
          ['04','Get the report','Review clustered findings, evidence, coverage, and fix prompts.'],
        ].map(([n,t,d]) => <Card key={n}><span className="step-no">{n}</span><h3>{t}</h3><p>{d}</p></Card>)}
      </div>
    </section>

    <section className="section section-tint">
      <div className="page-width">
        <SectionTitle eyebrow="Purpose-built pressure" title="Not another happy-path test runner." copy="The swarm behaves like users who are fast, impatient, confused, and unfortunately very real."/>
        <div className="feature-bento">
          {features.map(([icon,title,copy],i) => <Card key={title} className={i === 1 ? 'wide-card' : ''}>
            <span className="feature-icon"><Icon name={icon}/></span><h3>{title}</h3><p>{copy}</p>
            {i === 1 && <div className="mini-personas"><span>WANDERER</span><span>DOUBLE-CLICKER</span><span>RACE RUNNER</span></div>}
          </Card>)}
        </div>
      </div>
    </section>

    <section className="section page-width split-section">
      <div>
        <SectionTitle eyebrow="Inside your coding agent" title="One prompt in. Fix prompts out." copy="Run UIpocalypse through MCP without leaving the tool where you built your app."/>
        <ul className="check-list"><li><Icon name="check"/> Point it at a local test copy</li><li><Icon name="check"/> Review the safety plan before launch</li><li><Icon name="check"/> Paste verified evidence into your next fix</li></ul>
        <Button to="/docs/mcp" variant="secondary" icon="arrow">Configure MCP</Button>
      </div>
      <CodeBlock code={`You: Test my checkout flow safely.\n\nAgent: I found the test target at localhost:3000.\nI will skip payments, deletes, and external links.\nStart a 5-agent local run?\n\n> Yes, launch the swarm.`}/>
    </section>

    <section className="section safety-band">
      <div className="page-width safety-grid">
        <div><Eyebrow>Safety is the first phase</Eyebrow><h2>Chaos, with a very short leash.</h2><p>Every run happens locally against a test copy. Destructive actions, external hosts, payments, and irreversible operations are skipped by default.</p><Button to="/safety" variant="secondary" icon="arrow">Read the safety model</Button></div>
        <div className="guard-card">
          <div className="guard-ring"><Icon name="shield" size={34}/></div>
          <div><span><Icon name="check"/> localhost allowed</span><span><Icon name="check"/> production blocked</span><span><Icon name="check"/> secrets redacted</span><span><Icon name="check"/> destructive actions skipped</span></div>
        </div>
      </div>
    </section>

    <section className="section page-width">
      <SectionTitle eyebrow="Clear boundaries" title="It finds breakage. It does not grade taste." center/>
      <div className="compare-grid">
        <Card><Badge tone="good">WHAT IT FINDS</Badge><ul><li>Dead buttons and unhandled errors</li><li>Duplicate writes and race conditions</li><li>Broken navigation and failed requests</li><li>Launch-safety holes visible in code</li><li>Actions the swarm could not reach</li></ul></Card>
        <Card><Badge tone="neutral">WHAT IT DOES NOT</Badge><ul className="muted-list"><li>Judge whether your design looks good</li><li>Decide if a flow feels confusing</li><li>Prove your app has no bugs</li><li>Replace security review or human QA</li><li>Run against your production app</li></ul></Card>
      </div>
    </section>

    <section className="section section-tint">
      <div className="page-width faq-wrap">
        <SectionTitle eyebrow="FAQ" title="Before you release the swarm."/>
        <div className="faq-list">{[
          ['Does UIpocalypse test production?','No. It is designed to run locally against a disposable test copy of your app. Production targets are blocked by default.'],
          ['Does my code leave my machine?','Your code and secrets stay local. If you configure an LLM key, only redacted summaries are sent to that provider. No-LLM mode is available.'],
          ['Can it tell me if my UX is confusing?','No. UIpocalypse reports things that break. It does not make subjective design or usability judgments.'],
          ['Is the hosted dashboard available?','Not yet. The dashboard shown here is a future product concept. Join the beta for the local tool and product updates.'],
        ].map(([q,a],i) => <div className={`faq-item ${faq === i ? 'active' : ''}`} key={q}><button onClick={() => setFaq(faq === i ? -1 : i)} aria-expanded={faq === i}>{q}<Icon name={faq === i ? 'x' : 'plus'}/></button>{faq === i && <p>{a}</p>}</div>)}</div>
      </div>
    </section>
    <FinalCTA/>
  </>
}

function FinalCTA() {
  return <section className="final-cta page-width"><div><Eyebrow>Private beta</Eyebrow><h2>Find the breakage before your users do.</h2><p>Bring a test copy. We’ll bring the chaos.</p></div><Button to="/early-access" icon="arrow">Get early access</Button></section>
}

function PageHero({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <section className="sub-hero page-width"><Eyebrow>{eyebrow}</Eyebrow><h1>{title}</h1><p>{copy}</p></section>
}

function HowItWorks() {
  const nodes = ['Code analyzer','Planner','Scouts','Swarm','Collector','Reviewer']
  return <>
    <PageHero eyebrow="Under the hood" title="A deliberate pipeline for controlled chaos." copy="UIpocalypse combines static analysis with coordinated browser agents, then turns noisy traces into a reviewable bug trail."/>
    <section className="section page-width">
      <div className="architecture">
        {nodes.map((n,i) => <div key={n} className="arch-node"><span><Icon name={i < 2 ? 'code' : i < 4 ? 'bot' : 'report'}/></span><b>{n}</b>{i < nodes.length-1 && <i><Icon name="arrow"/></i>}</div>)}
      </div>
      <div className="walkthrough">
        {[
          ['Inventory','The analyzer builds a local map of routes, controls, mutations, guards, and potential hazards.'],
          ['Plan','The planner proposes high-value paths and a safety envelope. You review skipped actions before launch.'],
          ['Scout','Low-cost scouts confirm what is reachable and record the initial state graph.'],
          ['Swarm','Specialized personas branch out, coordinate concurrency, and collect browser-level evidence.'],
          ['Collect','Related failures are clustered across agents so one root cause does not become twenty alerts.'],
          ['Review','The reviewer links evidence to likely files and produces a fix prompt—not an automatic code change.'],
        ].map(([t,d],i) => <div className="walk-row" key={t}><span>0{i+1}</span><div><h3>{t}</h3><p>{d}</p></div><Badge tone={i===3?'high':'neutral'}>{i===3?'LIVE BROWSERS':'LOCAL'}</Badge></div>)}
      </div>
    </section>
    <section className="section section-tint"><div className="page-width"><SectionTitle eyebrow="A sample run" title="Every phase explains itself."/><div className="timeline">{['Scan 0:00','Plan 0:18','Scout 0:31','Swarm 1:04','Report 4:20'].map((x,i)=><div key={x} className={i===3?'active':''}><span/><b>{x.split(' ')[0]}</b><small>{x.split(' ')[1]}</small></div>)}</div><Callout tone="info" title="Timing shown is sample data">Actual runtime depends on your app, hardware, agent count, and time budget.</Callout></div></section>
    <FinalCTA/>
  </>
}

function FeaturesPage() {
  return <>
    <PageHero eyebrow="Capabilities" title="Many ways to break. One report to fix from." copy="Static clues guide real browser exploration, while evidence and coverage keep every finding grounded."/>
    <section className="section page-width feature-list">
      {[
        ['code','Static rules','Surface dead event handlers, unsafe mutations, missing error boundaries, unguarded routes, and actions worth testing.','src/actions/credits.ts : 48'],
        ['bot','Chaos personas','Mix impatient, unpredictable, and concurrent behavior without pretending it is subjective UX review.','5 purpose-built behaviors'],
        ['bolt','Concurrency testing','Synchronize clicks and requests to probe idempotency, locking, coupon redemption, and duplicate writes.','20 concurrent redeems [sample]'],
        ['graph','State graph & coverage','Track visited states and exercised actions with explicit denominators—and explain every skip.','18 / 27 reachable actions [sample]'],
        ['report','Reports & diffs','Cluster findings, compare runs, and separate new, fixed, persistent, and intermittent failures.','3 new · 2 fixed [sample]'],
        ['spark','Fix prompts','Package reproduction steps, traces, code locations, and constraints for your AI coding tool.','Evidence included, fix not auto-applied'],
      ].map(([icon,title,copy,detail],i) => <div className="feature-row" key={title}><div className="feature-number">0{i+1}</div><span className="feature-icon"><Icon name={icon as IconName}/></span><div><h2>{title}</h2><p>{copy}</p></div><code>{detail}</code></div>)}
    </section><FinalCTA/>
  </>
}

const personas = [
  ['W','Wanderer','Takes plausible but unplanned paths, revisits screens, and clicks secondary actions.','Dead ends · broken navigation · stale state'],
  ['D','Double-Clicker','Clicks primary actions twice and retries before the UI can settle.','Duplicate writes · repeated charges · bad loading guards'],
  ['G','Garbage Paster','Pastes empty, huge, malformed, and surprising strings into form fields.','Unhandled errors · validation gaps · layout-breaking payloads'],
  ['A','Abandoner','Leaves multi-step flows halfway through, returns later, and resumes from odd states.','Orphaned drafts · expired state · broken resume flows'],
  ['R','Race Runner','Coordinates the same action across agents at nearly the same time.','Race conditions · single-use resource reuse · stale checks'],
]
function Personas() {
  return <><PageHero eyebrow="Meet the chaos crew" title="Built to behave badly. On purpose." copy="Each persona applies a narrow behavioral pressure. Combine them to match the failure modes you care about."/>
    <section className="section page-width persona-grid">{personas.map(([l,n,d,f],i)=><Card key={n} interactive><div className={`persona-art p${i}`}><span>{l}</span><i/><i/><b/></div><Badge tone="neutral">PERSONA 0{i+1}</Badge><h2>{n}</h2><p>{d}</p><div className="finds"><small>LIKELY TO FIND</small>{f}</div></Card>)}</section><FinalCTA/></>
}

function Safety() {
  return <><PageHero eyebrow="Safety & trust" title="Your test copy is the blast chamber." copy="The tool runs on your machine, against an environment you can throw away. Guardrails are visible before every run."/>
    <section className="section page-width">
      <div className="flow-diagram"><Card><Icon name="code" size={28}/><b>Your codebase</b><small>STAYS LOCAL</small></Card><Icon name="arrow"/><Card><Icon name="bot" size={28}/><b>Local runner</b><small>BROWSER + ANALYZER</small></Card><Icon name="arrow"/><Card><Icon name="report" size={28}/><b>Local report</b><small>EVIDENCE + FIX PROMPTS</small></Card></div>
      <div className="two-col-content">
        <div><h2>What leaves your machine?</h2><p>Nothing by default. In no-LLM mode, all analysis and browser control remain local.</p><p>If you explicitly set an LLM provider key, UIpocalypse can send redacted summaries to that provider. Source files, secrets, cookies, and raw environment variables are excluded.</p></div>
        <Callout tone="safe" title="Your key, your choice">LLM use is optional, clearly marked, and can be disabled per run. Provider handling is governed by the provider you choose.</Callout>
      </div>
    </section>
    <section className="section section-tint"><div className="page-width"><SectionTitle eyebrow="Default guard rules" title="Skipped unless you explicitly opt in."/><div className="rules-grid">{['Production-like hosts','Payments and purchases','Delete and bulk-delete actions','External domains','Emails, SMS, and webhooks','Database resets and migrations'].map(x=><Card key={x}><span className="rule-x"><Icon name="x"/></span><b>{x}</b><small>BLOCKED BY DEFAULT</small></Card>)}</div></div></section>
    <section className="section page-width"><SectionTitle title="Before launch, the plan is yours to approve."/><div className="safety-check"><div><Icon name="check"/><span><b>Target ownership confirmed</b><small>localhost:3000 · test environment</small></span></div><div><Icon name="check"/><span><b>Skipped actions reviewed</b><small>12 actions · 4 external hosts</small></span></div><div><Icon name="check"/><span><b>Destructive actions off</b><small>Explicit opt-in required</small></span></div><Button variant="secondary">Review run plan</Button></div></section>
  </>
}

function Benchmarks() {
  return <><PageHero eyebrow="Proof template" title="Benchmarks, without the theater." copy="This page is ready for reproducible results once they exist. Until then, every value is clearly marked as sample data."/>
    <section className="section page-width"><Callout tone="warn" title="All values below are placeholders">Do not use this table to evaluate product performance. Replace only with results from a published, repeatable methodology.</Callout>
      <div className="table-wrap"><table><thead><tr><th>Fixture</th><th>Known breakages</th><th>Found</th><th>False positives</th><th>Runtime</th></tr></thead><tbody>{['Sample checkout app','Sample account app','Sample credits app'].map(x=><tr key={x}><td>{x}</td><td>[sample]</td><td>[sample]</td><td>[sample]</td><td>[sample]</td></tr>)}</tbody></table></div>
      <div className="two-col-content"><div><h2>Methodology</h2><ol><li>Publish fixture source and planted defects.</li><li>Pin UIpocalypse version, models, and machine specs.</li><li>Run the same configuration multiple times.</li><li>Report denominators, misses, and variance.</li></ol></div><Callout tone="neutral" title="What this does not show">A benchmark cannot prove safety, complete coverage, zero bugs, or performance on your app. It also does not measure design or usability quality.</Callout></div>
    </section></>
}

function Pricing() {
  return <><PageHero eyebrow="Pricing" title="Start local. Grow into a team." copy="The local beta is the product today. Hosted collaboration is a future direction, not a feature you can buy yet."/>
    <section className="section page-width pricing-grid">
      <Card className="price-card"><Badge tone="good">PRIVATE BETA</Badge><h2>Local</h2><div className="price">Free <small>during beta</small></div><p>For vibecoders and small teams testing local copies.</p><ul><li>Local static scan</li><li>Browser swarm runs</li><li>Safety guardrails</li><li>Local reports and fix prompts</li><li>No-LLM mode</li></ul><Button to="/early-access">Join the beta</Button></Card>
      <Card className="price-card coming"><Badge tone="blue">COMING LATER</Badge><h2>Hosted team</h2><div className="price">TBD <small>not for sale</small></div><p>Potential collaboration features for teams.</p><ul><li>Run history</li><li>CI workflows</li><li>Shared reports</li><li>Team verdicts</li><li>Project trends</li></ul><Button disabled variant="secondary">Not yet available</Button></Card>
    </section>
    <section className="section page-width"><SectionTitle title="Pricing FAQ"/><div className="compare-grid"><Card><h3>Will the local tool stay available?</h3><p>The current plan is to offer a useful local tier. Final packaging may change as the beta teaches us what teams need.</p></Card><Card><h3>Can I buy the hosted version?</h3><p>No. The hosted dashboard is a product concept and the team tier is labeled “coming later” intentionally.</p></Card></div></section><FinalCTA/></>
}

function EarlyAccess() {
  const [sent,setSent]=useState(false)
  if(sent) return <section className="form-page page-width"><div className="confirmation"><span><Icon name="check" size={34}/></span><Eyebrow>Request received</Eyebrow><h1>You’re on the beta list.</h1><p>Thanks for volunteering your app as a controlled blast zone. We’ll follow up at the email you provided.</p><Button to="/">Back to home</Button></div></section>
  return <section className="form-page page-width">
    <div><Eyebrow>Private beta</Eyebrow><h1>Bring a test copy.<br/>We’ll bring the chaos.</h1><p>Tell us what you build with. Early access is reviewed in batches so we can support each setup properly.</p><div className="trust-stack"><span><Icon name="lock"/> No production targets</span><span><Icon name="code"/> Code and secrets stay local</span><span><Icon name="user"/> No spam or sold data</span></div></div>
    <form className="signup-form" onSubmit={e=>{e.preventDefault();setSent(true)}}>
      <h2>Request access</h2><Field label="Name" placeholder="Ada Lovelace"/><Field label="Work email" placeholder="ada@example.com" type="email"/>
      <label className="field"><span>Primary stack</span><select required defaultValue=""><option value="" disabled>Select a stack</option><option>React / Next.js</option><option>React / Vite</option><option>Vue / Nuxt</option><option>Other</option></select></label>
      <div className="field-pair"><Field label="Operating system" placeholder="macOS"/><Field label="How many apps?" placeholder="2"/></div>
      <fieldset><legend>Can you make a disposable test copy?</legend><label><input type="radio" name="copy" required/> Yes, locally</label><label><input type="radio" name="copy"/> I need help</label></fieldset>
      <label className="checkbox"><input type="checkbox" required/><span>I agree to receive beta updates and accept the <a href="#/privacy">privacy policy</a>.</span></label>
      <Button type="submit" icon="arrow">Request early access</Button>
    </form>
  </section>
}

function Field({label,placeholder,type='text'}:{label:string;placeholder:string;type?:string}) {
  return <label className="field"><span>{label}</span><input type={type} placeholder={placeholder} required/></label>
}

function CodeBlock({code}:{code:string}) {
  const [copied,setCopied]=useState(false)
  return <div className="code-block"><div><span/><span/><span/><small>terminal</small><button onClick={()=>{navigator.clipboard?.writeText(code);setCopied(true);setTimeout(()=>setCopied(false),1200)}}><Icon name="copy"/>{copied?'Copied':'Copy'}</button></div><pre>{code}</pre></div>
}

function Callout({tone,title,children}:{tone:'info'|'warn'|'safe'|'neutral';title:string;children:ReactNode}) {
  return <div className={`callout callout-${tone}`}><Icon name={tone==='warn'?'warning':tone==='safe'?'shield':'spark'}/><div><b>{title}</b><p>{children}</p></div></div>
}

const docNav = ['Quickstart','Make a safe test copy','What leaves your machine','MCP configuration','Scope and limits','FAQ']
function Docs({article='Quickstart'}:{article?:string}) {
  const slug=(x:string)=>x.toLowerCase().replaceAll(' ','-')
  return <div className="docs-layout page-width">
    <aside className="docs-side"><a href="#/docs" className="docs-title"><Icon name="file"/> Documentation</a><label className="search-box"><Icon name="search"/><input aria-label="Search docs" placeholder="Search docs…"/><kbd>⌘K</kbd></label><nav>{docNav.map(x=><a className={x===article?'active':''} href={`#/docs/${slug(x)}`} key={x}>{x}</a>)}</nav><Callout tone="safe" title="Local by design">Your app code stays on your machine.</Callout></aside>
    <article className="doc-article"><div className="breadcrumbs">DOCS / GETTING STARTED</div><h1>{article}</h1>
      {article==='Quickstart' ? <><p className="lede">Install UIpocalypse, prepare a disposable test copy, and launch a guarded first swarm.</p><Callout tone="warn" title="Do not point this at production">Use a local test copy with disposable data. UIpocalypse intentionally stresses actions and state.</Callout><h2>1. Install the local runner</h2><CodeBlock code="npx uipocalypse@beta init"/><h2>2. Start a disposable copy</h2><p>Use a separate database and test credentials. Confirm that payment, email, webhook, and deletion actions are disabled.</p><CodeBlock code={`# Example only\nTEST_MODE=true\nDATABASE_URL=postgres://localhost/myapp_chaos\nnpm run dev`}/><h2>3. Review, then run</h2><CodeBlock code="uipocalypse run http://localhost:3000 --review-plan"/><Callout tone="info" title="Next step">The runner will show the planned hosts, skipped actions, personas, and time budget before any bot opens a browser.</Callout></> :
      <DocArticleContent title={article}/>}
    </article>
    <aside className="on-page"><b>ON THIS PAGE</b><a href="#">Overview</a><a href="#">Configuration</a><a href="#">Guardrails</a><a href="#">Next steps</a></aside>
  </div>
}

function DocArticleContent({title}:{title:string}) {
  const copy:Record<string,[string,string]> = {
    'Make a safe test copy':['Clone the environment, not the risk.','Use disposable data, test-only credentials, and disable every integration that can affect a real person or account.'],
    'What leaves your machine':['Local first means local by default.','Code, secrets, browser storage, and raw traces remain local. Redacted summaries leave only when you configure an LLM key.'],
    'MCP configuration':['Run the swarm from your coding agent.','Connect the local MCP server, then ask your agent to prepare a reviewed run against a test target.'],
    'Scope and limits':['What the tool can—and cannot—tell you.','UIpocalypse finds observable breakage. It does not judge design quality, certify security, or prove the absence of bugs.'],
    'FAQ':['Answers without fine-print acrobatics.','Common questions about local execution, test targets, LLM use, reports, and beta access.'],
  }
  const [h,p]=copy[title]||['Documentation article','Practical guidance for safe chaos testing.']
  return <><p className="lede">{h}</p><p>{p}</p><h2>Overview</h2><p>Start with the narrowest possible target and a disposable data set. Review the run plan, then expand scope only after the first report is understood.</p><Callout tone="safe" title="Recommended default">Keep destructive actions and external hosts disabled. Prefer no-LLM mode when evaluating sensitive projects.</Callout><h2>Configuration</h2><CodeBlock code={`{\n  "target": "http://localhost:3000",\n  "destructiveActions": false,\n  "externalHosts": [],\n  "llm": "off"\n}`}/><h2>Limits</h2><p>A clean run means only that the configured agents did not observe breakage in the paths they reached during that run.</p></>
}

function Blog() {
  return <><PageHero eyebrow="Field notes" title="Changelog & dispatches." copy="Product updates, technical notes, and lessons from teaching bots to behave badly."/><section className="section page-width blog-grid">{[
    ['CHANGELOG','Beta runner 0.4: safer plans, clearer skips','The run plan now groups guarded actions by reason and makes external hosts easier to audit.','[sample date]'],
    ['ENGINEERING','Why twenty alerts might be one bug','How clustering turns repeated browser failures into a reviewable root-cause trail.','[sample date]'],
    ['GUIDE','A disposable test copy is part of the test','Practical boundaries for databases, webhooks, email, payments, and third-party services.','[sample date]'],
  ].map(([tag,t,d,date],i)=><a className="blog-card" href="#/blog/article" key={t}><div className={`blog-art art-${i}`}><Icon name={i===0?'bolt':i===1?'graph':'shield'} size={40}/></div><Badge tone="neutral">{tag}</Badge><h2>{t}</h2><p>{d}</p><small>{date} · [sample] min read</small></a>)}</section></>
}

function BlogArticle() {
  return <article className="article-page page-width"><div className="breadcrumbs">CHANGELOG / [SAMPLE DATE]</div><h1>Beta runner 0.4: safer plans, clearer skips</h1><p className="lede">This sample article layout shows how product updates explain both what changed and what remains limited.</p><div className="article-meta"><Badge tone="blue">CHANGELOG</Badge><span>UIpocalypse team</span><span>[sample] min read</span></div><div className="article-cover"><Icon name="bolt" size={64}/></div><h2>The run plan is now easier to audit</h2><p>Before browsers launch, actions are grouped by the guard that affects them. This makes it easier to see why a payment route, external host, or destructive control will not run.</p><blockquote>Skipped actions are coverage information—not missing data to hide.</blockquote><h2>What this does not change</h2><p>UIpocalypse still requires a disposable test copy and still blocks production-like targets by default. The tool finds observable breakage; it does not certify that your app is safe or bug-free.</p></article>
}

function About() {
  return <><PageHero eyebrow="About UIpocalypse" title="We want AI-built apps to survive contact with reality." copy="UIpocalypse is being built for the people shipping useful software faster than traditional test practices can keep up."/><section className="section page-width two-col-content"><div><h2>Why this exists</h2><p>AI tools can help small teams produce a surprising amount of software. But every generated button, mutation, and flow expands the surface that can break.</p><p>Our premise is simple: read the code for clues, behave worse than the happy path, and return evidence a coding agent can act on.</p></div><Card><Eyebrow>Contact</Eyebrow><h2>Have a strange app to test?</h2><p>We especially want to hear from teams with multi-step flows, credits, coupons, queues, or collaborative state.</p><Button to="/early-access">Talk to us</Button></Card></section></>
}

function Legal({type}:{type:'Terms'|'Privacy'}) {
  return <article className="legal page-width"><Eyebrow>Legal template</Eyebrow><h1>{type}</h1><p className="lede">Last updated: [placeholder date]</p><Callout tone="warn" title="Template content">This page is a designed placeholder and requires review by qualified legal counsel before publication.</Callout>{['Overview','Using the local tool',type==='Privacy'?'Data handling':'Acceptable use','Third-party providers','Limitations','Contact'].map(x=><section key={x}><h2>{x}</h2><p>[Placeholder legal copy.] This section will explain the applicable terms in clear language, including local processing, optional providers, test-only targets, responsibilities, retention, and user choices.</p></section>)}</article>
}

function NotFound({error=false}:{error?:boolean}) {
  return <section className="not-found page-width"><div className="glitch">{error?'500':'404'}<span>{error?'500':'404'}</span></div><Eyebrow>{error?'Something broke':'This route wandered off'}</Eyebrow><h1>{error?'The swarm hit an unexpected wall.':'Even the Wanderer couldn’t find this page.'}</h1><p>{error?'Your data is safe. Try again, or return to the dashboard.':'Check the URL or head back before the bots make it worse.'}</p><div className="button-row"><Button to={error?'/app/projects':'/'}>Return {error?'to projects':'home'}</Button><Button to="/docs" variant="secondary">Open docs</Button></div></section>
}

// PRODUCT APP
const appNav = [
  ['grid','Projects','/app/projects'],['play','New run','/app/new-run'],['report','Reports','/app/report'],
  ['graph','State graph','/app/graph'],['code','Static scan','/app/static-scan'],['settings','Settings','/app/settings'],
] as const

function AppShell({children, theme, setTheme}:{children:ReactNode;theme:string;setTheme:(x:string)=>void}) {
  const [sideOpen,setSideOpen]=useState(()=>localStorage.getItem('ui-side')==='open')
  const toggleSide=()=>{ setSideOpen(v=>{ localStorage.setItem('ui-side',v?'closed':'open'); return !v }) }
  return <div className={`app-shell ${sideOpen?'side-open':''}`}><aside className="app-side">
    <Logo compact={!sideOpen}/>
    <button className="side-toggle" onClick={toggleSide} aria-label={sideOpen?'Collapse sidebar':'Expand sidebar'} title={sideOpen?'Collapse sidebar':'Expand sidebar'}><Icon name="arrow"/></button>
    <nav>{appNav.map(([i,l,to])=><a href={`#${to}`} className={routeParts().path===to?'active':''} key={to}><Icon name={i}/><span>{l}</span></a>)}</nav>
    <div className="app-side-bottom"><a href="#/docs"><Icon name="file"/><span>Docs</span></a><ThemeToggle theme={theme} setTheme={setTheme}/><div className="avatar">AL</div></div>
  </aside><div className="app-main"><header className="app-top"><div><Badge tone="blue">LOCAL BETA</Badge><span>Dashboard · everything runs on this machine</span></div><Button to="/early-access" variant="secondary">Join beta</Button></header>{children}</div></div>
}

function AppPageHead({title,copy,actions}:{title:string;copy?:string;actions?:ReactNode}) {
  return <div className="app-page-head"><div><div className="breadcrumbs">ACME LAB / {title.toUpperCase()}</div><h1>{title}</h1>{copy&&<p>{copy}</p>}</div>{actions&&<div className="button-row">{actions}</div>}</div>
}

function Projects() {
  const [runs,setRuns]=useState<RunRow[]|null>(null)
  const [error,setError]=useState('')
  const project=loadProject()
  useEffect(()=>{ api.runs().then(r=>setRuns(r.runs)).catch(e=>setError(String(e.message??e))) },[])

  // one "project" per tested target, latest run first
  const projects=useMemo(()=>{
    if(!runs) return []
    const byTarget=new Map<string,RunRow[]>()
    for(const r of runs){ const k=r.target_url; byTarget.set(k,[...(byTarget.get(k)??[]),r]) }
    return [...byTarget.entries()].map(([url,rs])=>({ url, runs: rs.sort((a,b)=>b.id-a.id) }))
  },[runs])
  const openFindings=runs? runs.filter(r=>r.coverage!==null).length : 0
  return <div className="app-page"><AppPageHead title="Projects" copy={project?`${project.path} → ${project.url}`:'Test targets this workspace has run against.'} actions={<Button to="/app/onboarding" icon="plus">{project?'Switch project':'Connect project'}</Button>}/>
    {error&&<Callout tone="warn" title="Backend unreachable">{error} — is the UIpocalypse web server running?</Callout>}
    <div className="metric-grid">
      <Metric label="Targets tested" value={String(projects.length)} note={runs?'real data':'…'}/>
      <Metric label="Runs recorded" value={runs?String(runs.length):'…'} note={runs?'real data':'…'}/>
      <Metric label="Last run" value={runs&&runs.length?`#${Math.max(...runs.map(r=>r.id))}`:'—'} note={runs&&runs.length?new Date(runs[runs.length-1]!.started_at).toLocaleString():''}/>
    </div>
    {runs&&projects.length===0&&<Card><p style={{padding:'1rem'}}>No runs yet. Connect a project and start one from <a href="#/app/new-run">New run</a>.</p></Card>}
    <div className="project-grid">{projects.map(({url,runs:rs})=>{
      const latest=rs[0]!
      return <Card key={url} interactive>
        <div className="project-top"><span className="project-icon pi-0"><Icon name="terminal"/></span><span className="more">•••</span></div>
        <h2>{url.replace(/^https?:\/\//,'')}</h2>
        <p>{rs.length} run{rs.length===1?'':'s'} · {latest.agents} agents</p>
        <div className="project-meta">
          <Badge tone={latest.disabled_classes?'medium':'good'}>{latest.disabled_classes?'READ-ONLY RUN':'FULL RUN'}</Badge>
          <small>{new Date(latest.started_at).toLocaleString()}</small>
        </div>
        <div className="sparkline"><svg viewBox="0 0 240 50"><polyline points={rs.length>1?[...rs].reverse().map((r,i)=>`${(i/(rs.length-1))*240},${50-(r.coverage??0)*46}`).join(' '):'0,25 240,25'}/></svg></div>
        <Button to={`/app/report?run=${latest.id}`} variant="secondary">Open latest report</Button>
      </Card>})}</div>
  </div>
}

function Metric({label,value,note}:{label:string;value:string;note?:string}) {return <Card className="metric"><small>{label}</small><strong>{value}</strong>{note&&<span>{note}</span>}</Card>}

function ProjectOverview() {
  const project=loadProject()
  const [runs,setRuns]=useState<RunRow[]|null>(null)
  const [report,setReport]=useState<Report|null>(null)
  useEffect(()=>{ api.runs().then(r=>setRuns(r.runs)).catch(()=>{}) },[])
  const latest=useMemo(()=>runs?.[0]??null,[runs])
  useEffect(()=>{ if(latest) api.report(latest.id).then(r=>setReport(r.report)).catch(()=>{}) },[latest])
  const issues=report?.issues??[]
  const sevCount=(s:string)=>issues.filter(i=>i.severity===s).length
  return <div className="app-page"><AppPageHead title={project?project.url:'Latest target'} copy={project?project.path:'Most recent run in this workspace'} actions={latest?<><Button to={`/app/live-run`} icon="play">Run again</Button><Button to={`/app/report?run=${latest.id}`} variant="secondary">View report</Button></>:undefined}/>
    {!latest&&<Card><p style={{padding:'1rem'}}>No runs yet — start one from <a href="#/app/new-run">New run</a>.</p></Card>}
    {latest&&<><div className="metric-grid four">
      <Metric label="Latest run" value={`#${latest.id}`}/>
      <Metric label="Findings" value={report?String(issues.length):'…'} note={report?'real data':''}/>
      <Metric label="Action coverage" value={report?`${report.coverage.reachedActions}/${report.coverage.discoveredActions}`:'…'} note={report?`${Math.round(report.coverage.coverage*100)}%`:''}/>
      <Metric label="Last tested" value={new Date(latest.started_at).toLocaleString()}/>
    </div>
    <div className="dash-grid">
      <Card className="run-summary"><div className="card-head"><div><Badge tone="good">COMPLETED</Badge><h2>Run #{latest.id}</h2></div><small>{latest.duration_ms?`${(latest.duration_ms/1000).toFixed(0)}s`:'—'} · {latest.agents} agents</small></div>
        {report&&report.targetUnreachable&&<Callout tone="warn" title="Target unreachable">{report.targetUnreachable.refused} of {report.targetUnreachable.totalObservations} observations were connection-refused — the app was down. This run is not a bug list.</Callout>}
        {issues.slice(0,4).map(i=><div className="finding-preview" key={i.key}><Badge tone={i.severity==='high'?'high':i.severity==='critical'?'critical':i.severity==='medium'?'medium':'neutral'}>{i.severity.toUpperCase()}</Badge><div><b>{i.title}</b><small>{i.file??i.key} · {i.observations} obs</small></div><a href={`#/app/finding?run=${latest.id}&key=${encodeURIComponent(i.key)}`}><Icon name="arrow"/></a></div>)}
        {issues.length===0&&<p style={{padding:'.5rem 0'}}>{report?.summary??'…'}</p>}
      </Card>
      <Card><div className="card-head"><h2>Severity mix</h2><Badge tone="neutral">REAL</Badge></div><div className="donut-wrap"><div className="donut"><span>{issues.length}<small>total</small></span></div><div>
        <span><i className="crit"/> Critical {sevCount('critical')}</span><span><i className="hi"/> High {sevCount('high')}</span><span><i className="med"/> Medium {sevCount('medium')}</span><span><i/> Low {sevCount('low')}</span>
      </div></div></Card>
    </div></>}
  </div>
}

function NewRun() {
  const project=loadProject()
  const [path,setPath]=useState(project?.path??'')
  const [url,setUrl]=useState(project?.url??'')
  const [agents,setAgents]=useState(30)
  const [budget,setBudget]=useState(60)
  const [risky,setRisky]=useState(false)
  const [external,setExternal]=useState(false)
  const [modal,setModal]=useState(false)
  const [error,setError]=useState('')
  const [launching,setLaunching]=useState(false)
  const [status,setStatus]=useState<Status|null>(null)
  useEffect(()=>{ api.status().then(setStatus).catch(()=>{}) },[])

  const launch=async()=>{ 
    setLaunching(true); setError('')
    try{
      const {jobId}=await api.startRun({path:url&&path?path:'',url,agents,budgetSeconds:budget,optIn:{destructive:risky,externalSideEffects:external}})
      navigate(`/app/live-run?job=${jobId}`)
    }catch(e){ setError(String(e instanceof Error?e.message:e)); setLaunching(false) }
  }

  return <div className="app-page narrow-app"><AppPageHead title="Configure new run" copy={project?`${project.path} → ${project.url}`:'Set the repo path and the local target URL.'}/>
    <div className="config-layout"><div className="config-main">
      <Card><h2>Target</h2>
        <label className="field"><span>Repo path (for the static scan)</span><input value={path} onChange={e=>setPath(e.target.value)} placeholder="/home/you/code/my-app"/></label>
        <label className="field"><span>Test target URL</span><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="http://localhost:3000"/></label>
        {status&&<Callout tone="safe" title={status.llmMode}>{status.llmModeOn?'Redacted summaries go to your configured provider; code and secrets stay local.':'Fully local — mechanical report, zero LLM calls.'}</Callout>}
      </Card>
      <Card><h2>Run shape</h2><label className="range-label"><span>Browser agents <b>{agents}</b></span><input type="range" min="1" max="100" value={agents} onChange={e=>setAgents(+e.target.value)}/></label><label className="field"><span>Time budget</span><select value={budget} onChange={e=>setBudget(+e.target.value)}><option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={120}>2 minutes</option><option value={300}>5 minutes</option></select></label></Card>
      <Card><h2>Personas</h2><div className="toggle-grid">{personas.map(([l,n],i)=><label className="toggle-row" key={n}><span className="mini-avatar">{l}</span><b>{n}</b><input type="checkbox" checked disabled title="The full roster runs by default"/><i/></label>)}</div><small style={{opacity:.6}}>The full roster runs by default — narrowing it blinded duplicate detection once (phase-5 lesson).</small></Card>
      <Card className="danger-zone"><h2>Risk controls</h2>
        <Toggle label="Allow destructive actions" warning="May delete or permanently change test data." value={risky} setValue={(v)=>v?setModal(true):setRisky(false)}/>
        <Toggle label="Allow external actions" warning="May trigger webhooks, email, or third-party services." value={external} setValue={setExternal}/>
      </Card>
    </div><aside className="run-estimate"><Card><h3>Run estimate</h3><div><span>Agents</span><b>{agents}</b></div><div><span>Max duration</span><b>{budget>=60?`${budget/60} min`:`${budget}s`}</b></div><div><span>LLM mode</span><b>{status?(status.llmModeOn?'on':'off'):'…'}</b></div><div><span>Risk level</span><Badge tone={risky||external?'critical':'good'}>{risky||external?'ELEVATED':'GUARDED'}</Badge></div><Button onClick={launch} icon="play" disabled={launching||!path||!url}>{launching?'Launching…':'Review & launch'}</Button><small>Nothing runs until you launch. The Safety Guard checks the target first.</small>
    {error&&<Callout tone="warn" title="Launch failed">{error}</Callout>}
    </Card></aside></div>
    {modal&&<Modal title="Enable destructive actions?" onClose={()=>setModal(false)}><Callout tone="warn" title="This can permanently change test data">Only continue if this is a disposable test copy and you can restore its database.</Callout><label className="checkbox"><input type="checkbox"/><span>I understand this can delete test data.</span></label><div className="button-row"><Button variant="secondary" onClick={()=>setModal(false)}>Cancel</Button><Button variant="danger" onClick={()=>{setRisky(true);setModal(false)}}>Enable destructive actions</Button></div></Modal>}
  </div>
}

function Toggle({label,warning,value,setValue,defaultOn}:{label:string;warning:string;value?:boolean;setValue?:(x:boolean)=>void;defaultOn?:boolean}) {
  return <label className="risk-toggle"><div><b>{label}</b><small>{warning}</small></div><input type="checkbox" checked={value} onChange={e=>setValue?.(e.target.checked)} defaultChecked={value===undefined?defaultOn:undefined}/><i/></label>
}

function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.currentTarget===e.target)onClose()}}><div className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="card-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}><Icon name="x"/></button></div>{children}</div></div>
}

function LiveRun() {
  const {query}=routeParts()
  const jobId=Number(query.get('job')??0)
  const [events,setEvents]=useState<JobEvent[]>([])
  const [status,setStatus]=useState<'running'|'done'|'error'|'unknown'>('unknown')
  const [runId,setRunId]=useState<number|null>(null)
  const [error,setError]=useState('')
  const project=loadProject()

  useEffect(()=>{
    if(!jobId) return
    setStatus('running')
    const off=api.events(jobId,(ev)=>{
      setEvents(prev=>[...prev,ev])
      if(ev.type==='done'){ setStatus('done'); setRunId(ev.runId as number) }
      if(ev.type==='error'){ setStatus('error'); setError(String(ev.error)) }
    })
    api.job(jobId).then(j=>{ if(j.status!=='running'){ setStatus(j.status); setRunId(j.runId??null); if(j.error) setError(j.error) } }).catch(()=>{})
    return off
  },[jobId])

  const phases=['Scan','Plan','Scout','Swarm','Report']
  const phaseEvents=events.filter(e=>e.type==='phase').map(e=>e.phase as string)
  const activeIdx=phases.findIndex(p=>phaseEvents.includes(p))
  const started=events[0]?.at
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{ const t=setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(t) },[])
  const elapsed=started?Math.max(0,Math.round((now-started)/1000)):0
  const swarmEv=events.find(e=>e.type==='swarm') as {steps?:number}|undefined
  const feedEvents=events.filter(e=>e.type==='findings').slice(-1).flatMap(e=>(e as unknown as {findings:Array<{id:number;type:string;severity:string;evidence:Record<string,unknown>}>}).findings).slice(0,6)

  if(!jobId) return <div className="app-page"><AppPageHead title="No live run" copy="Start one from New run."/><Card><p style={{padding:'1rem'}}><a href="#/app/new-run">Configure a run</a> to watch it live.</p></Card></div>

  return <div className="app-page"><AppPageHead title={`Job #${jobId} — ${status==='running'?'running':status==='done'?'completed':'starting'}`} copy={project?project.url:''} actions={status==='done'&&runId?<Button to={`/app/report?run=${runId}`} icon="report">Open report</Button>:undefined}/>
    {error&&<Callout tone="warn" title="Run failed">{error}</Callout>}
    <div className="phase-bar">{phases.map((p,i)=><div className={status==='done'||i<activeIdx?'done':i===activeIdx?'active':''} key={p}><span>{phaseEvents.includes(p)?<Icon name="check"/>:i+1}</span><b>{p}</b><i/></div>)}</div>
    <div className="metric-grid four"><Metric label="Phase" value={activeIdx>=0?phases[activeIdx]!:'…'}/><Metric label="Steps executed" value={swarmEv?String(swarmEv.steps??'…'):'—'}/><Metric label="Live findings" value={String(feedEvents.length||'…')}/><Metric label="Elapsed" value={`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`} note="since first event"/></div>
    <div className="live-grid"><Card><div className="card-head"><h2>Agent swarm</h2><span className="live-dot">{status==='running'?'LIVE':'DONE'}</span></div><div className="agent-grid">{personas.map(([l,n],i)=><div className="agent-tile" key={n}><span className={`agent-face p${i}`}>{l}</span><div><b>{n}</b><small>{phaseEvents.includes('swarm')?'running':'queued'}</small></div><span className="pulse"/></div>)}</div></Card>
    <Card><div className="card-head"><h2>Live findings</h2><Badge tone="neutral">REAL</Badge></div><div className="feed">{feedEvents.map((f)=><div key={f.id}><span className={f.severity==='high'?'feed-high':'feed-med'}><Icon name="warning"/></span><div><b>{String(f.evidence.action??f.evidence.message??f.evidence.url??f.type)}</b><small>{f.type} · {f.severity}</small></div></div>)}{feedEvents.length===0&&<p style={{opacity:.6,padding:'.5rem'}}>Findings stream in during the swarm phase…</p>}</div></Card></div>
  </div>
}

function RunReport({shared=false}:{shared?:boolean}) {
  const {query}=routeParts()
  const [runs,setRuns]=useState<RunRow[]|null>(null)
  const [report,setReport]=useState<Report|null>(null)
  const [error,setError]=useState('')
  const requested=Number(query.get('run')??0)
  useEffect(()=>{ api.runs().then(r=>setRuns(r.runs)).catch(()=>{}) },[])
  const runId=requested||runs?.[runs.length-1]?.id||0
  const runRow=runs?.find(r=>r.id===runId)??null
  useEffect(()=>{ if(runId) api.report(runId).then(r=>setReport(r.report)).catch(e=>setError(String(e.message??e))) },[runId])
  const issues=report?.issues??[]
  const cov=report?.coverage
  const tone=(s:string)=>s==='high'?'high':s==='critical'?'critical':s==='medium'?'medium':'neutral'

  return <div className={shared?'shared-report page-width':'app-page'}>{shared&&<div className="shared-head"><Logo/><Badge tone="blue">SHARED REPORT</Badge></div>}<AppPageHead title={report?`Run report #${report.runId}`:'Run report'} copy={report?`${report.run.targetUrl} · ${report.run.agents} agents · ${new Date(report.run.startedAt??Date.now()).toLocaleString()}`:'loading…'} actions={!shared&&runId?<><Button to={`/app/graph?run=${runId}`} variant="secondary">State graph</Button><Button to={`/app/compare?run=${runId}`} variant="secondary">Compare run</Button></>:undefined}/>
    {error&&<Callout tone="warn" title="Report unavailable">{error}</Callout>}
    {report&&report.targetUnreachable&&<Callout tone="warn" title={report.targetUnreachable.mode==='never'?'THE TARGET WAS NEVER REACHABLE':'THE TARGET BECAME UNREACHABLE DURING THE RUN'}>{report.targetUnreachable.refused} of {report.targetUnreachable.totalObservations} observations were connection-refused{report.targetUnreachable.agentsAtCollapse?`, at ~${report.targetUnreachable.agentsAtCollapse} agents`:''} — this report is not a bug list.</Callout>}
    {report&&<Callout tone="info" title="Run scope">Tested {report.run.targetUrl} with {report.run.agents} browser agents in {(report.run.wallMs/1000).toFixed(0)}s.{report.skippedActions?.length?` ${report.skippedActions.length} action${report.skippedActions.length===1?'':'s'} were skipped by safety policy (listed below).`:''}{report.disabledClasses?.length?` Detection classes not run: ${report.disabledClasses.join(', ')}.`:''}</Callout>}
    <div className="report-summary">
      <Card><small>FINDINGS</small><strong>{issues.length}</strong><div className="severity-line">{issues.slice(0,6).map(i=><i key={i.key} className={i.severity}/>)}</div></Card>
      <Card><small>ACTION COVERAGE</small><strong>{cov?`${cov.reachedActions} / ${cov.discoveredActions}`:'…'}</strong><span>reachable actions exercised</span></Card>
      <Card><small>REVIEWED BY</small><strong className="small-value">{report?(report.reviewedBy==='llm'?'LLM':'mechanical template'):''}</strong><span>{report?.reviewReason??report?.run.llmModels??''}</span></Card>
      <Card><small>MACHINE</small><strong className="small-value">{report?.run.machine?`${report.run.machine.cores} cores`:'—'}</strong><span>{report?.run.machine?`${report.run.machine.cpu} · ${(report.run.machine.ramBytes/1024**3).toFixed(1)} GB RAM`:''}</span></Card>
    </div>
    {cov&&<div className="funnel"><div style={{width:'100%'}}>{cov.discoveredActions} discovered actions</div><div style={{width:`${cov.discoveredActions?Math.max(8,(cov.reachedActions+(report?.skippedActions?.length??0))/cov.discoveredActions*100):100}%`}}>{cov.reachedActions+(report?.skippedActions?.length??0)} safe to attempt</div><div style={{width:`${cov.discoveredActions?Math.max(4,cov.reachedActions/cov.discoveredActions*100):50}%`}}>{cov.reachedActions} exercised</div><div style={{width:`${cov.discoveredActions?Math.max(3,issues.length/cov.discoveredActions*100):10}%`}}>{issues.length} findings</div></div>}
    {report?.skippedActions&&report.skippedActions.length>0&&<Card><div className="card-head"><h2>Skipped by safety policy ({report.skippedActions.length}) — NOT TESTED</h2></div>{report.skippedActions.map(s=><div className="finding-preview" key={s.label}><Badge tone="neutral">SKIPPED</Badge><div><b>{s.label}</b><small>{s.reason}</small></div></div>)}</Card>}
    <div className="report-list"><div className="card-head"><h2>Findings by cluster</h2><div><Badge tone="neutral">Severity ↓</Badge><Badge tone="good">real data</Badge></div></div>
      {issues.map(i=><a href={`#/app/finding?run=${runId}&key=${encodeURIComponent(i.key)}`} className="finding-row" key={i.key}><Badge tone={tone(i.severity) as 'critical'|'high'|'medium'|'neutral'}>{i.severity.toUpperCase()}</Badge><div><b>{i.title}</b><small>{i.file?`${i.file}${i.line?':'+i.line:''}`:`${i.observations} observations`}</small></div><div className="confidence"><span>CONFIDENCE</span><b>{i.confidence}</b></div><div className="repro"><span>OBSERVATIONS</span><b>{i.observations}</b></div><Icon name="arrow"/></a>)}
      {report&&issues.length===0&&<p style={{padding:'1rem',opacity:.7}}>{report.summary}</p>}
    </div>
  </div>
}

function FindingDetail() {
  const {query}=routeParts()
  const runId=Number(query.get('run')??0)
  const findingKey=query.get('key')??''
  const [report,setReport]=useState<Report|null>(null)
  const [verdict,setVerdict]=useState('unsure'); const [toast,setToast]=useState(false)
  useEffect(()=>{ if(runId) api.report(runId).then(r=>setReport(r.report)).catch(()=>{}) },[runId])
  const issue=report?.issues.find(i=>i.key===findingKey)??null
  if(report&&!issue) return <div className="app-page"><AppPageHead title="Finding not found" copy={`No finding with key ${findingKey} in run #${runId}.`}/><Button to={`/app/report?run=${runId}`} variant="secondary">Back to report</Button></div>
  if(!report) return <div className="app-page"><AppPageHead title="Loading finding…"/></div>
  const sevTone=(s:string)=>s==='high'?'high':s==='critical'?'critical':s==='medium'?'medium':'neutral'
  const copyPrompt=()=>{ navigator.clipboard?.writeText(issue!.fixPrompt); setToast(true); setTimeout(()=>setToast(false),1800) }
  return <div className="app-page"><AppPageHead title={issue!.title} copy={`Run #${runId} · ${issue!.observations} observations`} actions={<Button icon="copy" onClick={copyPrompt}>Copy fix prompt</Button>}/>
    <div className="finding-badges"><Badge tone={sevTone(issue!.severity) as 'critical'|'high'|'medium'|'neutral'}>{issue!.severity.toUpperCase()}</Badge><Badge tone="good">{issue!.confidence.toUpperCase()} CONFIDENCE</Badge>{issue!.types.slice(0,2).map(t=><Badge tone="blue" key={t}>{t.replace(/_/g,' ').toUpperCase()}</Badge>)}<Badge tone="neutral">REAL DATA</Badge></div>
    <div className="finding-layout"><div>
      <Card><h2>What broke</h2><p>{issue!.rootCause}</p><Callout tone="warn" title="Paste into your coding agent">The fix prompt below carries the evidence your agent needs.</Callout><CodeBlock code={issue!.fixPrompt}/></Card>
      <Card><h2>Steps to reproduce</h2>{issue!.steps.length?<ol className="repro-steps">{issue!.steps.map((s,i)=><li key={i}><span>{i+1}</span><code>{s}</code></li>)}</ol>:<p style={{opacity:.6}}>No step trace recorded for this finding.</p>}</Card>
      <Card><div className="card-head"><h2>Evidence</h2><Badge tone="neutral">{issue!.evidence.length} SAMPLE{issue!.evidence.length===1?'':'S'}</Badge></div><CodeBlock code={issue!.evidence.map(e=>JSON.stringify(e,null,2)).join('\n\n')||'{}'}/></Card>
    </div><aside>
      {issue!.file&&<Card><small>AFFECTED CODE</small><h3>{issue!.file}{issue!.line?`:${issue!.line}`:''}</h3><a href="#/app/static-scan">Open in static scan <Icon name="arrow"/></a></Card>}
      <Card><h3>Your verdict</h3><p>Help future comparisons understand this finding.</p><div className="verdicts">{['real','false positive','unsure'].map(x=><button className={verdict===x?'active':''} onClick={()=>setVerdict(x)} key={x}>{x}</button>)}</div></Card>
    </aside></div>{toast&&<div className="toast"><Icon name="check"/> Fix prompt copied with evidence</div>}
  </div>
}

function StateGraph() {
  const {query}=routeParts()
  const [runs,setRuns]=useState<RunRow[]|null>(null)
  const [graph,setGraph]=useState<Graph|null>(null)
  useEffect(()=>{ api.runs().then(r=>setRuns(r.runs)).catch(()=>{}) },[])
  const runId=Number(query.get('run')??0)||runs?.[runs.length-1]?.id||0
  useEffect(()=>{ if(runId) api.graph(runId).then(setGraph).catch(()=>{}) },[runId])

  // layout: BFS layers from the first-discovered state; status from transitions + skip reasons
  const layout=useMemo(()=>{
    if(!graph) return null
    const visited=new Set<number>()
    for(const t of graph.transitions){ visited.add(t.from_state); visited.add(t.to_state) }
    const skippedStates=new Set(graph.actions.filter(a=>a.skip_reason).map(a=>a.state_id))
    const states=graph.states.map(s=>({ ...s, status: visited.has(s.id)?'visited':skippedStates.has(s.id)?'skipped':'unreached' }))
    const byId=new Map(states.map(s=>[s.id,s]))
    // BFS
    const depth=new Map<number,number>()
    const queue=states.length?[states[0]!.id]:[]
    if(queue.length) depth.set(queue[0]!,0)
    while(queue.length){
      const cur=queue.shift()!
      for(const t of graph.transitions.filter(t=>t.from_state===cur)){
        if(!depth.has(t.to_state)){ depth.set(t.to_state,depth.get(cur)!+1); queue.push(t.to_state) }
      }
    }
    for(const s of states) if(!depth.has(s.id)) depth.set(s.id,0)
    const maxDepth=Math.max(0,...[...depth.values()])
    const perDepth=new Map<number,number>()
    for(const s of states){ const d=depth.get(s.id)!; perDepth.set(d,(perDepth.get(d)??0)+1) }
    const pos=new Map<number,{x:number;y:number}>()
    const seenDepth=new Map<number,number>()
    for(const s of states){
      const d=depth.get(s.id)!
      const i=seenDepth.get(d)??0; seenDepth.set(d,i+1)
      const n=perDepth.get(d)!
      pos.set(s.id,{ x: maxDepth===0?50:8+(d/maxDepth)*84, y: n===1?50:14+((i+0.5)/n)*72 })
    }
    return { states, pos, status(s: typeof states[number]):string{ return s.status }, visitedCount: states.filter(s=>s.status==='visited').length }
  },[graph])

  return <div className="app-page graph-page"><AppPageHead title="State graph" copy={layout?`Run #${runId} · ${layout.visitedCount} of ${layout.states.length} discovered states visited`:`Run #${runId||'—'}`} actions={<Button to={`/app/report?run=${runId}`} variant="secondary">Back to report</Button>}/>
    <div className="graph-legend"><span><i className="visited"/>Visited</span><span><i className="unreached"/>Unreached</span><span><i className="skipped"/>Contains skipped actions</span></div>
    {!graph&&<Card><p style={{padding:'1rem'}}>No graph data{runId?'':' — no runs recorded yet.'}</p></Card>}
    {graph&&layout&&<div className="graph-canvas">
      <svg className="edges" viewBox="0 0 1000 560" preserveAspectRatio="none">
        {graph.transitions.map((t,i)=><path key={i} d={`M${(layout.pos.get(t.from_state)?.x??0)*10} ${(layout.pos.get(t.from_state)?.y??0)*5.6} C ${((layout.pos.get(t.from_state)?.x??0)+(layout.pos.get(t.to_state)?.x??0))*5} ${(layout.pos.get(t.from_state)?.y??0)*5.6} ${((layout.pos.get(t.from_state)?.x??0)+(layout.pos.get(t.to_state)?.x??0))*5} ${(layout.pos.get(t.to_state)?.y??0)*5.6} ${(layout.pos.get(t.to_state)?.x??0)*10} ${(layout.pos.get(t.to_state)?.y??0)*5.6}`}/>)}
      </svg>
      {layout.states.map(s=><div className={`graph-node ${s.status}`} style={{left:`${layout.pos.get(s.id)?.x??0}%`,top:`${layout.pos.get(s.id)?.y??0}%`}} key={s.id}>
        <small>{s.route??`state ${s.id}`}</small><b>{s.route??`state ${s.id}`}</b>
        <span>{s.status==='skipped'?'Skipped by policy':s.status==='unreached'?'Never reached':'Visited'}</span>
      </div>)}
    </div>}
  </div>
}

function CompareRuns() {
  const project=loadProject()
  const [runs,setRuns]=useState<RunRow[]|null>(null)
  const [diff,setDiff]=useState<Diff|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{ api.runs().then(r=>setRuns(r.runs)).catch(()=>{}) },[])
  useEffect(()=>{ if(runs&&runs.length>=2&&project){ api.diff(runs.map(r=>r.id),project.path).then(setDiff).catch(e=>setError(String(e.message??e))) } },[runs,project])
  const row=(tone:string,state:string,title:string,copy:string)=><Card className="diff-row" key={state+title}><Badge tone={tone as 'good'|'critical'|'high'|'medium'}>{state}</Badge><div><h3>{title}</h3><p>{copy}</p></div><Icon name="arrow"/></Card>
  return <div className="app-page"><AppPageHead title="Compare runs" copy={runs&&runs.length>=2?`#${runs[0]!.id} → #${runs[runs.length-1]!.id}`:'Needs at least two runs'}/>
    {error&&<Callout tone="warn" title="Diff failed">{error}</Callout>}
    {runs&&runs.length<2&&<Card><p style={{padding:'1rem'}}>At least two runs are needed to compare. Runs so far: {runs.length}.</p></Card>}
    {diff&&<><div className="compare-stats"><Metric label="Fixed" value={String(diff.fixed.length)}/><Metric label="New" value={String(diff.new.length)}/><Metric label="Still failing" value={String(diff.stillFailing.length)}/><Metric label="Intermittent" value={String(diff.intermittent.length)}/></div>
      {diff.fixed.map(f=>row('good','FIXED',f.title,'No longer reproduces in the latest runs'))}
      {diff.new.map(f=>row('critical','NEW',f.title,'First reproduced in the latest run'))}
      {diff.stillFailing.map(f=>row('high','STILL FAILING',f.title,'Reproduced in every compared run'))}
      {diff.intermittent.map(f=>row('medium','INTERMITTENT',f.title,'Reproduced in some runs only'))}
    </>}
  </div>
}

function StaticScan() {
  const project=loadProject()
  const [issues,setIssues]=useState<StaticIssue[]|null>(null)
  const [filter,setFilter]=useState('')
  const [error,setError]=useState('')
  useEffect(()=>{ if(project) api.scan(project.path).then(r=>setIssues(r.issues)).catch(e=>setError(String(e.message??e))) },[])
  const byRule=useMemo(()=>{ const m=new Map<string,number>(); for(const i of issues??[]) m.set(i.rule,(m.get(i.rule)??0)+1); return [...m.entries()].sort((a,b)=>b[1]-a[1]) },[issues])
  const [rule,setRule]=useState('all')
  const shown=(issues??[]).filter(i=>(rule==='all'||i.rule===rule)&&(!filter||i.file.includes(filter)))
  const sevTone=(s:string)=>s==='high'?'high':s==='critical'?'critical':s==='medium'?'medium':'neutral'
  return <div className="app-page"><AppPageHead title="Static scan" copy={issues?`${issues.length} rule hit${issues.length===1?'':'s'} across ${new Set(issues.map(i=>i.file)).size} file${new Set(issues.map(i=>i.file)).size===1?'':'s'} · ${project?.path??''}`:(project?'Scanning…':'Connect a project first')} actions={<Button to="/app/onboarding" variant="secondary">Change project</Button>}/>
    {error&&<Callout tone="warn" title="Scan failed">{error}</Callout>}
    <div className="scan-layout"><aside className="scan-rules">
      {([['all',String(issues?.length??0)] as [string,string],...byRule.map(([r,n])=>[r.replace(/-/g,' '),String(n)] as [string,string])]).map(([x,n])=><button className={rule===(x==='all'?'all':x)?'active':''} key={x} onClick={()=>setRule(x==='all'?'all':x)}><span>{x==='all'?'All rules':x}</span><Badge tone="neutral">{n}</Badge></button>)}
    </aside><Card><div className="card-head"><h2>Rule hits</h2><label className="search-box"><Icon name="search"/><input aria-label="Filter files" placeholder="Filter files…" value={filter} onChange={e=>setFilter(e.target.value)}/></label></div>
      {shown.map(i=><div className="scan-hit" key={`${i.file}:${i.line}:${i.rule}`}><Icon name="file"/><div><b>{i.file}:<mark>{i.line}</mark></b><p>{i.message}</p></div><Badge tone={sevTone(i.severity) as 'high'|'medium'|'critical'}>{i.severity.toUpperCase()}</Badge></div>)}
      {issues&&shown.length===0&&<p style={{opacity:.6,padding:'1rem'}}>No hits match the filter.</p>}
      {!project&&!issues&&<p style={{opacity:.6,padding:'1rem'}}>Connect a project (top right) to run the static rules.</p>}
    </Card></div></div>
}

function Settings() {
  const [status,setStatus]=useState<Status|null>(null)
  useEffect(()=>{ api.status().then(setStatus).catch(()=>{}) },[])
  const tabs=['LLM mode','Safety','Team','Billing']
  return <div className="app-page settings-page"><AppPageHead title="Settings" copy={status?`UIpocalypse ${status.version} · workspace ${status.workspace}`:'Local tool settings.'}/><div className="settings-layout"><nav>{tabs.map((x,i)=><button className={i===0?'active':''} key={x}>{x}</button>)}</nav><div>
    <Card><h2>LLM mode</h2><p className="lede-small"><b>First line:</b> LLM mode is optional. When on, redacted summaries are sent to the provider you configure; code and secrets stay local.</p>
      {status&&<Callout tone={status.llmModeOn?'info':'safe'} title={status.llmMode}>{status.llmModeOn?'The tool found a key and will use it — reports are LLM-reviewed.':'Fully local — every run is mechanical and nothing leaves this machine.'}</Callout>}
      <p className="lede-small">The key is read only from the MCP config <code>env</code> block or <code>~/.uipocalypse/config</code> — never from <code>.env</code> files in the working directory. Configure it in your MCP client, then restart the web UI.</p>
      <label className="field"><span>Current provider</span><input readOnly value={status?(status.llmModeOn?'configured (see key source above)':'none — local rules only'):''}/></label>
    </Card>
    <Card><h2>Machine</h2><p className="lede-small">Recorded on every run row and shown in every report header, so findings stay comparable across machines.</p>
      <div className="host-row"><span><Icon name="check"/></span><div><b>{status?`${status.machine.cpu} · ${status.machine.cores} cores · ${(status.machine.ramBytes/1024**3).toFixed(1)} GB RAM`:'…'}</b><small>This machine</small></div></div>
    </Card>
    <Card><h2>Allowed hosts & safety</h2><div className="host-row"><span><Icon name="check"/></span><div><b>localhost only (default)</b><small>The Safety Guard refuses anything not local unless allow-listed in uipocalypse.config.yaml</small></div></div><p className="lede-small">Destructive and external actions stay skipped unless you opt in per run (New run → Risk controls).</p></Card>
    <Card><div className="card-head"><h2>Team & billing</h2><Badge tone="blue">COMING LATER</Badge></div><p>Team members, shared run history, and billing belong to the future hosted product. They are not available in the local beta.</p><Button disabled variant="secondary">Manage plan</Button></Card>
  </div></div></div>
}

function Onboarding() {
  const [step,setStep]=useState(1)
  const [path,setPath]=useState('')
  const [url,setUrl]=useState('')
  const [checking,setChecking]=useState(false)
  const [check,setCheck]=useState<{ok:boolean; detail:string}|null>(null)
  const [disposable,setDisposable]=useState(false)
  const [guarded,setGuarded]=useState(true)

  const verify = async () => {
    if (!path.trim()) { setCheck({ok:false, detail:'Enter the absolute path to your app’s repo.'}); return }
    setChecking(true); setCheck(null)
    try {
      const scan = await api.scan(path.trim())
      setCheck({ok:true, detail:`Connected — static scan found ${scan.issues.length} rule hit${scan.issues.length===1?'':'s'} across ${scan.summary.routes} route${scan.summary.routes===1?'':'s'}.`})
    } catch (e) {
      setCheck({ok:false, detail:String(e instanceof Error ? e.message : e)})
    } finally { setChecking(false) }
  }

  const connect = () => {
    if (!path.trim() || !url.trim()) return
    saveProject({ path: path.trim(), url: url.trim() })
    navigate('/app/projects')
  }

  return <div className="onboarding"><Logo/><div className="onboard-progress">{[1,2,3].map(x=><span className={x<=step?'active':''} key={x}>{x}</span>)}</div><Card className="onboard-card">
    <Eyebrow>STEP {step} OF 3</Eyebrow>
    {step===1&&<><h1>Connect a project</h1><p>The absolute path to your app’s repo on this machine. Source files never leave it.</p>
      <label className="field"><span>Project folder (absolute path)</span><input value={path} onChange={e=>setPath(e.target.value)} placeholder="/home/you/code/my-app"/></label>
      <Button onClick={verify} disabled={checking}>{checking?'Scanning…':'Verify path'}</Button>
      {check&&<Callout tone={check.ok?'safe':'warn'} title={check.ok?'Path verified':'Could not scan that path'}>{check.detail}</Callout>}</>}
    {step===2&&<><h1>Set a test target</h1><p>This must be a disposable, non-production copy running locally.</p>
      <label className="field"><span>Target URL</span><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="http://localhost:3000"/></label>
      <Callout tone="safe" title="Local targets only">The Safety Guard refuses anything that is not localhost (or explicitly allow-listed).</Callout></>}
    {step===3&&<><h1>Safety checklist</h1><p>Confirm both items before connecting this project.</p>
      <label className="check-card"><input type="checkbox" checked={disposable} onChange={e=>setDisposable(e.target.checked)}/><span><b>This is a disposable test copy</b><small>I can restore its data if the test changes it.</small></span></label>
      <label className="check-card"><input type="checkbox" checked={guarded} onChange={e=>setGuarded(e.target.checked)}/><span><b>Keep guarded actions skipped</b><small>Deletes, payments, and external effects remain off unless I opt in per run.</small></span></label></>}
    <div className="onboard-actions">
      {step>1&&<Button variant="secondary" onClick={()=>setStep(step-1)}>Back</Button>}
      {step<3
        ? <Button onClick={()=>setStep(step+1)} icon="arrow" disabled={step===1&&!path.trim()}>Continue</Button>
        : <Button onClick={connect} icon="arrow" disabled={!disposable||!guarded||!path.trim()||!url.trim()}>Connect project</Button>}
    </div>
  </Card></div>
}

function Auth({mode}:{mode:'signin'|'signup'|'forgot'}) {
  const titles={signin:'Welcome back',signup:'Create your preview account',forgot:'Reset your password'}
  return <div className="auth-page"><div className="auth-brand"><Logo/><div><Eyebrow>Future hosted preview</Eyebrow><h1>Break it here.<br/>Not in production.</h1><p>The hosted dashboard shown here is a concept. Join the beta for the local tool.</p></div><small>Code and secrets stay local.</small></div><div className="auth-form"><Card><h2>{titles[mode]}</h2><p>{mode==='forgot'?'We’ll send a reset link if the account exists.':mode==='signin'?'Sign in to the dashboard preview.':'Hosted access is not publicly available yet.'}</p>{mode==='signup'&&<Field label="Name" placeholder="Ada Lovelace"/>}<Field label="Email" type="email" placeholder="you@example.com"/>{mode!=='forgot'&&<Field label="Password" type="password" placeholder="At least 12 characters"/>}<Button>{mode==='signin'?'Sign in':mode==='signup'?'Create account':'Send reset link'}</Button>{mode==='signin'&&<a href="#/forgot">Forgot password?</a>}<div className="auth-switch">{mode==='signin'?'No account?': 'Already have an account?'} <a href={mode==='signin'?'#/signup':'#/signin'}>{mode==='signin'?'Join the beta':'Sign in'}</a></div></Card></div></div>
}

function BadgePage() {
  return <><PageHero eyebrow="Optional badge" title="Checked by UIpocalypse." copy="A small, honest badge for teams who want to share the scope of a specific run—not imply certification."/><section className="section page-width badge-showcase"><div className="checked-badge"><Logo compact/><span>CHECKED BY <b>UIpocalypse</b><small>LOCAL CHAOS RUN · [SAMPLE DATE]</small></span></div><Card><h2>What the badge means</h2><p>A configured local run completed against a test copy. The linked report should state exactly what ran, what was skipped, and which findings remained.</p><Callout tone="warn" title="Not a certification">The badge does not prove security, quality, accessibility, or the absence of bugs.</Callout><CodeBlock code={`<a href="[report-url]">\n  <img src="[badge-url]" alt="Checked by UIpocalypse" />\n</a>`}/></Card></section></>
}

function Sitemap() {
  const groups=[['Marketing',['Home','How it works','Features','Personas','Safety','Benchmarks','Pricing','Early access']],['Learn',['Docs hub','Quickstart','Safe test copy','MCP configuration','Blog','Changelog']],['Product preview',['Auth','Onboarding','Projects','New run','Live run','Report','Finding detail','State graph','Compare runs','Static scan','Settings']],['Company',['About','Contact','Terms','Privacy','404','Error page']]]
  return <><PageHero eyebrow="Navigation map" title="Everything has a place." copy="A reference for the marketing, learning, and future product surfaces in this prototype."/><section className="section page-width sitemap-grid">{groups.map(([g,items])=><Card key={g as string}><h2>{g}</h2>{(items as string[]).map(x=><span key={x}><Icon name="arrow"/>{x}</span>)}</Card>)}</section></>
}

function App() {
  const {path:rawPath}=routeParts()
  const [path,setPath]=useState(rawPath)
  const [theme,setTheme]=useState(()=>localStorage.getItem('ui-theme')||'dark')
  useEffect(()=>{const fn=()=>{const p=routeParts();setPath(p.path);window.scrollTo(0,0)};window.addEventListener('hashchange',fn);return()=>window.removeEventListener('hashchange',fn)},[])
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('ui-theme',theme)},[theme])

  const content=useMemo(()=>{
    if(path==='/') return <Landing/>
    if(path==='/how-it-works') return <HowItWorks/>
    if(path==='/features') return <FeaturesPage/>
    if(path==='/personas') return <Personas/>
    if(path==='/safety') return <Safety/>
    if(path==='/benchmarks') return <Benchmarks/>
    if(path==='/pricing') return <Pricing/>
    if(path==='/early-access') return <EarlyAccess/>
    if(path==='/docs'||path==='/docs/quickstart') return <Docs/>
    if(path.startsWith('/docs/')) { const raw=path.split('/').pop()||''; const found=docNav.find(x=>x.toLowerCase().replaceAll(' ','-')===raw); return <Docs article={found||'Quickstart'}/> }
    if(path==='/blog') return <Blog/>
    if(path==='/blog/article') return <BlogArticle/>
    if(path==='/about') return <About/>
    if(path==='/terms') return <Legal type="Terms"/>
    if(path==='/privacy') return <Legal type="Privacy"/>
    if(path==='/badge') return <BadgePage/>
    if(path==='/sitemap') return <Sitemap/>
    if(path==='/error') return <NotFound error/>
    return path==='/404'?<NotFound/>:null
  },[path])

  if(path==='/signin'||path==='/signup'||path==='/forgot') return <Auth mode={path.slice(1) as 'signin'|'signup'|'forgot'}/>
  if(path==='/app/onboarding') return <Onboarding/>
  if(path.startsWith('/app')||path==='/share/report') {
    const page=path==='/app/projects'?<Projects/>:path==='/app/project'?<ProjectOverview/>:path==='/app/new-run'?<NewRun/>:path==='/app/live-run'?<LiveRun/>:path==='/app/report'?<RunReport/>:path==='/app/finding'?<FindingDetail/>:path==='/app/graph'?<StateGraph/>:path==='/app/compare'?<CompareRuns/>:path==='/app/static-scan'?<StaticScan/>:path==='/app/settings'?<Settings/>:<Projects/>
    return path==='/share/report'?<RunReport shared/>:<AppShell theme={theme} setTheme={setTheme}>{page}</AppShell>
  }
  return <MarketingShell theme={theme} setTheme={setTheme}>{content||<NotFound/>}</MarketingShell>
}

export default App
