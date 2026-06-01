import axios from 'axios';

interface BangumiItem {
  id: number;
  url: string;
  name: string;
  name_cn: string;
  summary: string;
  air_date: string;
  images?: {
    large?: string;
    common?: string;
    medium?: string;
  };
  rating?: {
    score?: number;
    total?: number;
  };
}

interface BangumiDay {
  weekday: {
    en: string;
    cn: string;
    id: number;
  };
  items: BangumiItem[];
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

export async function fetchBangumiCalendar(): Promise<AnimeItem[]> {
  try {
    console.log('[Bangumi] Fetching weekly calendar from https://api.bgm.tv/calendar');
    const response = await axios.get<BangumiDay[]>('https://api.bgm.tv/calendar', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 personal-report-tool'
      }
    });

    if (response.data && Array.isArray(response.data)) {
      const allAnimes: AnimeItem[] = [];

      response.data.forEach((day) => {
        const weekdayName = day.weekday.cn;
        const items = day.items || [];

        items.forEach((item) => {
          allAnimes.push({
            id: item.id,
            title: item.name_cn || item.name,
            originalTitle: item.name,
            airDate: item.air_date,
            weekday: weekdayName,
            rating: item.rating?.score || 0,
            cover: item.images?.medium || item.images?.common || '',
            link: item.url || `https://bgm.tv/subject/${item.id}`,
            summary: item.summary || ''
          });
        });
      });

      console.log(`[Bangumi] Found ${allAnimes.length} airing animes in this week's calendar`);
      return allAnimes;
    }
  } catch (error) {
    console.error('[Bangumi Error] Failed to fetch calendar:', error instanceof Error ? error.message : error);
  }
  return [];
}
