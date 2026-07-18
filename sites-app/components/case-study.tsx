import manifest from '../../regressions/manifest.json';
import {
  parseSitesPublicConfig,
  parseSitesPublicEvidence,
} from '../lib/public-runtime';

const { entries: canonicalEntries } = manifest as {
  entries: Array<{ id: string; testId: string; expectedSignature: string }>;
};

const HOSTED_SCOPE_LIMITATION =
  'This hosted case study publishes commit-bound CI evidence. The synthetic checkout remains a local/source demonstration and is not exposed as a public account or payment service.';

function EvidenceAvailable({ evidence }: { evidence: Record<string, unknown> }) {
  const e = evidence as {
    baseline: { tests: number; retries: number };
    faults: Array<{ id: string }>;
    source: { commitSha: string; ciRunUrl: string; ciRunId: string };
    generatedAt: string;
  };

  return (
    <div className="evidence-panel" data-testid="live-evidence" aria-live="polite">
      <p>{e.baseline.tests} baseline tests passed with zero retries.</p>
      <p>{e.faults.length} of {canonicalEntries.length} synthetic regressions detected.</p>
      <ul>
        {canonicalEntries.map((f) => (
          <li key={f.id}>{f.id}</li>
        ))}
      </ul>
      <p>
        Commit <code>{e.source.commitSha}</code>
        {' · '}Generated{' '}
        <time dateTime={e.generatedAt}>
          {new Date(e.generatedAt).toLocaleString()}
        </time>
      </p>
      <p>
        <a href={e.source.ciRunUrl}>View CI run {e.source.ciRunId}</a>
      </p>
    </div>
  );
}

function EvidenceUnavailable() {
  return (
    <div className="evidence-panel" data-testid="live-evidence" aria-live="polite">
      <p>Evidence unavailable or incomplete</p>
    </div>
  );
}

function PublicationInputsMissing() {
  return (
    <main id="main-content" className="case-main" data-source-commit="unavailable">
      <section className="case-section" aria-labelledby="publication-contact-title">
        <p className="section-kicker">Publication inputs missing</p>
        <h2 id="publication-contact-title">Contact</h2>
        <p>Contact information is not yet configured.</p>
      </section>
    </main>
  );
}

export function CaseStudy() {
  const config = parseSitesPublicConfig(process.env as Record<string, string | undefined>);
  const evidence = parseSitesPublicEvidence(process.env as Record<string, string | undefined>);

  if (!config.publicationReady) {
    return <PublicationInputsMissing />;
  }

  const cfg = config as {
    publicationReady: true;
    contact: { url: string; label: string };
    offer: { name: string; summary: string };
  };

  const commitSha = evidence.available
    ? (evidence.evidence as Record<string, Record<string, string>>).source.commitSha
    : 'unavailable';

  return (
    <>
      <header className="case-header">
        <nav className="case-nav" aria-label="Primary navigation">
          <span className="case-brand">Revenue Flow Guard</span>
          <a href="https://github.com/RomainROCH/revenue-flow-guard">View source on GitHub</a>
        </nav>
      </header>

      <main id="main-content" className="case-main" data-source-commit={commitSha}>
        <section className="case-hero" aria-labelledby="case-study-title">
          <p className="case-kicker">Revenue Flow Guard</p>
          <h1 id="case-study-title">Protect the flow that pays you</h1>
          <p className="offer-name">{cfg.offer.name}</p>
          <p className="case-summary">{cfg.offer.summary}</p>
          <div className="proof-strip" aria-label="Case study proof points">
            <span>One critical journey</span>
            <span>Six controlled regressions</span>
            <span>Commit-bound evidence</span>
          </div>
        </section>

        <section className="case-section" aria-labelledby="risks-title">
          <p className="section-kicker">Control surface</p>
          <h2 id="risks-title">Risks demonstrated</h2>
          <ul className="risk-grid">
            <li className="risk-card">
              <h3>Authentication bypass</h3>
              <p>A server session remains the authority for access to checkout.</p>
            </li>
            <li className="risk-card">
              <h3>Client-controlled pricing</h3>
              <p>Server-owned totals prevent submitted client values from setting the charge.</p>
            </li>
            <li className="risk-card">
              <h3>Duplicate orders</h3>
              <p>Idempotent replay returns a consistent result without creating another order.</p>
            </li>
            <li className="risk-card">
              <h3>Empty-cart submission</h3>
              <p>An invalid cart is rejected before state changes occur.</p>
            </li>
            <li className="risk-card">
              <h3>Hidden payment decline</h3>
              <p>A fake decline stays visible while the cart remains preserved.</p>
            </li>
            <li className="risk-card">
              <h3>Missing pending-state control</h3>
              <p>The pending submission stays locked until the request resolves.</p>
            </li>
          </ul>
        </section>

        <section className="case-section" aria-labelledby="protection-title">
          <p className="section-kicker">Release control</p>
          <h2 id="protection-title">How protection works</h2>
          <ol className="architecture-flow">
            <li>
              <strong>browser/API tests</strong>
              <span>Exercise the commercial journey at both boundaries.</span>
            </li>
            <li>
              <strong>isolated state</strong>
              <span>Keeps each scenario independent and repeatable.</span>
            </li>
            <li>
              <strong>idempotent checkout</strong>
              <span>Keeps repeated requests consistent.</span>
            </li>
            <li>
              <strong>regression profiles</strong>
              <span>Turn controlled faults into explicit checks.</span>
            </li>
            <li>
              <strong>commit-bound CI evidence</strong>
              <span>Connects the recorded result to its source revision.</span>
            </li>
          </ol>
        </section>

        <section className="case-section" aria-labelledby="delivery-title">
          <p className="section-kicker">Working sequence</p>
          <h2 id="delivery-title">Delivery method</h2>
          <ol className="delivery-flow">
            <li>
              <strong>discovery</strong>
              <span>Trace the journey and its existing controls.</span>
            </li>
            <li>
              <strong>risk map</strong>
              <span>Connect failure modes to focused checks.</span>
            </li>
            <li>
              <strong>implementation/repair</strong>
              <span>Add the checks and repair the demonstrated gaps.</span>
            </li>
            <li>
              <strong>CI evidence</strong>
              <span>Record results against the tested commit.</span>
            </li>
            <li>
              <strong>handoff</strong>
              <span>Transfer the suite, evidence, and operating context.</span>
            </li>
          </ol>
        </section>

        <section className="case-section" aria-labelledby="deliverables-title">
          <p className="section-kicker">Sprint output</p>
          <h2 id="deliverables-title">What the sprint delivers</h2>
          <div className="deliverable-grid">
            <article>
              <h3>Risk map and test plan</h3>
              <p>A shared view of the journey, risks, and intended checks.</p>
            </article>
            <article>
              <h3>Maintainable test suite</h3>
              <p>Focused scenarios for the demonstrated revenue flow.</p>
            </article>
            <article>
              <h3>CI gate</h3>
              <p>A repeatable release check for the protected journey.</p>
            </article>
            <article>
              <h3>Sanitized evidence</h3>
              <p>Results that exclude real customer and production data.</p>
            </article>
            <article>
              <h3>Handoff</h3>
              <p>Context for operating and extending the delivered controls.</p>
            </article>
          </div>
        </section>

        <section className="case-section" aria-labelledby="evidence-title">
          <p className="section-kicker">Current signal</p>
          <h2 id="evidence-title">Live evidence</h2>
          {evidence.available ? (
            <EvidenceAvailable evidence={evidence.evidence as Record<string, unknown>} />
          ) : (
            <EvidenceUnavailable />
          )}
        </section>

        <section className="case-section" aria-labelledby="limitations-title">
          <p className="section-kicker">Evidence boundary</p>
          <h2 id="limitations-title">What this demo does not prove</h2>
          <div className="limitations-panel">
            <p>{HOSTED_SCOPE_LIMITATION}</p>
            <p>This demonstration uses synthetic controlled faults and no real customer or production data.</p>
            <p>It is not a measurement of business outcomes.</p>
          </div>
        </section>

        <section className="case-section case-cta" aria-labelledby="contact-title">
          <p className="section-kicker">{cfg.offer.name}</p>
          <h2 id="contact-title">Start a conversation</h2>
          <p>{cfg.offer.summary}</p>
          <a href={cfg.contact.url}>{cfg.contact.label}</a>
        </section>
      </main>

      <footer className="case-footer">
        <p>Revenue Flow Guard case study.</p>
      </footer>
    </>
  );
}
