// Logs into the running dev server with the throwaway test account, connects
// its linked Sleeper username, navigates to a hub, and screenshots it —
// for confirming visual/UI changes render correctly and didn't break
// anything. Requires the dev server already running (npm run dev).
//
// Usage:
//   node --env-file=.env.test.local scripts/visual-check.js ["Hub Name"] [output.png]
// or:
//   npm run visual-check -- "Trade Hub" tradehub.png
//
// Credentials come from .env.test.local (gitignored, not committed).

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.VISUAL_CHECK_URL || "http://localhost:3000";
const OUT_DIR = path.join(__dirname, "..", ".next", "visual-check");

const tab = process.argv[2] || "Dashboard";
const outName = process.argv[3] || `${tab.replace(/\s+/g, "-").toLowerCase()}.png`;

const EMAIL = process.env.TEST_ACCOUNT_EMAIL;
const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD;
const SLEEPER_USERNAME = process.env.TEST_ACCOUNT_SLEEPER_USERNAME;

if (!EMAIL || !PASSWORD) {
  console.error(
    "Missing TEST_ACCOUNT_EMAIL/TEST_ACCOUNT_PASSWORD.\n" +
      "Run with: node --env-file=.env.test.local scripts/visual-check.js"
  );
  process.exit(1);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(500);

  const emailInput = page.locator('input[type="email"], input[placeholder="Email" i]');
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(EMAIL);
    await page.fill('input[type="password"], input[placeholder="Password" i]', PASSWORD);
    await page.click('button:has-text("Sign In")');
    await page.waitForTimeout(2500);
  }

  const sleeperInput = page.locator('input[placeholder="Enter Sleeper username" i]');
  if (SLEEPER_USERNAME && (await sleeperInput.isVisible().catch(() => false))) {
    await sleeperInput.fill(SLEEPER_USERNAME);
    await page.click('button:has-text("Connect")');
    await page.waitForTimeout(8000);
  }

  if (tab === "Dashboard") {
    await page.waitForTimeout(15000); // cross-league dashboard data takes a while
  } else {
    const navLink = page.locator("nav").getByText(tab, { exact: true }).first();
    if (await navLink.isVisible().catch(() => false)) {
      await navLink.click();
      await page.waitForTimeout(3000);
    } else {
      console.warn(`Nav tab "${tab}" not found — screenshotting current page instead.`);
    }
  }

  const outPath = path.join(OUT_DIR, outName);
  await page.screenshot({ path: outPath, fullPage: true });

  console.log(`Screenshot saved: ${outPath}`);
  console.log("Console errors:", errors.length ? JSON.stringify(errors, null, 2) : "none");

  await browser.close();
})();
