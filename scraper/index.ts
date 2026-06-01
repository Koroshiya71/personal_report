import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { parseRssFeeds } from './parser_rss';
import { fetchBilibiliShows } from './parser_bilibili';
import { fetchBangumiCalendar } from './parser_bangumi';
import { performSearch } from './search';
import { processReport, processWeeklyReport, FinalReport } from './llm_processor';

dotenv.config();

// Paths
const __dirname = path.resolve();
const configPath = path.join(__dirname, 'config.json');
const reportDir = path.join(__dirname, 'src', 'data');
const reportPath = path.join(reportDir, 'reports.json');
const weeklyPath = path.join(reportDir, 'weekly.json');

async function runCrawler() {
  console.log('==================================================');
  console.log('         AI REPORT CRAWLER & SYNTHESIZER          ');
  console.log('==================================================');
  console.log(`Starting crawl at: ${new Date().toLocaleString()}`);

  try {
    // 1. Load config
    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file config.json not found at ${configPath}`);
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const { location, preferences, sources } = config;

    console.log(`Configured location: ${location.primary} (Secondary: ${location.secondary})`);
    console.log(`Preferences loaded: Games: ${preferences.games.include_genres.join('/')}, Activities: ${preferences.offline_activities.categories.join('/')}`);

    // Load existing reports database first (needed for filtering and weekly aggregation)
    let existingReports: { [date: string]: FinalReport } = {};
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    if (fs.existsSync(reportPath)) {
      try {
        existingReports = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      } catch (e) {
        console.warn('[DB Warning] Existing reports.json was corrupt or empty. Re-initializing.');
      }
    }

    // 2. Fetch RSS feeds
    console.log('\n--- Step 1: Fetching RSS feeds ---');
    const rssItems = await parseRssFeeds(sources.rss);
    console.log(`Total RSS items collected: ${rssItems.length}`);

    // 3. Fetch Bangumi weekly calendar
    console.log('\n--- Step 2: Fetching Bangumi Anime Calendar ---');
    const animeCalendar = await fetchBangumiCalendar();
    console.log(`Total anime items collected: ${animeCalendar.length}`);

    // 4. Fetch Bilibili Member Purchase shows
    console.log('\n--- Step 3: Fetching Bilibili Shows ---');
    const cityCodes = {
      [location.primary]: location.primary_code,
      [location.secondary]: location.secondary_code
    };
    const bilibiliShows = await fetchBilibiliShows(cityCodes);
    console.log(`Total Bilibili shows collected: ${bilibiliShows.length}`);

    // 5. Filter offline events for the Daily Report: Keep only NEW events or STATUS CHANGES
    console.log('\n--- Step 4: Filtering events for Daily Report (Status changes only) ---');
    let dailyFilteredEvents = bilibiliShows;
    const sortedDates = Object.keys(existingReports).sort();
    if (sortedDates.length > 0) {
      const lastDate = sortedDates[sortedDates.length - 1];
      const lastReport = existingReports[lastDate];
      if (lastReport && lastReport.events) {
        dailyFilteredEvents = bilibiliShows.filter(show => {
          const prevShow = lastReport.events.find(e => e.id === show.id);
          if (!prevShow) return true; // Brand new show!
          return prevShow.status !== show.status; // Ticketing status changed! (e.g. from Presale to Sale)
        });
        console.log(`Filtered out ${bilibiliShows.length - dailyFilteredEvents.length} unchanged events. Keeping ${dailyFilteredEvents.length} new/changed events.`);
      }
    } else {
      console.log('No historical daily reports found. Keeping all crawled events.');
    }

    // 6. Execute searches for local shops
    console.log('\n--- Step 5: Performing Search Engine Queries ---');
    const tavilyKey = process.env.TAVILY_API_KEY || undefined;

    // Search query: Local shops (books, coffee, bars)
    const shopQuery = `${location.primary} 书店 咖啡店 清吧 推荐 探店`;
    const shopSearchResults = await performSearch(shopQuery, tavilyKey);

    // Search query for events (specifically for CPP同人展)
    const cppQuery = `site:allcpp.cn ${location.primary} ${location.secondary} 漫展 同人展`;
    const eventSearchResults = await performSearch(cppQuery, tavilyKey);

    // 7. Process Daily Report with AI
    console.log('\n--- Step 6: Processing & Summarizing Daily Report with AI ---');
    const dailyReport: FinalReport = await processReport(
      rssItems,
      animeCalendar,
      dailyFilteredEvents, // Only pass the new/status-changed events for the day
      shopSearchResults,
      eventSearchResults,
      preferences,
      location
    );

    // Save Daily Report
    existingReports[dailyReport.date] = dailyReport;
    fs.writeFileSync(reportPath, JSON.stringify(existingReports, null, 2), 'utf-8');
    console.log(`Successfully compiled and wrote daily report to: ${reportPath}`);

    // 8. Weekly report compilation logic
    const isWeeklyForced = process.argv.includes('--weekly');
    const isMonday = new Date().getDay() === 1;
    const generateWeekly = isWeeklyForced || isMonday;

    if (generateWeekly) {
      console.log('\n--- Step 7: Compiling Weekly Report ---');
      let existingWeekly: { [date: string]: any } = {};
      if (fs.existsSync(weeklyPath)) {
        try {
          existingWeekly = JSON.parse(fs.readFileSync(weeklyPath, 'utf-8'));
        } catch (e) {
          console.warn('[DB Warning] Existing weekly.json was corrupt. Re-initializing.');
        }
      }

      // Collect last 7 days of daily reports for weekly aggregation
      const pastDailyReports = Object.values(existingReports)
        .filter(rep => {
          const repDate = new Date(rep.date);
          const today = new Date();
          const diffTime = Math.abs(today.getTime() - repDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          return diffDays <= 7;
        });

      console.log(`Aggregating data from ${pastDailyReports.length} daily reports in the past week.`);

      const weeklyReport = await processWeeklyReport(
        pastDailyReports,
        animeCalendar,
        bilibiliShows, // Pass ALL upcoming shows for the full weekly calendar view
        shopSearchResults,
        preferences,
        location
      );

      existingWeekly[weeklyReport.date] = weeklyReport;
      fs.writeFileSync(weeklyPath, JSON.stringify(existingWeekly, null, 2), 'utf-8');
      console.log(`Successfully compiled and wrote weekly report to: ${weeklyPath}`);
    }

    console.log('==================================================');
    console.log('                 PROCESS COMPLETED                ');
    console.log('==================================================');

  } catch (error) {
    console.error('\n[Fatal Error] Scraper run crashed:', error);
    process.exit(1);
  }
}

runCrawler();
