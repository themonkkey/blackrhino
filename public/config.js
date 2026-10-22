// Deployment config. Forks: point historyApi at your own flight-history worker (see README "Self-hosting"),
// or set it to '' to run without history, live sharing and the OpenSky relay. Also update connect-src in vercel.json.
window.BR_CONFIG = {
  historyApi: 'https://flight-history.duospace-api.workers.dev',
  // public history reads go through Vercel's CDN (vercel.json rewrite /hist/*), so a traffic spike never reaches the worker's free quota
  historyRead: '/hist',
};
