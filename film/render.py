# usage: render.py shot [w h fps T steps] -> frames/<shot>/%04d.jpg
import sys, asyncio, base64, os, time
from playwright.async_api import async_playwright
shot = sys.argv[1]; w, h, fps, T, steps = (sys.argv[2:] + ['1600', '900', '24', '8', '110'])[:5] if len(sys.argv) > 2 else ('1600', '900', '24', '8', '110')
fps, T = int(fps), float(T); n = int(fps * T)
out = f'frames/{shot}'; os.makedirs(out, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': int(w), 'height': int(h)})
        await pg.goto(f'http://localhost:8671/studio.html?shot={shot}&w={w}&h={h}&steps={steps}&T={T}')
        await pg.wait_for_function('window.ready === true', timeout=120000)
        t0 = time.time()
        for i in range(n):
            d = await pg.evaluate(f'renderFrame({i / fps})')
            open(f'{out}/{i:04d}.jpg', 'wb').write(base64.b64decode(d.split(',')[1]))
        print(shot, n, 'frames', round(time.time() - t0, 1), 's')
        await b.close()
asyncio.run(main())
