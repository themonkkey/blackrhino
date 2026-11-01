#!/usr/bin/env python3
"""Tell Bing, Yandex and other IndexNow engines about every URL in the sitemap. Run AFTER deploying (the key file must be live).
   python3 scripts/indexnow.py"""
import json, os, re, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
key = open(os.path.join(ROOT, 'scripts', '.indexnow-key')).read().strip()
urls = re.findall(r'<loc>(.*?)</loc>', open(os.path.join(ROOT, 'public', 'sitemap.xml')).read())
body = json.dumps({'host': 'blackrhino.in', 'key': key, 'keyLocation': f'https://blackrhino.in/{key}.txt', 'urlList': urls}).encode()
req = urllib.request.Request('https://api.indexnow.org/indexnow', body, {'Content-Type': 'application/json; charset=utf-8'})
try:
    print('IndexNow', urllib.request.urlopen(req, timeout=30).status, len(urls), 'urls')
except Exception as e:
    print('IndexNow failed:', e)
