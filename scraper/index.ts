import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { parseRssFeeds } from './parser_rss';
import { fetchBilibiliShows } from './parser_bilibili';
import { fetchBangumiCalendar } from './parser_bangumi';
import { performSearch } from './search';
import { processReport, processWeeklyReport, selectHighValueRss, getShanghaiWeekday } from './llm_processor';
import type { FinalReport, WeeklyReport, ActivityItem, SearchResult, FeedbackSummary } from './llm_processor';

dotenv.config();

// Paths
const __dirname = path.resolve();
const configPath = path.join(__dirname, 'config.json');
const reportDir = path.join(__dirname, 'src', 'data');
const reportPath = path.join(reportDir, 'reports.json');
const weeklyPath = path.join(reportDir, 'weekly.json');
const feedbackPath = path.join(reportDir, 'feedback.json');

interface FeedbackEntry {
  type: 'favorite' | 'dislike' | 'more_like_this';
  itemTitle: string;
  itemCategory?: string;
  createdAt: string;
}

function loadFeedbackSummary(): FeedbackSummary {
  if (!fs.existsSync(feedbackPath)) {
    return { total: 0, favorites: [], dislikes: [], moreLikeThis: [] };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(feedbackPath, 'utf-8')) as { entries?: FeedbackEntry[] };
    const entries = Array.isArray(raw.entries) ? raw.entries.slice(-80) : [];
    const pick = (type: FeedbackEntry['type']) => entries
      .filter((entry) => entry.type === type && entry.itemTitle)
      .slice(-8)
      .map((entry) => `${entry.itemTitle}${entry.itemCategory ? ` (${entry.itemCategory})` : ''}`);

    return {
      total: entries.length,
      favorites: pick('favorite'),
      dislikes: pick('dislike'),
      moreLikeThis: pick('more_like_this')
    };
  } catch {
    console.warn('[Feedback] feedback.json is corrupt or unreadable. Ignoring feedback for this run.');
    return { total: 0, favorites: [], dislikes: [], moreLikeThis: [] };
  }
}

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
    const feedbackSummary = loadFeedbackSummary();

    console.log(`Configured location: ${location.primary} (Secondary: ${location.secondary})`);
    console.log(`Preferences loaded: Games: ${preferences.games.include_genres.join('/')}, Activities: ${preferences.offline_activities.categories.join('/')}`);
    console.log(`[Feedback] Loaded ${feedbackSummary.total} recent feedback entries.`);

    // Load existing reports database first (needed for filtering and weekly aggregation)
    let existingReports: { [date: string]: FinalReport } = {};
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    if (fs.existsSync(reportPath)) {
      try {
        existingReports = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      } catch {
        console.warn('[DB Warning] Existing reports.json was corrupt or empty. Re-initializing.');
      }
    }

    // Extract seen links and titles to avoid duplicates in daily reports
    const seenLinks = new Set<string>();
    const seenTitles = new Set<string>();
    Object.values(existingReports).forEach((report) => {
      const addSeen = (item: { title: string; link?: string }) => {
        if (item) {
          seenTitles.add(item.title.trim());
          if (item.link) seenLinks.add(item.link.trim());
        }
      };
      if (report.games_primary) report.games_primary.forEach(addSeen);
      if (report.games_secondary) report.games_secondary.forEach(addSeen);
      if (report.tech_primary) report.tech_primary.forEach(addSeen);
      if (report.tech_secondary) report.tech_secondary.forEach(addSeen);
    });

    // 2. Fetch RSS feeds
    console.log('\n--- Step 1: Fetching RSS feeds ---');
    const rawRssItems = await parseRssFeeds(sources.rss);
    const rssItems = rawRssItems.filter(item => {
      const cleanLink = item.link ? item.link.trim() : '';
      const cleanTitle = item.title ? item.title.trim() : '';
      return !seenLinks.has(cleanLink) && !seenTitles.has(cleanTitle);
    });
    console.log(`Total RSS items collected: ${rawRssItems.length}, filtered down to ${rssItems.length} new items.`);

    // 3. Fetch Bangumi weekly calendar
    console.log('\n--- Step 2: Fetching Bangumi Anime Calendar ---');
    let animeCalendar = await fetchBangumiCalendar();
    console.log(`Total anime items collected: ${animeCalendar.length}`);
    
    // Save standalone weekly anime calendar to save space in reports and weekly databases
    const animeCalendarPath = path.join(reportDir, 'anime_calendar.json');
    if (animeCalendar && animeCalendar.length > 0) {
      fs.writeFileSync(animeCalendarPath, JSON.stringify(animeCalendar, null, 2), 'utf-8');
      console.log(`Successfully wrote standalone weekly anime calendar to: ${animeCalendarPath}`);
    } else {
      console.warn('[Warning] Bangumi calendar was empty or failed to fetch. Loading from existing cache.');
      if (fs.existsSync(animeCalendarPath)) {
        try {
          animeCalendar = JSON.parse(fs.readFileSync(animeCalendarPath, 'utf-8'));
          console.log(`Successfully loaded ${animeCalendar.length} items from existing cache.`);
        } catch {
          console.error('[Error] Existing anime_calendar.json was corrupt.');
        }
      }
    }

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
        dailyFilteredEvents = bilibiliShows.filter((show: ActivityItem) => {
          const prevShow = lastReport.events.find((e: ActivityItem) => e.id === show.id);
          if (!prevShow) return true; // Brand new show!
          return prevShow.status !== show.status; // Ticketing status changed! (e.g. from Presale to Sale)
        });
        console.log(`Filtered out ${bilibiliShows.length - dailyFilteredEvents.length} unchanged events. Keeping ${dailyFilteredEvents.length} new/changed events.`);
      }
    } else {
      console.log('No historical daily reports found. Keeping all crawled events.');
    }

    // 6. Execute searches for local shops
    console.log('\n--- Step 5: Performing Search Engine Queries (Advanced Strategies A, B, C, D) ---');
    const tavilyKey = process.env.TAVILY_API_KEY || undefined;

    // --- Strategy A: Query Specialization & Multi-Dimension Expansion ---
    // Fine-grained shop search queries
    const shopQueries = [
      `${location.primary} 新开 咖啡店 精品咖啡 推荐 探店`,
      `${location.primary} 氛围感 清吧 威士忌 推荐 探店`,
      `${location.primary} 独立书店 艺术书店 推荐`
    ];
    console.log(`[Search - Strategy A] Launching ${shopQueries.length} parallel shop searches...`);
    const shopSearchPromises = shopQueries.map(q => performSearch(q, tavilyKey));
    const shopSearchResponses = await Promise.all(shopSearchPromises);
    const shopSearchResults = shopSearchResponses.flat();
    console.log(`[Search - Strategy A] Collected ${shopSearchResults.length} total shop search results.`);

    // Weekend check for Strategy D
    const getShanghaiWeekdayIndex = (date = new Date()) => {
      const weekdayStr = getShanghaiWeekday(date);
      const mapping = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
      return mapping.indexOf(weekdayStr);
    };
    const dayOfWeek = getShanghaiWeekdayIndex(); // 0 = Sunday, 5 = Friday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

    // Fine-grained event queries
    const eventQueries = [
      `site:allcpp.cn ${location.primary} 漫展 同人展`,
      `site:allcpp.cn ${location.secondary} 漫展 同人展`,
      `${location.primary} 艺术展 展览 戏剧 演出 时间`
    ];
    if (isWeekend) {
      console.log('[Search - Strategy D] Weekend detected (Fri/Sat/Sun). Adding weekend special query.');
      eventQueries.push(`${location.primary} 周末 去哪玩 创意市集 游园会 活动 推荐`);
    }

    console.log(`[Search - Strategy A/D] Launching ${eventQueries.length} parallel event searches...`);
    const eventSearchPromises = eventQueries.map(q => performSearch(q, tavilyKey));
    const eventSearchResponses = await Promise.all(eventSearchPromises);
    const eventSearchResults = eventSearchResponses.flat();
    console.log(`[Search - Strategy A/D] Collected ${eventSearchResults.length} total event search results.`);

    // --- Strategy B: Preferences-Based Game Trend Search (Disabled as per user preference) ---
    /*
    try {
      const currentYear = new Date().getFullYear();
      const genre = preferences.games.include_genres?.[0] || 'RPG';
      const themeOrStyle = preferences.games.themes?.[0] || preferences.games.art_styles?.[0] || '';
      const gameTrendQuery = `${currentYear}年 ${themeOrStyle} ${genre} 游戏 评测 推荐 新游`;
      console.log(`[Search - Strategy B] Running preference-based game trend search: "${gameTrendQuery}"`);
      const gameTrendResults = await performSearch(gameTrendQuery, tavilyKey);
      
      gameTrendResults.forEach((res: SearchResult) => {
        rssItems.push({
          title: res.title,
          link: res.url,
          pubDate: new Date().toISOString(),
          contentSnippet: res.content,
          source: '搜索引擎游戏热点',
          category: 'games'
        });
      });
      console.log(`[Search - Strategy B] Injected ${gameTrendResults.length} gaming trend items into RSS queue.`);
    } catch (e) {
      console.error('[Search - Strategy B Error] Failed to run preference-based game search:', e);
    }
    */

    // --- Strategy C: RSS News Deepen Search via LLM Pre-screening ---
    try {
      const selectedIndices = await selectHighValueRss(rssItems);
      if (selectedIndices.length > 0) {
        console.log(`[Search - Strategy C] Selecting ${selectedIndices.length} RSS items for deepening:`);
        
        const deepSearchPromises = selectedIndices.map(async (idx: number) => {
          const item = rssItems[idx];
          if (!item) return;
          console.log(`  - [Deepen Search] Selected: "${item.title}"`);
          const cleanTitle = item.title.replace(/["']/g, '').slice(0, 40);
          const q = `"${cleanTitle}" 评测 玩家讨论 深度分析`;
          const results = await performSearch(q, tavilyKey);
          if (results.length > 0) {
            const contextText = results.map((r: SearchResult, rIdx: number) => `${rIdx + 1}. [${r.title}]: ${r.content}`).join('\n');
            item.contentSnippet = `${item.contentSnippet || ''}\n\n【全网深度检索背景】：\n${contextText}`;
          }
        });
        await Promise.all(deepSearchPromises);
        console.log('[Search - Strategy C] Finished deepening selected RSS items.');
      }
    } catch (e) {
      console.error('[Search - Strategy C Error] Failed to deepen RSS items:', e);
    }

    // --- Step 5b: Daily Meal Recommendation Search (大众点评 focus & Weather) ---
    console.log('\n--- Step 5b: Performing Daily Meal Recommendation Searches ---');
    const diningCenter = location.dining_center || '深圳市福田区景田北';
    const diningQueries = [
      `${location.primary} 福田区 今天天气`,
      `大众点评 ${diningCenter} 外卖 单人 简餐 人均 地址`,
      `大众点评 ${diningCenter} 粉面 快餐 小吃 人均 地址`,
      `美团 ${diningCenter} 外卖 单人套餐 人均 地址`,
      `${diningCenter} 附近 餐厅 人均 地址 推荐`
    ];
    console.log(`[Search - Dining] Launching ${diningQueries.length} parallel dining/weather searches...`);
    const diningSearchPromises = diningQueries.map((q, idx) => performSearch(
      q,
      tavilyKey,
      idx === 0 ? { maxResults: 5 } : { searchDepth: 'advanced', maxResults: 8 }
    ));
    const diningSearchResponses = await Promise.all(diningSearchPromises);
    const weatherSearchResults = diningSearchResponses[0];
    const foodSearchResults = diningSearchResponses.slice(1).flat();
    console.log(`[Search - Dining] Collected ${weatherSearchResults.length} weather results and ${foodSearchResults.length} Jingtian North food search results.`);

    // 7. Process Daily Report with AI
    console.log('\n--- Step 6: Processing & Summarizing Daily Report with AI ---');
    const dailyReport: FinalReport = await processReport(
      rssItems,
      animeCalendar,
      dailyFilteredEvents, // Only pass the new/status-changed events for the day
      shopSearchResults,
      eventSearchResults,
      preferences,
      location,
      weatherSearchResults,
      foodSearchResults,
      feedbackSummary
    );

    // Save Daily Report
    existingReports[dailyReport.date] = dailyReport;
    fs.writeFileSync(reportPath, JSON.stringify(existingReports, null, 2), 'utf-8');
    console.log(`Successfully compiled and wrote daily report to: ${reportPath}`);

    // 8. Weekly report compilation logic
    const isWeeklyForced = process.argv.includes('--weekly');
    const isMonday = getShanghaiWeekdayIndex() === 1;
    const generateWeekly = isWeeklyForced || isMonday;

    if (generateWeekly) {
      console.log('\n--- Step 7: Compiling Weekly Report ---');
      let existingWeekly: { [date: string]: WeeklyReport } = {};
      if (fs.existsSync(weeklyPath)) {
        try {
          existingWeekly = JSON.parse(fs.readFileSync(weeklyPath, 'utf-8'));
        } catch {
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
        location,
        feedbackSummary
      );

      // Strip the large anime_calendar from the weekly report database to save space
      const { anime_calendar, ...weeklyReportForStorage } = weeklyReport;
      void anime_calendar;

      existingWeekly[weeklyReport.date] = weeklyReportForStorage;
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
