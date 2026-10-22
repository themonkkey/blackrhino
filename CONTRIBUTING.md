# Contributing

Thanks for helping. A few ground rules keep BlackRhino simple and free to run:

- **No build step.** Plain HTML, CSS and ES modules. Libraries come from pinned CDN URLs.
- **Free tiers only.** Changes must fit Vercel Hobby and Cloudflare Workers Free + D1 (100k row writes/day).
  If a change adds requests to an upstream feed or writes to D1, say how many per day in the PR.
- **Be kind to the data sources.** adsb.fi allows about one request per second; never poll it from browsers.
- **Respect the licences.** Code is MIT; OpenStreetMap, VATSIM and adsb.lol derived files keep their own (see NOTICE.md).

## Run locally

```bash
python3 server.py      # http://localhost:8650
```

Before opening a PR:

```bash
npm run check          # syntax check of every JS file
```

Test the page you changed on a phone-sized window too. The 3D view has a debug hook with `?debug`
(`window.__skyline`), and demos at `/3d?demo=landing` and `/3d?demo=takeoff`.

## Reporting bugs

Open an issue with the page, browser and device, what you expected, and a screenshot. For a wrong aircraft or
route, include the callsign and time (IST). Security issues: see SECURITY.md, not public issues.
