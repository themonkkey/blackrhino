CREATE TABLE IF NOT EXISTS flights (
  key TEXT PRIMARY KEY,          -- day|callsign|hex
  day TEXT, cs TEXT, hex TEXT, reg TEXT, type TEXT, o TEXT, d TEXT,
  first INTEGER, last INTEGER,   -- unix seconds first/last seen by the recorder
  track TEXT                     -- "ts,lat,lon,altft;..." one point per recording
);
CREATE INDEX IF NOT EXISTS idx_cs ON flights(cs, day);
CREATE INDEX IF NOT EXISTS idx_o ON flights(day, o);
CREATE INDEX IF NOT EXISTS idx_d ON flights(day, d);
CREATE TABLE IF NOT EXISTS routes (cs TEXT PRIMARY KEY, o TEXT, d TEXT, t INTEGER);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS share (id TEXT PRIMARY KEY, key TEXT, created INTEGER, last INTEGER, meta TEXT);
CREATE TABLE IF NOT EXISTS share_pts (id TEXT, ts REAL, lat REAL, lon REAL, alt REAL, spd REAL, hdg REAL, acc REAL);
CREATE INDEX IF NOT EXISTS idx_share_pts ON share_pts(id, ts);
-- 2026-10 hardening (additive)
CREATE TABLE IF NOT EXISTS rl (k TEXT PRIMARY KEY, t INTEGER, n INTEGER);          -- rate limit: "kind|ip|hour" -> count, t = hour bucket (cron prunes)
CREATE TABLE IF NOT EXISTS share_cnt (id TEXT PRIMARY KEY, n INTEGER);             -- points stored per share (cap without COUNT(*))
CREATE INDEX IF NOT EXISTS idx_share_created ON share(created);
-- 2026-10-18 write budget: one snapshot row per 10-min run, folded into flights hourly
CREATE TABLE IF NOT EXISTS snap (t INTEGER PRIMARY KEY, v TEXT);
