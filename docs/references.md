# References

These sources justify narrow engineering choices. They do not validate the demo's
commercial effectiveness or prove that the suite cannot be flaky.

## Framework authority

- **Microsoft, Playwright Best Practices.** Supports testing user-visible
  behavior, isolated tests, resilient locators, web-first assertions, controlled
  third-party dependencies, and browser projects. [Official documentation](https://playwright.dev/docs/best-practices).
- **Microsoft, Playwright Continuous Integration.** Supports browser installation
  in CI, a stability-first single-worker configuration, sharding as a separate
  scaling decision, and avoiding browser-binary caches. [Official documentation](https://playwright.dev/docs/ci).
- **Microsoft, Playwright Authentication.** Describes reusable authentication
  state and warns that stored browser state may contain sensitive cookies and
  headers. Revenue Flow Guard avoids committed authentication state. [Official documentation](https://playwright.dev/docs/auth).

## Scientific evidence

- **Qingzhou Luo, Farah Hariri, Lamyaa Eloussi, and Darko Marinov (2014),
  _An Empirical Analysis of Flaky Tests_, FSE.** Classifies observed flaky-test
  causes and motivates explicit isolation and diagnosis. It does not prove that a
  short repeated run establishes absence of flakiness. [DOI](https://doi.org/10.1145/2635868.2635920).
- **Xinyue Liu, Zihe Song, Weike Fang, Wei Yang, and Weihang Wang (2024),
  _WEFix: Intelligent Automatic Generation of Explicit Waits for Efficient Web
  End-to-End Flaky Tests_, WWW.** Evaluates condition-based wait generation for a
  defined set of UI flaky tests. It supports avoiding blanket fixed delays; it
  does not support a claim that this repository reduces flakiness by a universal
  percentage. [DOI](https://doi.org/10.1145/3589334.3645628).
- **Laura Inozemtseva and Reid Holmes (2014), _Coverage Is Not Strongly
  Correlated with Test Suite Effectiveness_, ICSE.** Shows why coverage alone is
  not a sufficient effectiveness target, motivating explicit fault-detection
  evidence. Synthetic regression proof is still not real-fault validation.
  [DOI](https://doi.org/10.1145/2568225.2568271).

## Claim policy

Present-state repository claims must point to executable code, a named test, or a
generated current-commit artifact. External sources may justify a method or
limitation, but they must not be rewritten as a measured outcome for this demo.
