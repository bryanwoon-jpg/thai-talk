"""Plays lessons headlessly at phone size and fails on any JavaScript error.

Usage: python3 scripts/smoke_test.py [lesson ids...]   (default: every lesson)
Needs Python Playwright and a Chromium/Chrome browser. Serves the repo on a local port.
"""
import asyncio, functools, http.server, os, re, shutil, sys, threading
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8799

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=ROOT)
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler).serve_forever()

async def play(pg, sid, mode):
    turns = await pg.evaluate(f"SCENES.find(s => s.id === '{sid}').turns.map(t => t.c.find(c => c[3] === 2)[1])")
    turns = [t.replace('{N}', 'Bryan') for t in turns]  # default learner name
    await pg.evaluate(f"ThaiTalk.startScene('{sid}', '{mode}')")
    for best in turns:
        if mode == 'choice':
            await pg.wait_for_selector('.choice .pick:not([disabled])', timeout=8000)
            await pg.locator('.choice .pick').filter(has=pg.locator('.ro', has_text=re.compile('^' + re.escape(best) + '$'))).first.click()
        else:
            await pg.wait_for_function("document.querySelector('.pool .tile') && !document.querySelector('.tray .tile')", timeout=8000)
            for w in [w.strip(',.!?') for w in best.split()]:
                await pg.locator('.pool .tile:not(.used)').filter(has_text=re.compile('^' + re.escape(w) + '$')).first.click()
            await pg.click('.panel .btn.primary:has-text("Check")')
        await pg.wait_for_timeout(250)
    await pg.wait_for_selector('#v-result.active', timeout=10000)
    stars = await pg.locator('.bigstars span').count()
    return stars

async def main(ids):
    threading.Thread(target=serve, daemon=True).start()
    exe = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=exe, args=['--no-sandbox']) if exe else await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(f'http://127.0.0.1:{PORT}/')
        await pg.wait_for_function("window.ThaiTalk && typeof SCENES !== 'undefined'")
        ids = ids or await pg.evaluate('SCENES.map(s => s.id)')
        for sid in ids:
            for mode in ('choice', 'tiles'):
                await play(pg, sid, mode)
                print(f'ok  {sid} ({mode})')
        await pg.goto(f'http://127.0.0.1:{PORT}/'); await pg.wait_for_timeout(500)
        await pg.screenshot(path=os.path.join(ROOT, '.smoke-home.png'))
        await b.close()
    if errs:
        print('JS errors:\n' + '\n'.join(errs)); sys.exit(1)
    print('smoke test passed')

asyncio.run(main(sys.argv[1:]))
