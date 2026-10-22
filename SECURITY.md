# Security

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button
(Security tab of this repository), not in public issues. Include the endpoint or file, the steps,
and the impact. We aim to reply within a week.

In scope: the Vercel functions in `api/`, the Cloudflare Worker in `history-worker/`, the relay, and the
pages in `public/`. Out of scope: the upstream data services (adsb.fi, adsb.lol, OpenSky, adsbdb, Esri, EUMETSAT).

Never commit keys. Worker secrets (`RUN_KEY`, `INGEST_KEY`) live in `wrangler secret`, relay keys in env vars
or the macOS Keychain, and keys travel only in the `X-Key` header.
