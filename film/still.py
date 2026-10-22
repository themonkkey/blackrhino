# usage: still.py shot t out.jpg [w h steps]
import sys, asyncio, base64
from playwright.async_api import async_playwright
shot, t, out = sys.argv[1], sys.argv[2], sys.argv[3]
w, h, steps = (sys.argv[4:7] + ['1600', '900', '90'])[:3] if len(sys.argv) > 4 else ('1600', '900', '90')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'])
        pg = await b.new_page(viewport={'width': int(w), 'height': int(h)})
        pg.on('console', lambda m: print('console:', m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: print('pageerror:', e))
        await pg.goto(f'http://localhost:8671/studio.html?shot={shot}&w={w}&h={h}&steps={steps}')
        await pg.wait_for_function('window.ready === true', timeout=120000)
        d = await pg.evaluate(f'renderFrame({t})')
        open(out, 'wb').write(base64.b64decode(d.split(',')[1]))
        await b.close()
asyncio.run(main())
