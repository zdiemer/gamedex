"use strict";
/* Render the app in headless Chromium and save a screenshot. Driven entirely by env so
   shot.sh (or you) can aim it without editing code:

     SHOT_URL       page to open            (default http://localhost:18090/)
     SHOT_VIEWPORT  "WxH"                   (default 390x820 — a phone)
     SHOT_TAB       tab to switch to        (default "pick"; "" to stay on the landing view)
     SHOT_OUT       output png path         (default ./mobile-shot.png)
     SHOT_CLIP      element to crop to       (default ".pick-card"; "" = full page)
     SHOT_ROLL_CLICK / SHOT_ROLL_UNTIL      click a selector until another appears, N times
                    (defaults roll "Pick for me" until a prediction panel shows)

   Playwright is loaded from the setup work dir; the browser + its libs come from the env
   shot.sh exports (PLAYWRIGHT_BROWSERS_PATH, LD_LIBRARY_PATH, FONTCONFIG_FILE). */

const path = require("path");
const WORK = process.env.GAMEDEX_SHOT_HOME || path.join(process.env.HOME, ".cache/gamedex-shot");
const { chromium } = require(path.join(WORK, "node_modules/playwright"));

const URL = process.env.SHOT_URL || "http://localhost:18090/";
const [W, H] = (process.env.SHOT_VIEWPORT || "390x820").split("x").map(Number);
const TAB = process.env.SHOT_TAB ?? "pick";
const OUT = process.env.SHOT_OUT || "./mobile-shot.png";
const CLIP = process.env.SHOT_CLIP ?? ".pick-card";
const ROLL_CLICK = process.env.SHOT_ROLL_CLICK ?? (TAB === "pick" ? "#pickBtn" : "");
const ROLL_UNTIL = process.env.SHOT_ROLL_UNTIL ?? (TAB === "pick" ? ".pick-info .vd" : "");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem("gamedex.pickAnim", "0")); // skip the dice reveal
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.switchTab === "function");
  if (TAB) { await page.evaluate((t) => window.switchTab(t), TAB); }

  if (ROLL_CLICK && ROLL_UNTIL) {
    let ok = false;
    await page.waitForSelector(ROLL_CLICK, { timeout: 15000 });
    for (let i = 0; i < 25 && !ok; i++) {
      await page.click(ROLL_CLICK);
      await page.waitForTimeout(250);
      ok = await page.$(ROLL_UNTIL).then(Boolean).catch(() => false);
    }
    if (!ok) console.error(`warning: "${ROLL_UNTIL}" never appeared after 25 clicks`);
  } else if (ROLL_UNTIL) {
    await page.waitForSelector(ROLL_UNTIL, { timeout: 15000 }).catch(() => {});
  }

  const target = CLIP ? await page.$(CLIP) : null;
  await (target || page).screenshot({ path: OUT, fullPage: !CLIP && !target });
  console.log(`saved ${OUT}` + (target ? ` (cropped to ${CLIP})` : ""));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
