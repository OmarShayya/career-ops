#!/usr/bin/env node

/**
 * scan-scrape.mjs — Playwright-based job board scraper
 *
 * Scrapes Indeed, InfoJobs, and Tecnoempleo using headless Chromium.
 * Complements scan.mjs (API-based) with browser-rendered job boards.
 *
 * Runs sequentially (one browser page at a time) to avoid detection.
 *
 * Usage:
 *   node scan-scrape.mjs                    # scrape all enabled boards
 *   node scan-scrape.mjs --dry-run          # preview without writing files
 *   node scan-scrape.mjs --board indeed     # scrape a single board
 *   node scan-scrape.mjs --query "python"   # override search keyword
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import yaml from 'js-yaml';

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';

mkdirSync('data', { recursive: true });

const SCRAPE_TIMEOUT = 30_000;

// ── Args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const boardFlag = args.indexOf('--board');
const filterBoard = boardFlag !== -1 ? args[boardFlag + 1]?.toLowerCase() : null;
const queryFlag = args.indexOf('--query');
const customQuery = queryFlag !== -1 ? args[queryFlag + 1] : null;

// ── Title filter (reuse from portals.yml) ───────────────────────────

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());
  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

// ── Dedup (shared with scan.mjs) ────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();
  if (existsSync(SCAN_HISTORY_PATH)) {
    for (const line of readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n').slice(1)) {
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }
  if (existsSync(PIPELINE_PATH)) {
    for (const match of readFileSync(PIPELINE_PATH, 'utf-8').matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }
  if (existsSync(APPLICATIONS_PATH)) {
    for (const match of readFileSync(APPLICATIONS_PATH, 'utf-8').matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }
  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    for (const match of readFileSync(APPLICATIONS_PATH, 'utf-8').matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') seen.add(`${company}::${role}`);
    }
  }
  return seen;
}

// ── Pipeline + History writers ───────────────────────────────────────

function appendToPipeline(offers) {
  if (offers.length === 0) return;
  let text = readFileSync(PIPELINE_PATH, 'utf-8');
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    text = text.slice(0, insertAt) + `\n${marker}\n\n` +
      offers.map(o => `- [ ] ${o.url} | ${o.company} | ${o.title}`).join('\n') + '\n\n' +
      text.slice(insertAt);
  } else {
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;
    text = text.slice(0, insertAt) + '\n' +
      offers.map(o => `- [ ] ${o.url} | ${o.company} | ${o.title}`).join('\n') + '\n' +
      text.slice(insertAt);
  }
  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }
  const lines = offers.map(o =>
    `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded`
  ).join('\n') + '\n';
  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── LinkedIn state directory ─────────────────────────────────────────

const LINKEDIN_STATE_DIR = 'data/browser-profiles/linkedin';

// ── Scrapers ────────────────────────────────────────────────────────

async function scrapeLinkedIn(page, query) {
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=Spain&f_TPR=r86400&f_WT=2`;
  console.log(`  LinkedIn: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: SCRAPE_TIMEOUT });

  // If redirected to login, session expired
  if (/\/login|\/uas\/login/.test(page.url())) {
    console.log('  LinkedIn: Session expired — run with --linkedin-login to re-auth');
    return [];
  }

  await page.waitForSelector('ul.jobs-search__results-list, .jobs-search-results-list', { timeout: 15_000 }).catch(() => {});

  const cards = await page.$$eval(
    'ul.jobs-search__results-list li, li.jobs-search-results__list-item',
    (nodes) =>
      nodes.slice(0, 30).map((node) => {
        const a = node.querySelector('a.base-card__full-link, a.job-card-list__title');
        const title = node.querySelector('h3, .base-search-card__title')?.textContent?.trim() ?? '';
        const company = node.querySelector('.base-search-card__subtitle, .job-card-container__company-name')?.textContent?.trim() ?? '';
        const location = node.querySelector('.job-search-card__location, .job-card-container__metadata-item')?.textContent?.trim() ?? '';
        return { url: a?.href ?? '', title, company, location };
      })
  );

  return cards
    .filter(c => c.url && c.title)
    .map(c => ({
      title: c.title,
      url: c.url.split('?')[0], // strip tracking params
      company: c.company || 'Unknown',
      location: c.location || 'Spain',
      source: 'linkedin-scrape',
    }));
}

async function scrapeIndeed(page, query) {
  const searchUrl = `https://es.indeed.com/jobs?q=${encodeURIComponent(query)}&l=Spain&fromage=3`;
  console.log(`  Indeed: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: SCRAPE_TIMEOUT });

  // Cloudflare detection
  const cf = await page.$('iframe[src*="cloudflare"]');
  if (cf) {
    console.log('  Indeed: Cloudflare challenge detected — skipping');
    return [];
  }

  await page.waitForSelector('#mosaic-jobResults, .job_seen_beacon', { timeout: 15_000 }).catch(() => {});

  const cards = await page.$$eval('div.job_seen_beacon, td.resultContent', (nodes) =>
    nodes.slice(0, 30).map((node) => {
      const a = node.querySelector('h2 a, a.jcs-JobTitle');
      const title = node.querySelector('h2 span, .jobTitle')?.textContent?.trim() ?? '';
      const company = node.querySelector('[data-testid="company-name"], span.companyName')?.textContent?.trim() ?? '';
      const location = node.querySelector('[data-testid="text-location"], div.companyLocation')?.textContent?.trim() ?? '';
      return { url: a?.href ?? '', title, company, location };
    })
  );

  return cards
    .filter(c => c.url && c.title)
    .map(c => ({
      title: c.title,
      url: c.url,
      company: c.company || 'Unknown',
      location: c.location || 'Spain',
      source: 'indeed-scrape',
    }));
}

async function scrapeInfoJobs(page, query) {
  const searchUrl = `https://www.infojobs.net/jobsearch/search-results/list.xhtml?keyword=${encodeURIComponent(query)}`;
  console.log(`  InfoJobs: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: SCRAPE_TIMEOUT });

  // Cookie consent
  const cookieBtn = await page.$('#didomi-notice-agree-button');
  if (cookieBtn) await cookieBtn.click().catch(() => {});

  await page.waitForSelector('div.ij-OfferCardContent, ul.ij-List > li', { timeout: 15_000 }).catch(() => {});

  const cards = await page.$$eval('ul.ij-List > li, div.ij-OfferCardContent', (nodes) =>
    nodes.slice(0, 30).map((node) => {
      const a = node.querySelector('a.ij-OfferCardContent-description-title-link, a.ij-OfferCardContent-link');
      const title = node.querySelector('h2, .ij-OfferCardContent-description-title')?.textContent?.trim() ?? '';
      const company = node.querySelector('.ij-OfferCardContent-description-subtitle a, .ij-OfferCardContent-description-subtitle')?.textContent?.trim() ?? '';
      const location = node.querySelector('.ij-OfferCardContent-description-list li:first-child')?.textContent?.trim() ?? '';
      return { url: a?.href ?? '', title, company, location };
    })
  );

  return cards
    .filter(c => c.url && c.title)
    .map(c => ({
      title: c.title,
      url: c.url,
      company: c.company || 'Unknown',
      location: c.location || 'Spain',
      source: 'infojobs-scrape',
    }));
}

async function scrapeTecnoempleo(page, query) {
  const searchUrl = `https://www.tecnoempleo.com/ofertas-trabajo/?te=${encodeURIComponent(query)}`;
  console.log(`  Tecnoempleo: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: SCRAPE_TIMEOUT });

  await page.waitForSelector('div.p-3.border, article.p-3', { timeout: 15_000 }).catch(() => {});

  const cards = await page.$$eval('article.p-3, div.p-3.border', (nodes) =>
    nodes.slice(0, 30).map((node) => {
      const a = node.querySelector('a.font-weight-bold, h3 a');
      const title = node.querySelector('h3, a.font-weight-bold')?.textContent?.trim() ?? '';
      const company = node.querySelector('a.text-primary.link-muted, .text-primary')?.textContent?.trim() ?? '';
      const location = node.querySelector('.list-inline-item')?.textContent?.trim() ?? '';
      return { url: a?.href ?? '', title, company, location };
    })
  );

  return cards
    .filter(c => c.url && c.title)
    .map(c => {
      const fullUrl = c.url.startsWith('http') ? c.url : `https://www.tecnoempleo.com${c.url}`;
      return {
        title: c.title,
        url: fullUrl,
        company: c.company || 'Unknown',
        location: c.location || 'Spain',
        source: 'tecnoempleo-scrape',
      };
    });
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
  const titleFilter = buildTitleFilter(config.title_filter);
  const query = customQuery || config.scrape_query || 'backend engineer';

  const boards = [
    { name: 'LinkedIn', fn: scrapeLinkedIn, id: 'linkedin', needsAuth: true },
    { name: 'Indeed', fn: scrapeIndeed, id: 'indeed' },
    { name: 'InfoJobs', fn: scrapeInfoJobs, id: 'infojobs' },
    { name: 'Tecnoempleo', fn: scrapeTecnoempleo, id: 'tecnoempleo' },
  ].filter(b => !filterBoard || b.id === filterBoard);

  if (boards.length === 0) {
    console.error(`Unknown board: ${filterBoard}. Available: linkedin, indeed, infojobs, tecnoempleo`);
    process.exit(1);
  }

  console.log(`Scraping ${boards.length} job boards (query: "${query}")`);
  if (dryRun) console.log('(dry run -- no files will be written)\n');

  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();
  const date = new Date().toISOString().slice(0, 10);

  let totalFound = 0;
  let totalFiltered = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];

  // LinkedIn login mode: opens visible browser for manual login, saves session
  const linkedinLogin = args.includes('--linkedin-login');
  if (linkedinLogin) {
    mkdirSync(LINKEDIN_STATE_DIR, { recursive: true });
    console.log('\nOpening LinkedIn for manual login...');
    console.log('Log in, then close the browser window when done.\n');
    const loginBrowser = await chromium.launchPersistentContext(LINKEDIN_STATE_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
    });
    const loginPage = await loginBrowser.newPage();
    await loginPage.goto('https://www.linkedin.com/login');
    // Wait for user to close browser
    await loginBrowser.waitForEvent('close', { timeout: 300_000 }).catch(() => {});
    console.log('LinkedIn session saved. Run without --linkedin-login to scrape.\n');
    process.exit(0);
  }

  // Launch browser once, reuse for all scrapers (sequential)
  const hasLinkedIn = boards.some(b => b.id === 'linkedin');
  const linkedinStateExists = existsSync(join(LINKEDIN_STATE_DIR, 'Default'));

  let browser;
  let context;

  if (hasLinkedIn && linkedinStateExists) {
    // Use persistent context for LinkedIn (preserves login cookies)
    mkdirSync(LINKEDIN_STATE_DIR, { recursive: true });
    context = await chromium.launchPersistentContext(LINKEDIN_STATE_DIR, {
      headless: true,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    browser = null; // persistent context manages its own browser
  } else {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
  }

  for (const board of boards) {
    // Skip LinkedIn if no saved session
    if (board.id === 'linkedin' && !linkedinStateExists) {
      console.log(`  LinkedIn: No saved session — run with --linkedin-login first`);
      continue;
    }

    try {
      const page = await context.newPage();
      const jobs = await board.fn(page, query);
      await page.close();

      totalFound += jobs.length;
      console.log(`  ${board.name}: ${jobs.length} raw results`);

      for (const job of jobs) {
        if (!titleFilter(job.title)) { totalFiltered++; continue; }
        if (seenUrls.has(job.url)) { totalDupes++; continue; }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) { totalDupes++; continue; }
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        newOffers.push(job);
      }
    } catch (err) {
      errors.push({ board: board.name, error: err.message });
      console.log(`  ${board.name}: ERROR — ${err.message}`);
    }
  }

  if (browser) {
    await browser.close();
  } else {
    await context.close(); // persistent context
  }

  // Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);

    // Notify dashboard
    try {
      const payload = newOffers.map(o => ({
        title: o.title, company: o.company, url: o.url,
        source: o.source, location: o.location || undefined,
      }));
      await fetch('http://localhost:3000/api/jobs/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { /* dashboard not running */ }
  }

  // Summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Scraper Scan -- ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Boards scraped:        ${boards.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFiltered} removed`);
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`New offers added:      ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) console.log(`  ✗ ${e.board}: ${e.error}`);
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) console.log(`  + ${o.company} | ${o.title} | ${o.location}`);
    if (dryRun) {
      console.log('\n(dry run -- run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log('\n→ Run /career-ops pipeline to evaluate new offers.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
