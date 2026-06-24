import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:8099';
const SHOTS = '/tmp/portal_shots';

try { mkdirSync(SHOTS, { recursive: true }); } catch {}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', err => consoleErrors.push('PAGE ERROR: ' + err.message));

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  console.log(`Screenshot: ${SHOTS}/${name}.png`);
}

// ── 1. Atlas (default)
console.log('\n--- ATLAS ---');
await page.goto(BASE + '/#atlas', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const navLinks = await page.$$eval('nav.section-nav a', els => els.map(e => e.textContent.trim() + '|disabled=' + e.classList.contains('disabled')));
console.log('Nav links:', navLinks);

const atlasActive = await page.$eval('nav.section-nav a.active', e => e.textContent.trim()).catch(() => 'none');
console.log('Active nav:', atlasActive);

const atlasH1 = await page.$eval('#atlas-content h1', e => e.textContent.trim()).catch(() => 'not found');
console.log('Atlas h1:', atlasH1);

const subnavCount = await page.$$eval('#atlas-subnav a', els => els.length);
console.log('Atlas sub-nav links:', subnavCount);
await shot('1-atlas');

// ── 2. Matching
console.log('\n--- MATCHING ---');
await page.click('a[data-section="matching"]');
await page.waitForTimeout(2000);

const matchActive = await page.$eval('nav.section-nav a.active', e => e.textContent.trim()).catch(() => 'none');
console.log('Active nav:', matchActive);

const exButtons = await page.$$eval('.ex-btn', els => els.map(e => e.textContent.trim()));
console.log('Example buttons:', exButtons);

const faceImages = await page.$$eval('.face-img-wrap img', els => els.length);
console.log('Face images displayed:', faceImages);

const heatmapCells = await page.$$eval('.heatmap-cell', els => els.length);
console.log('Heatmap cells:', heatmapCells);

const nlBar = await page.$('#nl-bar');
console.log('Number line rendered:', !!nlBar);

const scoreValue = await page.$eval('.score-value', e => e.textContent.trim()).catch(() => 'not found');
console.log('Score value:', scoreValue);

await shot('2-matching-g1');

// Click through each example
for (let i = 1; i < 6; i++) {
  const btn = await page.$(`.ex-btn[data-idx="${i}"]`);
  if (btn) {
    await btn.click();
    await page.waitForTimeout(500);
    const sv = await page.$eval('.score-value', e => e.textContent.trim()).catch(() => '?');
    console.log(`Example ${i} score:`, sv);
  }
}
await shot('2-matching-i3');

const histCanvas = await page.$('#hist-canvas');
console.log('Histogram canvas:', !!histCanvas);

const embCanvas = await page.$('#emb-map-canvas');
console.log('Embedding map canvas:', !!embCanvas);

const slider = await page.$('#thr-slider');
console.log('Threshold slider:', !!slider);
if (slider) {
  await slider.fill('0.4');
  await page.waitForTimeout(300);
  const farVal = await page.$eval('#slider-far-val', e => e.textContent.trim()).catch(() => '?');
  console.log('FAR at threshold 0.4:', farVal);
}

// ── 3. Liveness
console.log('\n--- LIVENESS ---');
await page.click('a[data-section="liveness"]');
await page.waitForTimeout(2500);

const attackGrid = await page.$('#attack-grid');
console.log('Attack grid rendered:', !!attackGrid);

const attackImages = await page.$$eval('.attack-img-wrap img', els => els.length);
console.log('Attack images:', attackImages);

const livenessPrompt = await page.$eval('#liveness-prompt', e => e.textContent).catch(() => 'not found');
console.log('Liveness prompt:', livenessPrompt);

const attackItem = await page.$('.attack-item');
if (attackItem) {
  await attackItem.click();
  await page.waitForTimeout(300);
  const reveal = await page.$eval('#attack-reveal', e => ({
    visible: e.classList.contains('visible'),
    text: e.textContent.slice(0, 80)
  })).catch(() => null);
  console.log('Attack reveal:', reveal);
}
await shot('3-liveness');

// ── 4. Findings
console.log('\n--- FINDINGS ---');
await page.click('a[data-section="findings"]');
await page.waitForTimeout(2000);

const kpiCards = await page.$$eval('.metric-card', els => els.map(e => {
  const lbl = e.querySelector('.metric-label')?.textContent?.trim();
  const val = e.querySelector('.metric-value')?.textContent?.trim();
  return lbl + ': ' + val;
}));
console.log('KPI values:', kpiCards.slice(0, 6));

const rocCanvas = await page.$('#roc-canvas');
console.log('ROC canvas:', !!rocCanvas);
await shot('4-findings-roc');

const tabs = ['threshold', 'bias', 'vlm', 'cost', 'disagreement'];
for (const tab of tabs) {
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForTimeout(800);
  const active = await page.$eval('.tab-panel.active', e => e.id).catch(() => 'none');
  console.log(`Tab ${tab} → panel:`, active);
}
await shot('4-findings-disagreement');

// ── Try it live disabled check
const disabled = await page.$eval('.nav-link.disabled', e => ({
  text: e.textContent.trim().replace(/\s+/g, ' '),
  hasAria: e.getAttribute('aria-disabled'),
  hasComingSoon: !!e.querySelector('.coming-soon'),
})).catch(() => null);
console.log('Disabled slot:', disabled);

// ── Console errors
console.log('\n--- CONSOLE ERRORS ---');
console.log('Count:', consoleErrors.length);
consoleErrors.forEach(e => console.log(' ERR:', e));

await browser.close();
