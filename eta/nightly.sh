#!/bin/sh
# Nightly ETA model refresh (launchd com.blackrhino.eta-nightly):
#  1. stream yesterday's adsb.lol archive -> approaches at Indian airports (raw archive never stored)
#  2. delete approach files and METAR caches older than KEEP_DAYS (rolling window, nothing kept forever)
#  3. retrain; ship public/eta-model.json only if it still beats the physics estimate in leave-airports-out CV
set -e
cd "$(dirname "$0")"
KEEP_DAYS=${KEEP_DAYS:-30}
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
LOG=data/nightly.log
echo "=== $(date -u '+%F %T') ===" >> $LOG
for back in 1 2; do                                   # yesterday, plus a retry of the day before if it was missed
  DAY=$(date -u -v-${back}d '+%Y.%m.%d')
  .venv/bin/python extract.py "$DAY" >> $LOG 2>&1 || echo "extract $DAY failed (archive not published yet?)" >> $LOG
done
.venv/bin/python - "$KEEP_DAYS" >> $LOG <<'PY'
import glob, os, sys, datetime as dt
cut = dt.date.today() - dt.timedelta(days=int(sys.argv[1]))
for f in glob.glob('data/approaches-*.jsonl.gz'):
    if dt.date.fromisoformat(os.path.basename(f)[11:21]) < cut: os.remove(f); print('pruned', f)
PY
find data/live -name '*.jsonl' -mtime +$KEEP_DAYS -delete 2>/dev/null
find data -name 'metar-*.csv' -mtime +2 -delete
find data -name '*.part' -mtime +1 -delete
cp ../public/eta-model.json data/eta-model.prev.json 2>/dev/null || true
.venv/bin/python train.py >> $LOG 2>&1
# ship only if (1) the model beat physics in leave-airports-out CV (train.py wrote the file) and (2) the browser tree-walker reproduces sklearn
SHIP=$(.venv/bin/python -c "import json;print(int(json.load(open('report.json')).get('ship', False)))")
if [ "$SHIP" = "1" ] && .venv/bin/python parity.py >> $LOG 2>&1; then
  ../deploy.sh >> $LOG 2>&1 && echo "deployed new model" >> $LOG
else
  echo "gate or parity failed: restoring previous model, nothing deployed" >> $LOG
  cp data/eta-model.prev.json ../public/eta-model.json 2>/dev/null || true
fi
