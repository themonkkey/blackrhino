"""Parity: the browser's tree walker (same logic as public/eta.js predict) must reproduce sklearn's own predictions,
stored in the model file by train.py ('check'). Run after every training; nightly.sh refuses to ship on mismatch."""
import json, subprocess, sys
M = json.load(open('../public/eta-model.json'))
js = r'''
const M = JSON.parse(require('fs').readFileSync('../public/eta-model.json','utf8'));
function predict(m, x){ let s=m.base; for(const t of m.trees){ let i=0; for(;;){ const n=t[i]; if(n[4]){s+=n[5];break;} const v=x[n[0]]; i=(v!==v?n[6]:v<=n[1])?n[2]:n[3]; } } return s; }
console.log(JSON.stringify(M.check.x.map(x=>[predict(M.q50,x),predict(M.q10,x),predict(M.q90,x)])));
'''
r = subprocess.run(['node', '-e', js], capture_output=True, text=True)
if r.returncode: sys.exit(r.stderr[:500])
out = json.loads(r.stdout); worst = 0
for i, q in enumerate(('q50', 'q10', 'q90')):
    d = max(abs(o[i] - ref) for o, ref in zip(out, M['check'][q])); worst = max(worst, d)
    print(q, 'max |browser - sklearn| =', round(d, 3), 's')
print('PARITY', 'OK' if worst < 1.0 else 'FAIL'); sys.exit(0 if worst < 1.0 else 1)
