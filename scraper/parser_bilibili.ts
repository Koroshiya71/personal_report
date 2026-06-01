import axios from 'axios';

interface BilibiliProject {
  id?: number;
  project_id?: number;
  project_name?: string;
  name?: string;
  title?: string;
  venue_name?: string;
  venue?: string;
  show_time?: string;
  start_time?: string;
  end_time?: string;
  price_low?: number;
  price?: number;
  sale_flag_number?: number;
  sale_flag?: string;
  status?: string;
  cover?: string;
  image?: string;
  cover_url?: string;
  city?: string;
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

export async function fetchBilibiliShows(cityCodes: { [key: string]: string }): Promise<ActivityItem[]> {
  const allShows: ActivityItem[] = [];
  const categories = ['展会', '展览', '演出']; // Expos, art shows, performances

  for (const [cityName, cityCode] of Object.entries(cityCodes)) {
    for (const category of categories) {
      try {
        console.log(`[Bilibili] Fetching shows for ${cityName} (${cityCode}) under category ${category}`);
        
        // URL of Bilibili Member Purchase List API
        const url = `https://show.bilibili.com/api/ticket/project/listV2`;
        const response = await axios.get(url, {
          params: {
            version: 134,
            page: 1,
            pagesize: 12,
            area: cityCode,
            p_type: category,
            platform: 'web'
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://show.bilibili.com/platform/home.html'
          }
        });

        const dataContainer = response.data && response.data.data;
        const list = dataContainer && (dataContainer.result || dataContainer.list);

        if (response.data && response.data.errno === 0 && list && Array.isArray(list)) {
          console.log(`[Bilibili] Found ${list.length} shows in ${cityName} - ${category}`);
          
          if (list.length > 0) {
            console.log(`[Bilibili Debug] Item keys:`, Object.keys(list[0]));
          }

          list.forEach((proj: BilibiliProject) => {
            const id = proj.id || proj.project_id || Math.random().toString(36).substring(7);
            const title = proj.project_name || proj.name || proj.title || '未命名活动';
            const venue = proj.venue_name || proj.venue || '未知地点';
            
            let time = '时间待定';
            if (proj.start_time && proj.end_time) {
              time = proj.start_time === proj.end_time ? proj.start_time : `${proj.start_time} - ${proj.end_time}`;
            } else if (proj.start_time) {
              time = proj.start_time;
            } else if (proj.show_time) {
              time = proj.show_time;
            }

            const priceLow = proj.price_low !== undefined ? proj.price_low : proj.price;
            const priceStr = priceLow ? `￥${(priceLow / 100).toFixed(0)}起` : '免费/暂无售价';
            const status = proj.sale_flag || proj.status || '进行中';
            let cover = proj.cover || proj.image || proj.cover_url || '';
            if (cover && !cover.startsWith('http')) {
              cover = `https:${cover}`;
            }

            allShows.push({
              id: `bili-${id}`,
              title,
              venue,
              time,
              price: priceStr,
              status,
              cover,
              city: cityName,
              link: `https://show.bilibili.com/platform/detail.html?id=${id}`,
              source: `B站会员购 - ${category}`
            });
          });
        } else {
          console.warn(`[Bilibili Warn] Unexpected response format for ${cityName} - ${category}:`, response.data);
        }
      } catch (error) {
        console.error(`[Bilibili Error] Failed to fetch ${cityName} - ${category}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  // Deduplicate by ID
  const seenIds = new Set<string>();
  return allShows.filter(show => {
    if (seenIds.has(show.id)) return false;
    seenIds.add(show.id);
    return true;
  });
}
