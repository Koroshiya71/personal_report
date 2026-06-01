import Parser from 'rss-parser';
import axios from 'axios';
import * as cheerio from 'cheerio';

interface RssSource {
  name: string;
  url: string;
  category: string;
}

interface RssItem {
  title: string;
  link: string;
  pubDate?: string;
  contentSnippet?: string;
  source: string;
  category: string;
}

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});

async function fetchGameRes(): Promise<RssItem[]> {
  const items: RssItem[] = [];
  try {
    console.log(`[GameRes] Crawling latest developer articles from https://www.gameres.com/`);
    const response = await axios.get('https://www.gameres.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.gameres.com/'
      }
    });
    
    const $ = cheerio.load(response.data);
    $('.feed-item').each((i, el) => {
      const titleLinkEl = $(el).find('.feed-item-title-a');
      const title = titleLinkEl.text().trim();
      const relativeHref = titleLinkEl.attr('href') || '';
      const link = relativeHref.startsWith('http') ? relativeHref : `https://www.gameres.com${relativeHref}`;
      const description = $(el).find('.feed-item-right p').text().trim() || '暂无详细描述。';
      const markInfoText = $(el).find('.mark-info').text().trim();
      
      // Filter by time: keep if within 36 hours (e.g. "分钟前", "小时前", "昨天", "1天前")
      let isWithinWindow = false;
      if (markInfoText.includes('分钟前') || markInfoText.includes('小时前') || markInfoText.includes('刚刚')) {
        isWithinWindow = true;
      } else if (markInfoText.includes('昨天')) {
        isWithinWindow = true;
      } else if (markInfoText.includes('天前')) {
        const match = markInfoText.match(/(\d+)天前/);
        if (match) {
          const days = parseInt(match[1], 10);
          if (days <= 1) isWithinWindow = true;
        }
      } else {
        // Fallback: keep first few items if parser date format changes
        if (i < 4) isWithinWindow = true;
      }
      
      if (title && link && isWithinWindow) {
        items.push({
          title,
          link,
          pubDate: new Date().toISOString(),
          contentSnippet: description,
          source: 'GameRes 游资网',
          category: 'games'
        });
      }
    });
    console.log(`[GameRes] Successfully crawled ${items.length} recent articles.`);
  } catch (error) {
    console.error(`[GameRes Error] Failed to crawl GameRes:`, error instanceof Error ? error.message : error);
  }
  return items;
}

export async function parseRssFeeds(sources: RssSource[]): Promise<RssItem[]> {
  const allItems: RssItem[] = [];

  for (const source of sources) {
    try {
      console.log(`[RSS] Fetching: ${source.name} from ${source.url}`);
      const feed = await parser.parseURL(source.url);
      
      const now = new Date();
      const maxAgeMs = 36 * 60 * 60 * 1000; // 36 hours

      const items = (feed.items || [])
        .filter((item) => {
          const dateStr = item.isoDate || item.pubDate || '';
          if (!dateStr) return true; // Fallback: keep if no date is present
          const pubDate = new Date(dateStr);
          const ageMs = now.getTime() - pubDate.getTime();
          return ageMs >= 0 && ageMs <= maxAgeMs;
        })
        .slice(0, 12) // Keep up to 12 recent items per feed
        .map((item) => ({
          title: item.title || '',
          link: item.link || '',
          pubDate: item.pubDate || item.isoDate || '',
          contentSnippet: item.contentSnippet || item.content || '',
          source: source.name,
          category: source.category
        }));
      
      console.log(`[RSS] Successfully fetched ${items.length} items from ${source.name}`);
      allItems.push(...items);
    } catch (error) {
      console.error(`[RSS Error] Failed to fetch ${source.name}:`, error instanceof Error ? error.message : error);
    }
  }

  // Crawl GameRes as it has no public RSS feed
  const gameResItems = await fetchGameRes();
  allItems.push(...gameResItems);

  return allItems;
}
