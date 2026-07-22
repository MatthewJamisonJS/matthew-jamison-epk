# Remove website-build pricing — consulting $95/hr only

## Goal
Stop publishing a fixed $500 website-build price on the EPK. Web services show only the $95/hr consulting rate; full builds route to email inquiry. Session-bass pricing ($350 / $100) is unchanged by explicit decision. Copy stays lowercase (site voice) and keeps the "seo + aeo" keywords.

## Scope
Prices exist only in the services block (`index.html`, `#services` section). No structured data, meta tags, CSS, or JS mention prices. Research scratch files (`.firecrawl/*.md`, `substack-research.md`) are not site content and are untouched.

## Change
Web-services block inside `<div class="dev-body">` becomes:

```
need a website? i got you.
→ consulting: $95 / hr
→ full builds — domain, seo + aeo — email for quote
```

Removed lines: `$500 — domain (1 year) · full build · seo + aeo included` and `hire me to build — consulting hours come off the total`.

## BDD Scenarios
Story: publish consulting rate only for web services
In order to price builds per project, a visitor comparing services should see an hourly consulting rate, not a package price.

Scenario: web services show consulting rate only
  Given a visitor on the #services section
  When they read the web-services block
  Then they see "consulting: $95 / hr" and a full-builds line with no dollar amount, ending in "email for quote"

Scenario: bass pricing untouched
  Given the same visitor reads the session bass block
  Then "$350 — full session" and "$100 — single bass line" render exactly as before

Scenario: no stale build price anywhere
  Given the deployed page source
  When searched for "$500"
  Then there are zero matches

## Verification
`grep -c '\$500' index.html` returns 0; consulting and bass prices still present; services section renders correctly in browser; live site checked after Cloudflare Pages auto-deploy.
