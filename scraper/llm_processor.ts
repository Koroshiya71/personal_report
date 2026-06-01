import { OpenAI } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY || '';
const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Secondary task configuration (e.g. for pre-screening)
const secondaryApiKey = process.env.OPENAI_SECONDARY_API_KEY || apiKey;
const secondaryBaseURL = process.env.OPENAI_SECONDARY_BASE_URL || baseURL;
const secondaryModelName = process.env.OPENAI_SECONDARY_MODEL || modelName;

// Check if API keys are configured (and not placeholders)
const isApiKeyConfigured = apiKey && apiKey.trim() !== '' && !apiKey.includes('your_openai');
const isSecondaryApiKeyConfigured = secondaryApiKey && secondaryApiKey.trim() !== '' && !secondaryApiKey.includes('your_openai');

let openaiClient: OpenAI | null = null;
if (isApiKeyConfigured) {
  openaiClient = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
  });
}

let secondaryOpenaiClient: OpenAI | null = null;
if (isSecondaryApiKeyConfigured) {
  secondaryOpenaiClient = new OpenAI({
    apiKey: secondaryApiKey,
    baseURL: secondaryBaseURL,
  });
} else if (openaiClient) {
  secondaryOpenaiClient = openaiClient;
}


// Interfaces
interface RssItem {
  title: string;
  link: string;
  pubDate?: string;
  contentSnippet?: string;
  source: string;
  category: string;
}

interface ActivityItem {
  id: string;
  title: string;
  venue: string;
  time: string;
  price: string;
  status: string;
  cover: string;
  city: string;
  link: string;
  source: string;
}

interface AnimeItem {
  id: number;
  title: string;
  originalTitle: string;
  airDate: string;
  weekday: string;
  rating: number;
  cover: string;
  link: string;
  summary: string;
}

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface FinalReport {
  date: string;
  summary: string;
  games_primary: Array<{
    title: string;
    description: string;
    link: string;
    source: string;
    editor_comment: string;
  }>;
  games_secondary: Array<{
    title: string;
    link: string;
    source: string;
  }>;
  tech_primary: Array<{
    title: string;
    description: string;
    link: string;
    source: string;
    editor_comment: string;
  }>;
  tech_secondary: Array<{
    title: string;
    link: string;
    source: string;
  }>;
  anime: AnimeItem[];
  events: ActivityItem[];
  shops: Array<{
    name: string;
    city: string;
    category: string;
    address: string;
    description: string;
    link?: string;
  }>;
}

// Fallback logic for filtering games and tech when LLM is unavailable
function filterItemsFallback(rssItems: RssItem[], preferences: any): RssItem[] {
  // Simple keyword matching for demo/fallback purposes
  const gameKeywords = [...preferences.games.include_genres, ...preferences.games.art_styles, ...preferences.games.themes, '游戏', 'RPG', '卡牌', 'ACG', '漫展', '同人'];
  const excludeKeywords = preferences.games.exclude_genres;
  
  return rssItems.filter(item => {
    const text = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
    
    // Check exclusions
    const hasExclude = excludeKeywords.some((ex: string) => text.includes(ex.toLowerCase()));
    if (hasExclude) return false;

    if (item.category === 'games') {
      return gameKeywords.some(kw => text.includes(kw.toLowerCase())) || Math.random() > 0.4;
    }
    
    // Tech category items (minor filtering)
    return text.includes('ai') || text.includes('模型') || text.includes('智能') || text.includes('科技') || Math.random() > 0.3;
  });
}

function isDateValidForDailyReport(timeStr: string, currentDateStr: string): boolean {
  try {
    // Normalize timeStr: replace '年', '月', '.' with '-' and remove '日'
    const normalized = timeStr
      .replace(/年|月/g, '-')
      .replace(/日/g, '')
      .replace(/\./g, '-');
      
    const dates = normalized.match(/\d{4}-\d{1,2}-\d{1,2}/g);
    const today = new Date(currentDateStr);
    
    if (dates && dates.length > 0) {
      // 1. Filter out if the event has already ended
      const endDateStr = dates[dates.length - 1];
      const endDate = new Date(endDateStr);
      if (!isNaN(endDate.getTime())) {
        today.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);
        if (endDate.getTime() < today.getTime()) {
          return false; // Ended in the past
        }
      }

      // 2. Filter out if the event starts too far in the future (e.g. > 90 days from today)
      const startDateStr = dates[0];
      const startDate = new Date(startDateStr);
      if (!isNaN(startDate.getTime())) {
        startDate.setHours(0, 0, 0, 0);
        const maxFutureDate = new Date(today);
        maxFutureDate.setDate(today.getDate() + 90); // 90 days window
        if (startDate.getTime() > maxFutureDate.getTime()) {
          return false; // Starts too far in the future
        }
      }
    }
  } catch (e) {
    // Fallback: keep if parsing fails to avoid false negatives
  }
  return true;
}

function parseCleanJson(text: string) {
  try {
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('[JSON Parse Error] Failed to parse LLM response:', text);
    throw e;
  }
}

export async function processReport(
  rssItems: RssItem[],
  animeCalendar: AnimeItem[],
  bilibiliShows: ActivityItem[],
  shopSearchResults: SearchResult[],
  eventSearchResults: SearchResult[],
  preferences: any,
  location: any
): Promise<FinalReport> {
  const currentDate = new Date().toISOString().split('T')[0];
  console.log(`[LLM Processor] Starting data synthesis for date: ${currentDate}`);

  // 1. Daily Report: Filter anime airing TODAY based on current weekday
  const getWeekdayCn = () => {
    const day = new Date().getDay();
    const mapping = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    return mapping[day];
  };
  const todayWeekday = getWeekdayCn();
  const filteredAnime = animeCalendar.filter(item => item.weekday === todayWeekday);
  console.log(`[LLM Processor] Filtered ${filteredAnime.length} airing anime items for today (${todayWeekday})`);

  // 2. Select relevant events from Bilibili shows (filter out past and far future ones)
  const userEventCategories = preferences.offline_activities.categories;
  const filteredEvents = bilibiliShows.filter(show => {
    const isCategoryMatch = userEventCategories.some((cat: string) => show.title.includes(cat) || show.source.includes(cat));
    if (!isCategoryMatch) return false;
    return isDateValidForDailyReport(show.time, currentDate);
  }).slice(0, 6);

  // If LLM is NOT configured, use Heuristics + Static Summaries
  if (!openaiClient) {
    console.log('[LLM Processor] OpenAI API not configured or placeholder detected. Running in heuristic fallback mode.');
    const filteredRss = filterItemsFallback(rssItems, preferences);
    
    // Group Games Fallback
    const rawGames = filteredRss
      .filter(item => item.category === 'games');
      
    const games_primary = rawGames.slice(0, 4).map(item => ({
      title: item.title,
      description: item.contentSnippet ? item.contentSnippet.slice(0, 120) + '...' : '暂无详细描述。',
      link: item.link,
      source: item.source,
      editor_comment: "编辑点评：经典玩法与现代音画表现的交融之作，体验流畅且设计考究，值得一试。"
    }));

    const games_secondary = rawGames.slice(4, 12).map(item => ({
      title: item.title,
      link: item.link,
      source: item.source
    }));

    // Group Tech Fallback
    const rawTech = filteredRss
      .filter(item => item.category === 'tech');

    const tech_primary = rawTech.slice(0, 4).map(item => ({
      title: item.title,
      description: item.contentSnippet ? item.contentSnippet.slice(0, 120) + '...' : '暂无详细描述。',
      link: item.link,
      source: item.source,
      editor_comment: "编辑点评：该产品提供了一种极低门槛的定制入口，充分展现了自由而优雅的极客开发精神。"
    }));

    const tech_secondary = rawTech.slice(4, 12).map(item => ({
      title: item.title,
      link: item.link,
      source: item.source
    }));

    // Mock local shops
    const shops = [
      {
        name: '前檐书店 (Shenzhen Yan Bookstore)',
        city: '深圳',
        category: '书店',
        address: '深圳市南山区深圳湾万象城 L3 层',
        description: '集设计、生活、艺术于一体的精品艺术书店，拥有大面积的原版书区与极佳的阅读采光，适合下午小憩。'
      },
      {
        name: 'Half Coffee (精品咖啡馆)',
        city: '深圳',
        category: '咖啡店',
        address: '深圳市福田区香蜜湖文化创意园',
        description: '深圳人气极高的精品手冲咖啡馆，环境通透开阔，主打特调与单源手冲，味道醇厚，常有二次元及设计爱好者聚集。'
      },
      {
        name: 'LAVO Whisky & Cocktail Bar',
        city: '深圳',
        category: '酒吧',
        address: '深圳市南山区深圳湾一号',
        description: '高空极佳视角的威士忌清吧，音乐柔和不吵闹，特调鸡尾酒口感细腻，适合夜间放松与三两好友小酌。'
      }
    ];

    if (eventSearchResults && eventSearchResults.length > 0) {
      eventSearchResults.slice(0, 2).forEach((res, idx) => {
        filteredEvents.push({
          id: `cpp-search-${idx}`,
          title: res.title.replace('_CPP无差别同人站', '').trim(),
          venue: '深圳/广州同人会场',
          time: '具体时间详见购票页面',
          price: '以官方购票为准',
          status: '公开',
          cover: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=300',
          city: location.primary,
          link: res.url,
          source: 'CPP 同人展检索'
        });
      });
    }

    return {
      date: currentDate,
      summary: `今日快讯 (本地测试模式)：今日共抓取了 ${rssItems.length} 条资讯和 ${bilibiliShows.length} 个展演项目。当前在 ${location.primary} 地区为您推荐了包括《前檐书店》和《Half Coffee》在内的特色生活去处；游戏方面，为您过滤出 ${games_primary.length + games_secondary.length} 篇推荐内容。`,
      games_primary,
      games_secondary,
      tech_primary,
      tech_secondary,
      anime: filteredAnime,
      events: filteredEvents,
      shops: shops
    };
  }

  // LLM mode: We have a configured OpenAI compatible key!
  try {
    console.log('[LLM Processor] Initiating OpenAI Chat completions...');

    // 1. Process Games and Tech News
    const newsPrompt = `
You are a professional, senior tech and game editor who has deep industry knowledge, meticulous analytical skills, and excellent taste. 
Here is a list of raw RSS news items collected today:
${JSON.stringify(rssItems.map(item => ({ title: item.title, snippet: item.contentSnippet?.slice(0, 250), source: item.source, category: item.category })))}

User Preferences:
- Target Games: RPG, Action (动作), Strategy/Card (策略卡牌). Exclude Shooters (射击) and Horror (恐怖) games. Prefers Japanese anime art style (日系二次元), samurai (武士), Wuxia/Xianxia (武侠/仙侠) themes.
- Target Tech: AI developments, productivity, geeks, open source, technological breakthroughs.

Your Task:
1. Games section:
   - Select 3 to 5 high-quality articles for "games_primary". These MUST be valuable discussions, deep analyses, product reviews, or retrospectives (DO NOT select pure press release announcements). Write a detailed summary in Chinese and a 1-2 sentence thoughtful commentary ("editor_comment").
   - Select 5 to 10 standard news announcements or quick briefs for "games_secondary" (only need title, source).
2. Tech section:
   - Select 3 to 5 high-quality, objective, and insightful articles for "tech_primary". FILTER OUT low-quality clickbaits, flame wars, or extreme/opinionated/hostile statements. Clarify and enrich brief or confusing details in the original summaries based on your knowledge. Write a detailed summary in Chinese and a 1-2 sentence thoughtful commentary ("editor_comment").
   - Select 5 to 10 quick tech news for "tech_secondary" (only need title, source).

Guidelines for writing "editor_comment" (CRITICAL FOR TONE):
- Write in a natural, colloquial, yet intellectually engaging tone in Chinese, like a real person sharing insights with a friend. Use a first-person or collaborative voice (e.g., "我感觉...", "从我们的视角来看...", "或许可以关注..."). Speak as a peer rather than an institutional authority or marketing copywriter.
- AVOID AI-style fluff, jargon-filled marketing buzzwords, and robotic templates (e.g., do NOT start with or use phrases like "这表明了...", "总的来说...", "值得一提的是...", "该事件标志着...", "不得不说...", "展现了其独特的魅力").
- Be rational, objective, and multi-dimensional. Do not offer simple, shallow praise or criticism. Instead, dissect design trade-offs, underlying motivations, technical constraints, or future implications in 1-2 concise, high-density sentences.

Output the results strictly as a JSON object of this structure:
{
  "games_primary": [
    { "title": "Chinese Title", "description": "Detailed Chinese summary (2-3 sentences)", "source": "source_name", "editor_comment": "Your insightful editorial comment" }
  ],
  "games_secondary": [
    { "title": "Chinese Title", "source": "source_name" }
  ],
  "tech_primary": [
    { "title": "Chinese Title", "description": "Detailed Chinese summary (2-3 sentences)", "source": "source_name", "editor_comment": "Your insightful editorial comment" }
  ],
  "tech_secondary": [
    { "title": "Chinese Title", "source": "source_name" }
  ]
}
`;

    const newsResponse = await openaiClient.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: newsPrompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const parsedNews = parseCleanJson(newsResponse.choices[0].message.content || '{}');
    
    const games_primary = (parsedNews.games_primary || []).map((g: any) => {
      const match = rssItems.find(item => item.title === g.title || g.title.includes(item.title.slice(0, 5)));
      return { ...g, link: match ? match.link : '#' };
    });
    
    const games_secondary = (parsedNews.games_secondary || []).map((g: any) => {
      const match = rssItems.find(item => item.title === g.title || g.title.includes(item.title.slice(0, 5)));
      return { ...g, link: match ? match.link : '#' };
    });

    const tech_primary = (parsedNews.tech_primary || []).map((t: any) => {
      const match = rssItems.find(item => item.title === t.title || t.title.includes(item.title.slice(0, 5)));
      return { ...t, link: match ? match.link : '#' };
    });

    const tech_secondary = (parsedNews.tech_secondary || []).map((t: any) => {
      const match = rssItems.find(item => item.title === t.title || t.title.includes(item.title.slice(0, 5)));
      return { ...t, link: match ? match.link : '#' };
    });

    // 2. Process Local Shop and Activity Recommendations
    const searchPrompt = `
You are a local lifestyle guide for ${location.primary} and ${location.secondary} areas.
Today's date is: ${currentDate}

The user wants recommendations for Bookstore (书店), Coffee shops (咖啡店/精品咖啡), and Bars (清吧/酒吧) in ${location.primary} (mainly) or ${location.secondary}.
Shops Info: ${JSON.stringify(shopSearchResults)}
CPP/Event Info: ${JSON.stringify(eventSearchResults)}

Please select exactly 3 premium shops (ideally one bookstore, one cafe, one bar/pub) and compile them.
Additionally, describe any interesting events (like CPP doujin events, exhibitions, or art shows).

CRITICAL TIME REQUIREMENT:
- You must strictly filter out and IGNORE any events that have already ended prior to today (${currentDate}). For example, do not select events that ended in 2024, 2025, or early 2026.
- Only select events that are currently active, running, or upcoming (end date >= ${currentDate}).
- Avoid selecting events that are too far in the future (e.g. starting more than 90 days away from ${currentDate}). Focus on events happening in the next 1-2 months.

Output the results strictly as a JSON object:
{
  "shops": [
    { "name": "Shop Name", "city": "${location.primary}", "category": "书店/咖啡店/酒吧", "address": "Address", "description": "Recommendation summary" }
  ],
  "extra_events": [
    { "title": "Event Title", "venue": "Venue", "time": "Time", "price": "Price", "city": "City", "link": "link", "source": "Source" }
  ]
}
`;

    const searchResponse = await openaiClient.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: searchPrompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' }
    });

    const parsedSearch = parseCleanJson(searchResponse.choices[0].message.content || '{}');
    const shops = parsedSearch.shops || [];
    
    if (parsedSearch.extra_events && Array.isArray(parsedSearch.extra_events)) {
      parsedSearch.extra_events.forEach((evt: any, idx: number) => {
        // Apply programmatic filter to filter out past/future events just in case LLM misses
        if (evt.time && !isDateValidForDailyReport(evt.time, currentDate)) {
          console.log(`[LLM Processor] Filtering out extra event due to date range: "${evt.title}" (${evt.time})`);
          return;
        }
        filteredEvents.push({
          id: `search-evt-${idx}`,
          title: evt.title,
          venue: evt.venue || '未定',
          time: evt.time || '未定',
          price: evt.price || '待定',
          status: '公开',
          cover: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=300',
          city: evt.city || location.primary,
          link: evt.link || '',
          source: evt.source || '网络搜索'
        });
      });
    }

    // 3. Generate Overall Daily Summary
    const summaryPrompt = `
Based on today's compiled content, write a beautiful daily briefing summary (今日快讯) for the user in Chinese.
Keep it warm, engaging, and personalized. Speak as their companion.

Instead of writing a single large paragraph of text, you MUST structure it as a clean list using Markdown bullet points, categorizing the highlights of the day. For example:
亲爱的朋友，为你送上今天的专属快讯！☕️

- 🎮 **游戏精选**：这里总结1-2个最亮眼的游戏新闻...
- 🚀 **前沿科技**：总结1-2个科技突破亮点...
- 📺 **今日番剧**：提到今天放送的精彩番剧...
- ☕ **生活去处**：用温暖的语言推荐今天挑选的探店去处...

愿你拥有充实、愉快而美好的一天！✨

Summary of today's content:
- Games: ${JSON.stringify(games_primary.map((g: any) => g.title))}
- Shops: ${JSON.stringify(shops.map((s: any) => s.name))}
- Anime: ${JSON.stringify(filteredAnime.slice(0, 2).map(a => a.title))}
Write around 150-200 words.
`;

    const summaryResponse = await openaiClient.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: summaryPrompt }],
      temperature: 0.5
    });

    const summary = summaryResponse.choices[0].message.content || '生成总结失败，请检查连接。';

    return {
      date: currentDate,
      summary: summary.trim(),
      games_primary,
      games_secondary,
      tech_primary,
      tech_secondary,
      anime: filteredAnime,
      events: filteredEvents,
      shops: shops
    };
  } catch (err) {
    console.error('[LLM Processor API Error] LLM request failed. Falling back to heuristics:', err);
    return processReport(rssItems, animeCalendar, bilibiliShows, shopSearchResults, eventSearchResults, preferences, location);
  }
}

export async function processWeeklyReport(
  dailyReports: FinalReport[],
  animeCalendar: AnimeItem[],
  bilibiliShows: ActivityItem[],
  shopSearchResults: SearchResult[],
  preferences: any,
  location: any
): Promise<WeeklyReport> {
  const currentDate = new Date().toISOString().split('T')[0];
  console.log(`[LLM Processor] Generating Weekly Report for date: ${currentDate}`);

  const userEventCategories = preferences.offline_activities.categories;
  const filteredEvents = bilibiliShows
    .filter(show => {
      const isCategoryMatch = userEventCategories.some((cat: string) => show.title.includes(cat) || show.source.includes(cat));
      if (!isCategoryMatch) return false;
      return isDateValidForDailyReport(show.time, currentDate);
    })
    .slice(0, 15);

  if (!openaiClient) {
    console.log('[LLM Processor] OpenAI API not configured. Generating weekly report in fallback mode.');

    let weeklyGamesPrimary: any[] = [];
    let weeklyGamesSecondary: any[] = [];
    let weeklyTechPrimary: any[] = [];
    let weeklyTechSecondary: any[] = [];

    if (dailyReports && dailyReports.length > 0) {
      dailyReports.forEach(rep => {
        weeklyGamesPrimary.push(...(rep.games_primary || []));
        weeklyGamesSecondary.push(...(rep.games_secondary || []));
        weeklyTechPrimary.push(...(rep.tech_primary || []));
        weeklyTechSecondary.push(...(rep.tech_secondary || []));
      });
    }

    const seenGameTitles = new Set();
    const games_primary = weeklyGamesPrimary.filter(g => {
      if (seenGameTitles.has(g.title)) return false;
      seenGameTitles.add(g.title);
      return true;
    }).slice(0, 4);

    const games_secondary = weeklyGamesSecondary.filter(g => {
      if (seenGameTitles.has(g.title)) return false;
      seenGameTitles.add(g.title);
      return true;
    }).slice(0, 8);

    const seenTechTitles = new Set();
    const tech_primary = weeklyTechPrimary.filter(t => {
      if (seenTechTitles.has(t.title)) return false;
      seenTechTitles.add(t.title);
      return true;
    }).slice(0, 4);

    const tech_secondary = weeklyTechSecondary.filter(t => {
      if (seenTechTitles.has(t.title)) return false;
      seenTechTitles.add(t.title);
      return true;
    }).slice(0, 8);

    const shops = [
      {
        name: '茑屋书店 (TSUTAYA BOOKS - 中洲湾店)',
        city: '深圳',
        category: '书店',
        address: '深圳市福田区中洲湾 C-Street 1层',
        description: '充满二次元和艺术氛围的综合型概念书店，陈列大量画集、原版手办及文创，是同好周末朝圣与寻找灵感的绝佳去处。'
      },
      {
        name: 'GEE COFFEE ROASTERS (精品手冲)',
        city: '深圳',
        category: '咖啡店',
        address: '深圳市南山区华侨城创意园内',
        description: '老牌工业风精品咖啡，位于创意园区绿荫中。其特调与手冲单源豆表现优秀，安静的室外座位极度适合阅读或发呆。'
      },
      {
        name: 'The PEAT 威士忌酒吧',
        city: '深圳',
        category: '酒吧',
        address: '深圳市福田区 PAFC Mall',
        description: '主打泥煤风味威士忌与先锋特调，店面低调静谧，极其适合在工作日或周末深夜前去单独小酌，放松心情。'
      }
    ];

    return {
      date: currentDate,
      summary: `周报快讯 (本地测试模式)：本周回顾为您汇集了过去多天生成的日报精华。针对新一周，我们在 ${location.primary} 为您定制了最新的“新番追番表”，并整理了未来 30 天内可购票的同城线下活动；精选了 3 个本地精品探店去处，祝您度过充实的一周。`,
      games_primary: games_primary.length > 0 ? games_primary : [
        { title: '《仙境传说 Console Project》正式公布，重温仙境感动', description: '经典RO世界观角扮演新作公布，包含卡牌与动作元素。', link: '#', source: '机核', editor_comment: '编辑点评：经典仙境传说IP的主机化尝试，画风依然软萌，玩法值得期待。' }
      ],
      games_secondary: games_secondary.length > 0 ? games_secondary : [
        { title: '《铁拳8》游戏总监池田幸平离任万代南梦宫', link: '#', source: '游研社' }
      ],
      tech_primary: tech_primary.length > 0 ? tech_primary : [
        { title: '少数派分享：「一日一偈」把经文带入轻阅读', description: '数码效率与轻型生活美学探讨，提升个人每日专注力。', link: '#', source: '少数派', editor_comment: '编辑点评：一次小而美的主观阅读生活美学实践，值得独立开发者借鉴。' }
      ],
      tech_secondary: tech_secondary.length > 0 ? tech_secondary : [
        { title: '极客动态：海盗湾上线二十周年，互联网去中心化反思', link: '#', source: 'Solidot' }
      ],
      anime_calendar: animeCalendar,
      events: filteredEvents,
      shops: shops
    };
  }

  try {
    console.log('[LLM Processor] Generating Weekly Report via OpenAI...');

    let allGamesPrimary: any[] = [];
    let allGamesSecondary: any[] = [];
    let allTechPrimary: any[] = [];
    let allTechSecondary: any[] = [];

    if (dailyReports && dailyReports.length > 0) {
      dailyReports.forEach(rep => {
        allGamesPrimary.push(...(rep.games_primary || []));
        allGamesSecondary.push(...(rep.games_secondary || []));
        allTechPrimary.push(...(rep.tech_primary || []));
        allTechSecondary.push(...(rep.tech_secondary || []));
      });
    }

    const compilePrompt = `
You are a senior lifestyle and technology editor. 
Here are the daily primary articles curated throughout the week (including their daily summaries and daily commentaries):
Games Primary: ${JSON.stringify(allGamesPrimary.map(g => ({ title: g.title, source: g.source, description: g.description, editor_comment: g.editor_comment })))}
Games Secondary: ${JSON.stringify(allGamesSecondary.map(g => ({ title: g.title, source: g.source })))}
Tech Primary: ${JSON.stringify(allTechPrimary.map(t => ({ title: t.title, source: t.source, description: t.description, editor_comment: t.editor_comment })))}
Tech Secondary: ${JSON.stringify(allTechSecondary.map(t => ({ title: t.title, source: t.source })))}
Shop search results: ${JSON.stringify(shopSearchResults)}

Task:
1. Select top 3-5 games for "best_games_primary" (deep reports). Write a synthesized detailed description and a 1-2 sentence thoughtful commentary ("editor_comment").
2. Select top 5-10 games for "best_games_secondary" (briefs).
3. Select top 3-5 tech for "best_tech_primary" (insightful, filter clickbait). Write a synthesized detailed description and a 1-2 sentence thoughtful commentary ("editor_comment").
4. Select top 5-10 tech for "best_tech_secondary" (briefs).
5. Recommend 3 lifestyle shops in ${location.primary}/${location.secondary}.

Guidelines for writing "editor_comment" (CRITICAL FOR TONE):
- Write in a natural, colloquial, yet intellectually engaging tone in Chinese, like a real person sharing insights with a friend. Use a first-person or collaborative voice (e.g., "我感觉...", "从我们的视角来看...", "或许可以关注..."). Speak as a peer rather than an institutional authority or marketing copywriter.
- AVOID AI-style fluff, jargon-filled marketing buzzwords, and robotic templates (e.g., do NOT start with or use phrases like "这表明了...", "总的来说...", "值得一提的是...", "该事件标志着...", "不得不说...", "展现了其独特的魅力").
- Be rational, objective, and multi-dimensional. Do not offer simple, shallow praise or criticism. Instead, dissect design trade-offs, underlying motivations, technical constraints, or future implications in 1-2 concise, high-density sentences. You may adapt or refine the daily commentaries provided in the input.

Output strict JSON:
{
  "best_games_primary": [{ "title": "Title", "description": "Summary", "source": "Source", "editor_comment": "Comment" }],
  "best_games_secondary": [{ "title": "Title", "source": "Source" }],
  "best_tech_primary": [{ "title": "Title", "description": "Summary", "source": "Source", "editor_comment": "Comment" }],
  "best_tech_secondary": [{ "title": "Title", "source": "Source" }],
  "shops": [{ "name": "Name", "city": "${location.primary}", "category": "Category", "address": "Address", "description": "Desc" }]
}
`;

    const weeklyResponse = await openaiClient.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: compilePrompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const parsedWeekly = parseCleanJson(weeklyResponse.choices[0].message.content || '{}');
    
    const allOriginalGames = [...allGamesPrimary, ...allGamesSecondary];
    const allOriginalTech = [...allTechPrimary, ...allTechSecondary];

    const games_primary = (parsedWeekly.best_games_primary || []).map((g: any) => {
      const match = allOriginalGames.find(orig => orig.title === g.title || g.title.includes(orig.title.slice(0, 5)));
      return { ...g, link: match ? match.link : '#' };
    });
    
    const games_secondary = (parsedWeekly.best_games_secondary || []).map((g: any) => {
      const match = allOriginalGames.find(orig => orig.title === g.title || g.title.includes(orig.title.slice(0, 5)));
      return { ...g, link: match ? match.link : '#' };
    });

    const tech_primary = (parsedWeekly.best_tech_primary || []).map((t: any) => {
      const match = allOriginalTech.find(orig => orig.title === t.title || t.title.includes(orig.title.slice(0, 5)));
      return { ...t, link: match ? match.link : '#' };
    });

    const tech_secondary = (parsedWeekly.best_tech_secondary || []).map((t: any) => {
      const match = allOriginalTech.find(orig => orig.title === t.title || t.title.includes(orig.title.slice(0, 5)));
      return { ...t, link: match ? match.link : '#' };
    });

    const shops = parsedWeekly.shops || [];

    // Create a beautiful weekly summary briefing
    const summaryPrompt = `
Generate a warm and motivating Weekly Briefing (周报前言) in Chinese for the user.
Speak as their AI life companion.
You MUST structure this briefing using clean Markdown bullet points to summarize the highlights for the week. For example:
哈罗！这是为你整理的本周看点总结，祝你度过充实的一周：

- 🎮 **本周游戏**：总结本周最精彩的游戏热点...
- 🚀 **科技精华**：总结本周最具前瞻性的科技突破...
- 📅 **追番与活动**：提及本周追番日历与在 ${location.primary}/${location.secondary} 准备开票的线下同人展/展览活动...
- ☕ **周末探店**：用轻松的语气推荐本周挑选的特色店面，适合周末放松小憩...

Highlight:
- That this is their personalized Weekly Report for the week of ${currentDate}.
- Briefly touch upon the major gaming and tech trends of the week.
- Remind them of the new anime schedule (追番日历) and list of upcoming events/comic cons in ${location.primary}/${location.secondary} that are ready for ticketing.
- Encourage them to check out the recommended shops (bookstore/cafe/bar) for weekend relaxation.
Write around 180-220 words.
`;

    const summaryResponse = await openaiClient.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: summaryPrompt }],
      temperature: 0.5
    });

    const summary = summaryResponse.choices[0].message.content || '生成周总结失败。';

    return {
      date: currentDate,
      summary: summary.trim(),
      games_primary,
      games_secondary,
      tech_primary,
      tech_secondary,
      anime_calendar: animeCalendar,
      events: filteredEvents,
      shops: shops
    };

  } catch (err) {
    console.error('[LLM Processor Weekly Error] Failed to generate weekly report via AI:', err);
    // Ultimate fallback if LLM crashes
    return processWeeklyReport(dailyReports, animeCalendar, bilibiliShows, shopSearchResults, preferences, location);
  }
}

export async function selectHighValueRss(rssItems: RssItem[]): Promise<number[]> {
  if (rssItems.length === 0) return [];
  if (!secondaryOpenaiClient) {
    console.log('[LLM Processor] Secondary OpenAI client not configured. Selecting first 2 items programmatically.');
    return [0, 1].filter(i => i < rssItems.length);
  }

  try {
    console.log('[LLM Processor] Selecting high-value RSS items via LLM...');
    // We map RSS items with indices so LLM can easily refer to them by index
    const listForPrompt = rssItems.map((item, idx) => ({
      index: idx,
      title: item.title,
      source: item.source,
      category: item.category,
      snippet: item.contentSnippet?.slice(0, 100) || ''
    }));

    const prompt = `
You are an expert news editor. Your task is to select exactly 2 or 3 most valuable, impactful, or highly discussable gaming or tech articles from the following list.
These selected articles will be sent to a search engine to retrieve deep background context, reviews, and community reactions.
Do NOT select simple announcements, daily deals, or repetitive updates. Select articles that have deep analysis potential, product releases, major controversies, or insightful opinions.

Articles List:
${JSON.stringify(listForPrompt)}

Output the results strictly as a JSON object containing an array of selected indices:
{
  "indices": [index1, index2]
}
`;

    const response = await secondaryOpenaiClient.chat.completions.create({
      model: secondaryModelName,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const parsed = parseCleanJson(response.choices[0].message.content || '{}');
    const selectedIndices: number[] = parsed.indices || [];
    console.log(`[LLM Processor] High-value RSS indices selected by LLM: ${JSON.stringify(selectedIndices)}`);
    // Filter to ensure validity
    return selectedIndices.filter(idx => typeof idx === 'number' && idx >= 0 && idx < rssItems.length);
  } catch (error) {
    console.error('[LLM Processor Error] Failed to select high-value RSS items via LLM:', error);
    // Programmatic fallback
    return [0, 1].filter(i => i < rssItems.length);
  }
}

