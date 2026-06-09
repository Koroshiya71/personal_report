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
export interface RssItem {
  title: string;
  link: string;
  pubDate?: string;
  contentSnippet?: string;
  source: string;
  category: string;
}

export interface ActivityItem {
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

export interface AnimeItem {
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

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface Preferences {
  games: {
    include_genres: string[];
    exclude_genres: string[];
    art_styles: string[];
    themes: string[];
  };
  offline_activities: {
    categories: string[];
  };
  shops: {
    categories: string[];
  };
  dining?: {
    scenarios: string[];
    categories: string[];
  };
}

export interface Location {
  primary: string;
  secondary: string;
  primary_code: string;
  secondary_code: string;
  dining_center?: string;
}

type DeliveryType = "支持外卖" | "仅限堂食" | "外卖/堂食皆可";

interface MealRecommendation {
  name: string;
  cuisine: string;
  price_range: string;
  suitability_index: string;
  reason: string;
  address?: string;
  delivery_type: DeliveryType;
}

interface ShopRecommendation {
  name: string;
  city: string;
  category: string;
  address: string;
  description: string;
  link?: string;
}

interface PrimarySelection {
  title: string;
  description: string;
  source: string;
  editor_comment: string;
}

interface SecondarySelection {
  title: string;
  source: string;
}

interface ParsedNewsResponse {
  games_primary?: PrimarySelection[];
  games_secondary?: SecondarySelection[];
  tech_primary?: PrimarySelection[];
  tech_secondary?: SecondarySelection[];
}

interface ParsedSearchResponse {
  shops?: ShopRecommendation[];
  extra_events?: Array<{
    title: string;
    venue?: string;
    time?: string;
    price?: string;
    city?: string;
    link?: string;
    source?: string;
  }>;
  meals?: MealRecommendation[];
}

interface ParsedWeeklyResponse {
  best_games_primary?: PrimarySelection[];
  best_games_secondary?: SecondarySelection[];
  best_tech_primary?: PrimarySelection[];
  best_tech_secondary?: SecondarySelection[];
  shops?: ShopRecommendation[];
  stats?: {
    fun_insight?: string;
  };
}

interface ParsedIndicesResponse {
  indices?: number[];
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
  shops: ShopRecommendation[];
  meals?: MealRecommendation[];
}

export interface WeeklyReport {
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
  anime_calendar?: AnimeItem[];
  events: ActivityItem[];
  shops: ShopRecommendation[];
  stats?: {
    total_articles: number;
    games_count: number;
    tech_count: number;
    events_count: number;
    fun_insight: string;
  };
}

// Fallback logic for filtering games and tech when LLM is unavailable
function filterItemsFallback(rssItems: RssItem[], preferences: Preferences): RssItem[] {
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
  } catch {
    // Fallback: keep if parsing fails to avoid false negatives
  }
  return true;
}

function parseCleanJson<T>(text: string): T {
  try {
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean) as T;
  } catch (e) {
    console.error('[JSON Parse Error] Failed to parse LLM response:', text);
    throw e;
  }
}

export function getShanghaiDateString(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}
export function getShanghaiWeekday(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    weekday: 'long'
  });
  return formatter.format(date);
}

export async function processReport(
  rssItems: RssItem[],
  animeCalendar: AnimeItem[],
  bilibiliShows: ActivityItem[],
  shopSearchResults: SearchResult[],
  eventSearchResults: SearchResult[],
  preferences: Preferences,
  location: Location,
  weatherSearchResults?: SearchResult[],
  foodSearchResults?: SearchResult[],
  useLlm = true
): Promise<FinalReport> {
  const currentDate = getShanghaiDateString();
  console.log(`[LLM Processor] Starting data synthesis for date: ${currentDate}`);

  // 1. Daily Report: Filter anime airing TODAY based on current weekday
  const todayWeekday = getShanghaiWeekday();
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
  if (!openaiClient || !useLlm) {
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

    // Mock Jingtian North meals fallback
    const fallbackMeals = [
      {
        name: '小顺天石磨肠粉 (景田店)',
        cuisine: '广式石磨肠粉 / 粥品小吃',
        price_range: '人均 15-25 元',
        suitability_index: '95% (工作日早午餐适宜，来一份双蛋肉碎肠粉配枸杞猪杂汤，快捷暖胃)',
        reason: '景田街坊口碑相传的石磨肠粉，皮薄香滑，特制酱汁咸甜适中。提供美团外卖，单人快速解决一餐的首选。',
        address: '深圳市福田区景田北街与景田路交叉口旁巷内',
        delivery_type: '支持外卖' as const
      },
      {
        name: '面点王 (景田北店)',
        cuisine: '北方面点 / 快捷面食简餐',
        price_range: '人均 30-40 元',
        suitability_index: '90% (工作日单人快速搞定午餐/晚餐的极佳选择)',
        reason: '出餐非常迅速且卫生稳定，酱骨架、酱香牛肉面和手工饺子水准平均。外卖包装防漏，适合单人办公或吃快餐。',
        address: '深圳市福田区景田北路景华苑一楼',
        delivery_type: '支持外卖' as const
      },
      {
        name: '木屋烧烤 (景田店)',
        cuisine: '烤串 / 深夜烧烤',
        price_range: '人均 70-90 元',
        suitability_index: '88% (深夜想要大口撸串解压时的完美选择)',
        reason: '烤羊肉串、烤生蚝和泼辣猪脆骨调味出色，外卖配送保温效果好，配上一罐冰啤酒是极好的深夜慰藉。',
        address: '深圳市福田区景新花园 1 楼',
        delivery_type: '支持外卖' as const
      },
      {
        name: '顺德公猪肚鸡 (景田总店)',
        cuisine: '顺德菜 / 胡椒猪肚鸡',
        price_range: '人均 90-120 元',
        suitability_index: '85% (降温天或周末犒劳自己，热腾腾的汤底暖胃滋补)',
        reason: '经典胡椒猪肚鸡，汤底浓郁辛香，猪肚爽脆，走地鸡皮滑肉嫩。虽然可以外卖，但更推荐到店体验招牌砂锅慢熬。',
        address: '深圳市福田区景田北路东景花园一楼',
        delivery_type: '仅限堂食' as const
      },
      {
        name: '蘩楼 (景田店)',
        cuisine: '广式早茶 / 手作点心',
        price_range: '人均 75-95 元',
        suitability_index: '80% (周末早起叹茶，享受悠闲广式慢生活)',
        reason: '深圳人气极高的手工茶楼，红米肠、豉汁排骨和露笋虾饺皇是必点。建议线下堂食，以享用刚出炉的口感。',
        address: '深圳市福田区景田路 82 号中国茶宫 1-3 楼',
        delivery_type: '仅限堂食' as const
      }
    ];

    // Pick 2 meals based on current day of week to provide variety
    const dayIndex = new Date().getDay();
    const meal1 = fallbackMeals[dayIndex % fallbackMeals.length];
    const meal2 = fallbackMeals[(dayIndex + 2) % fallbackMeals.length];
    const meals = [meal1, meal2];

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
      summary: `今日快讯 (本地测试模式)：今日共抓取了 ${rssItems.length} 条资讯和 ${bilibiliShows.length} 个展演项目。当前在 ${location.primary} 地区为您推荐了包括《前檐书店》和《Half Coffee》在内的特色生活去处；游戏方面，为您过滤出 ${games_primary.length + games_secondary.length} 篇推荐内容。就餐方面为您精选了景田北周边的口碑单人外卖与堂食建议。`,
      games_primary,
      games_secondary,
      tech_primary,
      tech_secondary,
      anime: filteredAnime,
      events: filteredEvents,
      shops: shops,
      meals: meals
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

    const parsedNews = parseCleanJson<ParsedNewsResponse>(newsResponse.choices[0].message.content || '{}');
    
    const games_primary = (parsedNews.games_primary || []).map((g) => {
      const match = rssItems.find(item => item.title === g.title || g.title.includes(item.title.slice(0, 5)));
      return { ...g, link: match ? match.link : '#' };
    });
    
    const games_secondary = (parsedNews.games_secondary || []).map((g) => {
      const match = rssItems.find(item => item.title === g.title || g.title.includes(item.title.slice(0, 5)));
      return { ...g, link: match ? match.link : '#' };
    });

    const tech_primary = (parsedNews.tech_primary || []).map((t) => {
      const match = rssItems.find(item => item.title === t.title || t.title.includes(item.title.slice(0, 5)));
      return { ...t, link: match ? match.link : '#' };
    });

    const tech_secondary = (parsedNews.tech_secondary || []).map((t) => {
      const match = rssItems.find(item => item.title === t.title || t.title.includes(item.title.slice(0, 5)));
      return { ...t, link: match ? match.link : '#' };
    });

    // 2. Process Local Shop, Activity, and Dining Recommendations
    const diningCenter = location.dining_center || '深圳市福田区景田北';
    const diningPreferences = preferences.dining || { scenarios: ["外卖", "单人就餐"], categories: ["面食", "小吃简餐", "快餐", "粤菜"] };

    const searchPrompt = `
You are a local lifestyle guide for ${location.primary} and ${location.secondary} areas.
Today's date is: ${currentDate}

Task 1: Shop recommendations
The user wants recommendations for Bookstore (书店), Coffee shops (咖啡店/精品咖啡), and Bars (清吧/酒吧) in ${location.primary} (mainly) or ${location.secondary}.
Shops Info: ${JSON.stringify(shopSearchResults)}
Please select exactly 3 premium shops (ideally one bookstore, one cafe, one bar/pub) and compile them.

Task 2: Offline Events
CPP/Event Info: ${JSON.stringify(eventSearchResults)}
Describe any interesting events (like CPP doujin events, exhibitions, or art shows).
CRITICAL TIME REQUIREMENT:
- You must strictly filter out and IGNORE any events that have already ended prior to today (${currentDate}).
- Only select events that are currently active, running, or upcoming (end date >= ${currentDate}).
- Avoid selecting events that are too far in the future (e.g. starting more than 90 days away from ${currentDate}). Focus on events happening in the next 1-2 months.

Task 3: Daily Meal Recommendations
Recommend 2-3 daily dining options near "${diningCenter}".
We crawled the weather for today: ${JSON.stringify(weatherSearchResults)}
We also crawled popular restaurants/food on Dianping near "${diningCenter}": ${JSON.stringify(foodSearchResults)}

Dining preferences:
- Dining Center: ${diningCenter}
- Main Scenarios: ${diningPreferences.scenarios.join('/')} (mainly Takeout 外卖 & Solo Dining 单人就餐)
- Target Categories: ${diningPreferences.categories.join('/')}

Guidelines for meal recommendations:
- The user primarily wants to order Takeout (外卖) and eat alone (单人就餐). Prioritize restaurants that support takeout, have great single-portion options (like set meals, noodle bowls, quick bites), and are nearby.
- If you find an exceptionally high-quality restaurant that does NOT support delivery but is worth a special offline trip, you can recommend it as "仅限堂食", clearly stating it is a "线下特别推荐".
- Customize the "suitability_index" (今日适宜指数) based on today's weather/weekday. For example, if it's rainy or cold, recommend something warm (like hot soup noodles, pork stomach chicken, porridge) with index like "95% (小雨天气，最适合来一份热腾腾的猪肚鸡/拉面)". If it's very hot, suggest something refreshing (like cold noodles, sushi, coconut chicken) with index like "92% (酷暑难耐，适合吃爽口椰子鸡解暑)".
- The "reason" should be warm, companion-like, and explain why this restaurant fits the weather, weekday status, or single/takeout preference. Explain what specific dishes to order.
- Ensure the restaurants recommended are real places from the Dianping search results (or highly credible/realistic ones near Jingtian North).

Output the results strictly as a JSON object:
{
  "shops": [
    { "name": "Shop Name", "city": "${location.primary}", "category": "书店/咖啡店/酒吧", "address": "Address", "description": "Recommendation summary" }
  ],
  "extra_events": [
    { "title": "Event Title", "venue": "Venue", "time": "Time", "price": "Price", "city": "City", "link": "link", "source": "Source" }
  ],
  "meals": [
    {
      "name": "Restaurant/Food Name",
      "cuisine": "Cuisine style (e.g., 日式拉面, 广式早茶)",
      "price_range": "Average Cost (e.g., 人均 20-30 元)",
      "suitability_index": "Suitability index and weather note (e.g., 95% - Rain and chilly, perfect for a warm bowl of soup)",
      "reason": "Insightful recommendation reason (2-3 sentences)",
      "address": "Address near ${diningCenter}",
      "delivery_type": "支持外卖"
    }
  ]
}
`;

    const searchResponse = await openaiClient.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: searchPrompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' }
    });

    const parsedSearch = parseCleanJson<ParsedSearchResponse>(searchResponse.choices[0].message.content || '{}');
    const shops: FinalReport['shops'] = parsedSearch.shops || [];
    const meals: MealRecommendation[] = parsedSearch.meals || [];
    
    if (parsedSearch.extra_events && Array.isArray(parsedSearch.extra_events)) {
      parsedSearch.extra_events.forEach((evt, idx) => {
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
- 🍱 **就餐建议**：结合今天的天气和心情，简单点明就餐去处...

愿你拥有充实、愉快而美好的一天！✨

Summary of today's content:
- Games: ${JSON.stringify(games_primary.map(g => g.title))}
- Shops: ${JSON.stringify(shops.map(s => s.name))}
- Anime: ${JSON.stringify(filteredAnime.slice(0, 2).map(a => a.title))}
- Meals: ${JSON.stringify(meals.map(m => m.name))}
Write around 180-220 words.
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
      shops: shops,
      meals: meals
    };
  } catch (err) {
    console.error('[LLM Processor API Error] LLM request failed. Falling back to heuristics:', err);
    return processReport(
      rssItems,
      animeCalendar,
      bilibiliShows,
      shopSearchResults,
      eventSearchResults,
      preferences,
      location,
      weatherSearchResults,
      foodSearchResults,
      false
    );
  }
}

export async function processWeeklyReport(
  dailyReports: FinalReport[],
  animeCalendar: AnimeItem[],
  bilibiliShows: ActivityItem[],
  shopSearchResults: SearchResult[],
  preferences: Preferences,
  location: Location
): Promise<WeeklyReport> {
  const currentDate = getShanghaiDateString();
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

    const weeklyGamesPrimary: FinalReport['games_primary'] = [];
    const weeklyGamesSecondary: FinalReport['games_secondary'] = [];
    const weeklyTechPrimary: FinalReport['tech_primary'] = [];
    const weeklyTechSecondary: FinalReport['tech_secondary'] = [];

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

    const finalGamesPrimary = games_primary.length > 0 ? games_primary : [
      { title: '《仙境传说 Console Project》正式公布，重温仙境感动', description: '经典RO世界观角扮演新作公布，包含卡牌与动作元素。', link: '#', source: '机核', editor_comment: '编辑点评：经典仙境传说IP的主机化尝试，画风依然软萌，玩法值得期待。' }
    ];
    const finalGamesSecondary = games_secondary.length > 0 ? games_secondary : [
      { title: '《铁拳8》游戏总监池田幸平离任万代南梦宫', link: '#', source: '游研社' }
    ];
    const finalTechPrimary = tech_primary.length > 0 ? tech_primary : [
      { title: '少数派分享：「一日一偈」把经文带入轻阅读', description: '数码效率与轻型生活美学探讨，提升个人每日专注力。', link: '#', source: '少数派', editor_comment: '编辑点评：一次小而美的主观阅读生活美学实践，值得独立开发者借鉴。' }
    ];
    const finalTechSecondary = tech_secondary.length > 0 ? tech_secondary : [
      { title: '极客动态：海盗湾上线二十周年，互联网去中心化反思', link: '#', source: 'Solidot' }
    ];

    return {
      date: currentDate,
      summary: `周报快讯 (本地测试模式)：本周回顾为您汇集了过去多天生成的日报精华。针对新一周，我们在 ${location.primary} 为您定制了最新的“新番追番表”，并整理了未来 30 天内可购票 of 同城线下活动；精选了 3 个本地精品探店去处，祝您度过充实的一周。`,
      games_primary: finalGamesPrimary,
      games_secondary: finalGamesSecondary,
      tech_primary: finalTechPrimary,
      tech_secondary: finalTechSecondary,
      anime_calendar: animeCalendar,
      events: filteredEvents,
      shops: shops,
      stats: {
        total_articles: finalGamesPrimary.length + finalGamesSecondary.length + finalTechPrimary.length + finalTechSecondary.length,
        games_count: finalGamesPrimary.length + finalGamesSecondary.length,
        tech_count: finalTechPrimary.length + finalTechSecondary.length,
        events_count: filteredEvents.length,
        fun_insight: "本周（本地测试模式）您的二次元与技术世界一如既往地充实！有经典IP的主机化探索，也有去中心化互联网的深思。继续保持热爱！"
      }
    };
  }

  try {
    console.log('[LLM Processor] Generating Weekly Report via OpenAI...');

    const allGamesPrimary: FinalReport['games_primary'] = [];
    const allGamesSecondary: FinalReport['games_secondary'] = [];
    const allTechPrimary: FinalReport['tech_primary'] = [];
    const allTechSecondary: FinalReport['tech_secondary'] = [];

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
6. Generate a witty, humorous, or warm 60-80 character weekly insight summary in Chinese for "stats" -> "fun_insight" analyzing the user's weekly ACG/Tech interests or activities. Do not mention robotic filler phrases.

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
  "shops": [{ "name": "Name", "city": "${location.primary}", "category": "Category", "address": "Address", "description": "Desc" }],
  "stats": {
    "fun_insight": "Witty and engaging insight in Chinese about this week's trends or user profile (60-80 chars)."
  }
}
`;

    const weeklyResponse = await openaiClient.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: compilePrompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const parsedWeekly = parseCleanJson<ParsedWeeklyResponse>(weeklyResponse.choices[0].message.content || '{}');
    
    const allOriginalGames = [...allGamesPrimary, ...allGamesSecondary];
    const allOriginalTech = [...allTechPrimary, ...allTechSecondary];

    const games_primary = (parsedWeekly.best_games_primary || []).map((g) => {
      const match = allOriginalGames.find(orig => orig.title === g.title || g.title.includes(orig.title.slice(0, 5)));
      return { ...g, link: match ? match.link : '#' };
    });
    
    const games_secondary = (parsedWeekly.best_games_secondary || []).map((g) => {
      const match = allOriginalGames.find(orig => orig.title === g.title || g.title.includes(orig.title.slice(0, 5)));
      return { ...g, link: match ? match.link : '#' };
    });

    const tech_primary = (parsedWeekly.best_tech_primary || []).map((t) => {
      const match = allOriginalTech.find(orig => orig.title === t.title || t.title.includes(orig.title.slice(0, 5)));
      return { ...t, link: match ? match.link : '#' };
    });

    const tech_secondary = (parsedWeekly.best_tech_secondary || []).map((t) => {
      const match = allOriginalTech.find(orig => orig.title === t.title || t.title.includes(orig.title.slice(0, 5)));
      return { ...t, link: match ? match.link : '#' };
    });

    const shops: WeeklyReport['shops'] = parsedWeekly.shops || [];

    const stats = {
      total_articles: games_primary.length + games_secondary.length + tech_primary.length + tech_secondary.length,
      games_count: games_primary.length + games_secondary.length,
      tech_count: tech_primary.length + tech_secondary.length,
      events_count: filteredEvents.length,
      fun_insight: parsedWeekly.stats?.fun_insight || "本周你在数字世界和现实生活中都非常充实哦！"
    };

    // Create a beautiful weekly summary briefing
    const summaryPrompt = `
Generate a warm and motivating Weekly Briefing (周报前言) in Chinese for the user.
Speak as their AI life companion.
You MUST structure this briefing using clean Markdown bullet points to summarize the highlights for the week. For example:
哈罗！这是为你整理的本周看点总结，祝你度过充实的一周：

- 🎮 **本周游戏**：总结本周最精彩的游戏热点...
- 🚀 **科技精华**：总结本周最具前瞻性的科技突破...
- 📅 **追番与活动**：提及本周在 ${location.primary}/${location.secondary} 准备开票的线下同人展/展览活动以及周度番剧放送日程...
- ☕ **周末探店**：用轻松的语气推荐本周挑选的特色店面，适合周末放松小憩...

Highlight:
- That this is their personalized Weekly Report for the week of ${currentDate}.
- Briefly touch upon the major gaming and tech trends of the week.
- Remind them to check the dedicated "新番日历" page and upcoming events list in ${location.primary}/${location.secondary} for ticketing details.
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
      shops: shops,
      stats
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

    const parsed = parseCleanJson<ParsedIndicesResponse>(response.choices[0].message.content || '{}');
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

