import Parser from 'rss-parser';

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

  return allItems;
}
