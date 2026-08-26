#!/usr/bin/env python3
"""Captures the README screenshots from the live site.

gamedex is unauthenticated by design, so this shoots exactly what any visitor
sees. The order sheet's address / order / tracking columns are stripped
server-side and never reach the browser, so they cannot appear here either.

    pip install playwright && playwright install chromium
    python3 docs/capture/capture.py [base-url]    # default https://games.diemer.codes

Writes docs/shots/*.jpg -- JPEG, not PNG: these pages are wall-to-wall cover
art, and PNG made 20 MB of README images out of them.
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://games.diemer.codes").rstrip("/")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shots")
os.makedirs(OUT, exist_ok=True)

# The tabs live behind the hamburger; the home dashboard is its own view.
TABS = ["games", "shelf", "galaxy", "recs"]


def open_tab(page, tab):
    """Reveal the nav, pick a tab, and let the drawer close behind it."""
    page.click("#navToggle")
    page.wait_for_timeout(650)
    page.click(f'[data-tab="{tab}"]', timeout=8000)
    page.wait_for_timeout(900)


def settle(page, ms=3000):
    try:
        page.wait_for_load_state("networkidle", timeout=25000)
    except Exception:
        pass
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(ms)
    page.mouse.move(2, 2)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1500, "height": 950}, device_scale_factor=2)
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="load")
    settle(page, 6000)              # first load pulls the workbook + covers

    # The attract-mode overlay will happily wander into a screenshot.
    try:
        if page.locator("#attractClose").is_visible():
            page.click("#attractClose")
            page.wait_for_timeout(600)
    except Exception:
        pass

    page.screenshot(path=os.path.join(OUT, "home.jpg"), type="jpeg", quality=84)
    print(f"{'home':<10} dashboard")

    for tab in TABS:
        try:
            open_tab(page, tab)
        except Exception as e:
            print(f"{tab:<10} skipped ({type(e).__name__})")
            continue
        if tab == "galaxy":
            # 3,000 stars and 9,300 links: the force layout needs to converge
            # before it is worth photographing.
            try:
                page.wait_for_function(
                    "!document.body.innerText.includes('charting the galaxy')",
                    timeout=120000)
            except Exception:
                print(f"{tab:<10} (still charting; shot anyway)")
            page.wait_for_timeout(6000)
        settle(page)
        page.screenshot(path=os.path.join(OUT, f"{tab}.jpg"), type="jpeg", quality=84)
        print(f"{tab:<10} tab")

    # A detail drawer over the table.
    open_tab(page, "games")
    settle(page)
    try:
        page.locator(".card").first.click(timeout=8000)
        page.wait_for_selector("#drawer", timeout=8000)
        settle(page, 3500)
        page.screenshot(path=os.path.join(OUT, "drawer.jpg"), type="jpeg", quality=84)
        print(f"{'drawer':<10} detail")
    except Exception as e:
        print(f"{'drawer':<10} skipped ({type(e).__name__})")

    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                              is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="load")
    settle(page, 6000)
    try:
        if page.locator("#attractClose").is_visible():
            page.click("#attractClose"); page.wait_for_timeout(600)
    except Exception:
        pass
    page.screenshot(path=os.path.join(OUT, "mobile.jpg"), type="jpeg", quality=84)
    print(f"{'mobile':<10} 390x844")
    browser.close()
