import axios from 'axios';
import * as cheerio from 'cheerio';

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export async function searchTavily(query: string, apiKey: string): Promise<SearchResult[]> {
  try {
    console.log(`[Search - Tavily] Querying: "${query}"`);
    const response = await axios.post(
      'https://api.tavily.com/search',
      {
        api_key: apiKey,
        query: query,
        search_depth: 'basic',
        max_results: 5
      },
      {
        timeout: 10000
      }
    );

    if (response.data && response.data.results) {
      return response.data.results.map((res: { title?: string; url?: string; content?: string }) => ({
        title: res.title || '',
        url: res.url || '',
        content: res.content || ''
      }));
    }
  } catch (error) {
    console.error('[Search - Tavily Error] Failed, falling back to Baidu:', error instanceof Error ? error.message : error);
  }
  return searchBaidu(query);
}

export async function searchBaidu(query: string): Promise<SearchResult[]> {
  try {
    console.log(`[Search - Baidu] Querying: "${query}"`);
    const url = 'https://www.baidu.com/s';
    const response = await axios.get(url, {
      params: { wd: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
        'Cookie': 'BAIDUID=BA1D0000000000000000000000000000:FG=1;'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const results: SearchResult[] = [];

    $('.result, .c-container').each((_, elem) => {
      const titleElem = $(elem).find('h3.t a, h3 a');
      const title = titleElem.text().replace(/\s+/g, ' ').trim();
      const url = titleElem.attr('href') || '';
      
      let content = $(elem).find('.c-abstract, .content-right_3sz1H, .c-span18, .c-span24').text().trim();
      if (!content) {
        content = $(elem).find('.content_48332, .c-abstract').text().trim();
      }
      if (!content) {
        content = $(elem).text().replace(title, '').replace(/\s+/g, ' ').trim().slice(0, 150);
      }

      if (title && url) {
        results.push({ title, url, content });
      }
    });

    console.log(`[Search - Baidu] Found ${results.length} results`);
    return results.slice(0, 5); // Return top 5
  } catch (error) {
    console.error('[Search - Baidu Error] Search failed:', error instanceof Error ? error.message : error);
    return [];
  }
}

// Master search function that auto-selects based on availability of Tavily API Key
export async function performSearch(query: string, tavilyApiKey?: string): Promise<SearchResult[]> {
  if (tavilyApiKey && tavilyApiKey.trim() !== '') {
    return searchTavily(query, tavilyApiKey);
  } else {
    return searchBaidu(query);
  }
}
