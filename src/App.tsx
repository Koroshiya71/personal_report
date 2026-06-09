import { useState, useEffect, useRef } from 'react';
import './App.css';

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

interface ShopItem {
  name: string;
  city: string;
  category: string;
  address: string;
  description: string;
  link?: string;
  source_urls?: string[];
  confidence?: 'high' | 'medium' | 'low';
}

interface PrimaryNewsItem {
  title: string;
  description: string;
  link: string;
  source: string;
  editor_comment: string;
}

interface SecondaryNewsItem {
  title: string;
  link: string;
  source: string;
}

interface MealRecommendation {
  name: string;
  cuisine: string;
  price_range: string;
  suitability_index: string;
  reason: string;
  address?: string;
  delivery_type: "支持外卖" | "仅限堂食" | "外卖/堂食皆可";
  source_urls?: string[];
  confidence?: 'high' | 'medium' | 'low';
}

type ViewTab = 'daily' | 'weekly' | 'anime' | 'favorites' | 'read_later';
type FeedbackType = 'favorite' | 'dislike' | 'more_like_this' | 'read_later';

interface FeedbackEntry {
  type: FeedbackType;
  itemTitle: string;
  itemCategory: string;
  itemLink?: string;
  createdAt: string;
}

interface DailyReport {
  date: string;
  summary: string;
  games_primary: PrimaryNewsItem[];
  games_secondary: SecondaryNewsItem[];
  tech_primary: PrimaryNewsItem[];
  tech_secondary: SecondaryNewsItem[];
  anime: AnimeItem[];
  events: ActivityItem[];
  shops?: ShopItem[];
  meals?: MealRecommendation[];
}

interface WeeklyReport {
  date: string;
  summary: string;
  games_primary: PrimaryNewsItem[];
  games_secondary: SecondaryNewsItem[];
  tech_primary: PrimaryNewsItem[];
  tech_secondary: SecondaryNewsItem[];
  anime_calendar?: AnimeItem[];
  events: ActivityItem[];
  shops: ShopItem[];
  stats?: {
    total_articles: number;
    games_count: number;
    tech_count: number;
    events_count: number;
    fun_insight: string;
  };
}

const weekdaysOrder = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

const getTodayWeekday = () => {
  const day = new Date().getDay();
  const mapping = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return mapping[day];
};

const todayWeekday = getTodayWeekday();
const ADMIN_TOKEN_STORAGE_KEY = 'personal_report_admin_token';
const getInitialAdminToken = () => {
  return (
    localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ||
    (import.meta.env.VITE_ADMIN_TOKEN || '')
  ).trim();
};

const getAdminHeaders = (token: string): HeadersInit | undefined => {
  return token ? { 'X-Admin-Token': token, Authorization: `Bearer ${token}` } : undefined;
};

const isConfirmedAddress = (address?: string) => {
  return Boolean(address && !address.includes('待确认') && !address.includes('未知'));
};

const confidenceLabel = (confidence?: 'high' | 'medium' | 'low') => {
  if (confidence === 'high') return '信息较可靠';
  if (confidence === 'low') return '信息待确认';
  return '信息一般';
};

function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('daily');
  const [dailyReports, setDailyReports] = useState<{ [date: string]: DailyReport }>({});
  const [weeklyReports, setWeeklyReports] = useState<{ [date: string]: WeeklyReport }>({});
  const [animeCalendar, setAnimeCalendar] = useState<AnimeItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedAnimeDay, setSelectedAnimeDay] = useState<string>(todayWeekday);
  const [crawling, setCrawling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const wasCrawling = useRef(false);
  const wasUpdating = useRef(false);
  const crawlStartTimeout = useRef(0);
  const updateStartTimeout = useRef(0);
  const [loading, setLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState<{ [key: string]: boolean }>({});
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);
  const [adminToken, setAdminToken] = useState(getInitialAdminToken);
  const [serverAdminTokenConfigured, setServerAdminTokenConfigured] = useState<boolean | null>(null);
  const [selfUpdateEnabled, setSelfUpdateEnabled] = useState<boolean | null>(null);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const saveAdminToken = (nextToken: string) => {
    const trimmedToken = nextToken.trim();
    if (trimmedToken) {
      localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmedToken);
    } else {
      localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
    setAdminToken(trimmedToken);
  };

  const handleAdminTokenSettings = () => {
    const nextToken = window.prompt('请输入 NAS 上配置的 ADMIN_TOKEN；留空并确认可清除本机保存的口令。', adminToken);
    if (nextToken === null) return;

    saveAdminToken(nextToken);
    showToast(nextToken.trim() ? '管理口令已保存到当前浏览器。' : '已清除当前浏览器保存的管理口令。', 'success');
  };

  const showAdminTokenHint = (status?: number, error?: string) => {
    if (status === 401) {
      showToast('管理口令不正确或尚未设置，请点击“管理口令”更新后再试。', 'error');
      return;
    }
    if (status === 503 || error?.includes('ADMIN_TOKEN')) {
      showToast('NAS 服务端还没有配置 ADMIN_TOKEN；请先在部署环境变量中配置并重启容器。', 'error');
      return;
    }
    showToast(error || '接口调用失败，请检查 NAS 服务状态。', 'error');
  };

  const loadFeedbackEntries = async () => {
    if (!adminToken) {
      setFeedbackEntries([]);
      return;
    }

    try {
      const res = await fetch('/api/feedback', {
        headers: getAdminHeaders(adminToken),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showAdminTokenHint(res.status, data.error || '读取收藏数据失败。');
        return;
      }
      setFeedbackEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      showToast('连接收藏数据接口失败。', 'error');
    }
  };

  const sendFeedback = async (
    type: FeedbackType,
    itemTitle: string,
    itemCategory: string,
    itemLink?: string
  ) => {
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getAdminHeaders(adminToken) || {}),
        },
        body: JSON.stringify({ type, itemTitle, itemCategory, itemLink }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showAdminTokenHint(res.status, data.error || '反馈保存失败，请确认 ADMIN_TOKEN 已配置。');
        return;
      }
      if (type === 'favorite' || type === 'read_later') {
        loadFeedbackEntries();
      }
      const label = type === 'favorite'
        ? '已收藏'
        : type === 'read_later'
          ? '已加入稍后再读'
          : type === 'dislike'
            ? '已标记不感兴趣'
            : '会参考这个方向推荐更多';
      showToast(label, 'success');
    } catch {
      showToast('连接反馈接口失败。', 'error');
    }
  };

  const FeedbackControls = ({
    title,
    category,
    link,
  }: {
    title: string;
    category: string;
    link?: string;
  }) => (
    <div className="feedback-controls" onClick={(event) => event.preventDefault()}>
      <button type="button" title="收藏" onClick={() => sendFeedback('favorite', title, category, link)}>收藏</button>
      <button type="button" title="稍后再读" onClick={() => sendFeedback('read_later', title, category, link)}>稍后读</button>
      <button type="button" title="不感兴趣" onClick={() => sendFeedback('dislike', title, category, link)}>不感兴趣</button>
      <button type="button" title="类似内容更多" onClick={() => sendFeedback('more_like_this', title, category, link)}>类似更多</button>
    </div>
  );

  const getMonthStr = (dateStr: string) => {
    const parts = dateStr.split('-');
    if (parts.length >= 2) {
      return `${parts[0]}年${parts[1]}月`;
    }
    return '其它归档';
  };

  // Group dates by YYYY-MM month format
  const getGroupedDates = (dates: string[]) => {
    const groups: { [month: string]: string[] } = {};
    dates.forEach((date) => {
      const month = getMonthStr(date);
      if (!groups[month]) {
        groups[month] = [];
      }
      groups[month].push(date);
    });
    return groups;
  };

  // Fetch report data at runtime
  const loadData = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    let loadedDaily: { [date: string]: DailyReport } = {};
    let loadedWeekly: { [date: string]: WeeklyReport } = {};
    const cacheBust = `?t=${Date.now()}`;

    try {
      const dailyRes = await fetch(`/src/data/reports.json${cacheBust}`, { cache: 'no-store' });
      if (dailyRes.ok) {
        const data = await dailyRes.json();
        setDailyReports(data);
        loadedDaily = data;
      }
    } catch {
      console.log('Daily reports not generated yet or missing.');
    }

    try {
      const weeklyRes = await fetch(`/src/data/weekly.json${cacheBust}`, { cache: 'no-store' });
      if (weeklyRes.ok) {
        const data = await weeklyRes.json();
        setWeeklyReports(data);
        loadedWeekly = data;
      }
    } catch {
      console.log('Weekly reports not generated yet or missing.');
    }

    try {
      const animeRes = await fetch(`/src/data/anime_calendar.json${cacheBust}`, { cache: 'no-store' });
      if (animeRes.ok) {
        const data = await animeRes.json();
        setAnimeCalendar(data);
      }
    } catch {
      console.log('Anime calendar not generated yet or missing.');
    }

    // Initialize selectedDate and expandedMonths here
    const targetReports = activeTab === 'weekly' ? loadedWeekly : loadedDaily;
    const dates = Object.keys(targetReports).sort();
    if (dates.length > 0) {
      const defaultDate = dates[dates.length - 1];
      setSelectedDate(defaultDate);
      const month = getMonthStr(defaultDate);
      setExpandedMonths((prev) => ({ ...prev, [month]: true }));
    } else {
      setSelectedDate('');
    }

    setLoading(false);
  };

  const handleCrawl = async () => {
    setCrawling(true);
    try {
      const res = await fetch('/api/crawl', { method: 'POST', headers: getAdminHeaders(adminToken) });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          wasCrawling.current = true;
          crawlStartTimeout.current = 0;
          showToast('数据抓取任务已在后台启动！看板将在生成完成后自动刷新。', 'info');
        } else {
          showToast('启动失败: ' + (data.error || '未知错误'), 'error');
          setCrawling(false);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        showAdminTokenHint(res.status, data.error || '接口调用失败。请确认服务运行于 Docker/NAS 环境中。如果是在本地调试，请在命令行中手动执行 npm run crawl。');
        setCrawling(false);
      }
    } catch {
      showToast('连接抓取接口失败。若是在本地开发，请使用 npm run crawl 命令行。', 'error');
      setCrawling(false);
    }
  };

  const handleUpdate = async () => {
    if (!window.confirm('确认要更新系统版本吗？服务将在后台从 Git 拉取最新代码，并自动重新编译。这需要几十秒到几分钟时间。')) {
      return;
    }
    setUpdating(true);
    try {
      const res = await fetch('/api/update', { method: 'POST', headers: getAdminHeaders(adminToken) });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (data.upToDate) {
            showToast('当前已是最新版本，无需更新！', 'success');
            setUpdating(false);
          } else {
            wasUpdating.current = true;
            updateStartTimeout.current = 0;
            showToast('检测到新版本，更新已在后台启动！编译完成后页面将自动重新载入。', 'info');
          }
        } else {
          showToast('升级失败: ' + (data.error || '未知错误'), 'error');
          setUpdating(false);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        showAdminTokenHint(res.status, data.error || '接口调用失败。请确认服务运行于 Docker/NAS 环境中。');
        setUpdating(false);
      }
    } catch {
      showToast('连接更新接口失败。请确保容器网络正常。', 'error');
      setUpdating(false);
    }
  };

  useEffect(() => {
    // Initial load: don't show loading screen trigger since loading state starts as true by default
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadFeedbackEntries();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  // Poll task status in the background
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const pollStatus = async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const data = await res.json();
          if (typeof data.adminTokenConfigured === 'boolean') {
            setServerAdminTokenConfigured(data.adminTokenConfigured);
          }
          if (typeof data.selfUpdateEnabled === 'boolean') {
            setSelfUpdateEnabled(data.selfUpdateEnabled);
          }

          if (data.crawling) {
            wasCrawling.current = true;
            crawlStartTimeout.current = 0;
            setCrawling(true);
          } else {
            if (wasCrawling.current) {
              showToast('日报生成完成！已自动刷新看板数据。', 'success');
              loadData(false);
              wasCrawling.current = false;
              setCrawling(false);
              crawlStartTimeout.current = 0;
            } else {
              setCrawling((prev) => {
                if (prev) {
                  crawlStartTimeout.current += 1;
                  if (crawlStartTimeout.current > 6) { // 12 seconds with 2s poll
                    showToast('抓取任务启动超时，请检查服务端日志。', 'error');
                    crawlStartTimeout.current = 0;
                    return false;
                  }
                  return true;
                }
                return false;
              });
            }
          }

          if (data.updating) {
            wasUpdating.current = true;
            updateStartTimeout.current = 0;
            setUpdating(true);
          } else {
            if (wasUpdating.current) {
              wasUpdating.current = false;
              setUpdating(false);
              updateStartTimeout.current = 0;
              if (data.lastUpdateUpToDate === true) {
                showToast('当前已经是最新版本，无需重新载入。', 'success');
              } else {
                showToast('系统更新并编译完成！正在重新载入页面加载新版本。', 'success');
                window.location.reload();
              }
            } else {
              setUpdating((prev) => {
                if (prev) {
                  updateStartTimeout.current += 1;
                  if (updateStartTimeout.current > 6) { // 12 seconds with 2s poll
                    showToast('更新任务启动超时，请检查服务端日志。', 'error');
                    updateStartTimeout.current = 0;
                    return false;
                  }
                  return true;
                }
                return false;
              });
            }
          }

          if (!data.crawling && !data.updating) {
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = undefined;
            }
          }
        }
      } catch (err) {
        console.error('Failed to poll status:', err);
      }
    };

    if (crawling || updating) {
      intervalId = setInterval(pollStatus, 2000);
    }

    // Check status immediately on mount or dependency change
    fetch('/api/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          if (typeof data.adminTokenConfigured === 'boolean') {
            setServerAdminTokenConfigured(data.adminTokenConfigured);
          }
          if (typeof data.selfUpdateEnabled === 'boolean') {
            setSelfUpdateEnabled(data.selfUpdateEnabled);
          }
          if (data.crawling) wasCrawling.current = true;
          if (data.updating) wasUpdating.current = true;
          setCrawling(data.crawling);
          setUpdating(data.updating);
        }
      })
      .catch((err) => console.error('Initial status check failed:', err));

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crawling, updating]);

  const renderMarkdown = (text: string) => {
    if (!text) return null;
    const lines = text.split('\n');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {lines.map((line, idx) => {
          if (!line.trim()) return <div key={idx} style={{ height: '8px' }} />;
          
          const parseBold = (content: string) => {
            const parts = content.split('**');
            return parts.map((part, pIdx) => {
              if (pIdx % 2 === 1) {
                return <strong key={pIdx} style={{ color: 'white', fontWeight: '600' }}>{part}</strong>;
              }
              return part;
            });
          };

          const listMatch = line.match(/^[-*]\s*(.*)$/);
          if (listMatch) {
            return (
              <div key={idx} className="tldr-list-item" style={{ display: 'flex', gap: '8px', paddingLeft: '8px', lineHeight: '1.6' }}>
                <span style={{ color: 'var(--color-primary, #6366f1)', marginRight: '4px' }}>•</span>
                <span style={{ color: 'var(--text-secondary)' }}>{parseBold(listMatch[1])}</span>
              </div>
            );
          }

          return (
            <p key={idx} style={{ margin: '4px 0', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
              {parseBold(line)}
            </p>
          );
        })}
      </div>
    );
  };

  const activeDailyReport = dailyReports[selectedDate];
  const activeWeeklyReport = weeklyReports[selectedDate];

  // Group weekly anime calendar by weekdays
  const getGroupedAnime = (animeList: AnimeItem[]) => {
    const grouped: { [day: string]: AnimeItem[] } = {};
    weekdaysOrder.forEach(day => {
      grouped[day] = [];
    });

    if (animeList) {
      animeList.forEach(anime => {
        const day = anime.weekday || '星期一';
        if (grouped[day]) {
          grouped[day].push(anime);
        } else {
          // In case day has different formatting
          const matchedDay = weekdaysOrder.find(d => d.includes(day) || day.includes(d));
          if (matchedDay) grouped[matchedDay].push(anime);
        }
      });
    }

    return grouped;
  };

  // todayWeekday is defined globally

  const getSavedFeedbackItems = (type: 'favorite' | 'read_later') => {
    const seen = new Set<string>();
    return feedbackEntries.filter((entry) => {
      if (entry.type !== type || !entry.itemTitle) return false;
      const key = `${entry.itemCategory}:${entry.itemTitle}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const formatSavedTime = (value: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const categoryLabel = (category: string) => {
    if (category.includes('game')) return '游戏';
    if (category.includes('tech')) return '科技';
    if (category.includes('event')) return '活动';
    if (category.includes('shop')) return '探店';
    if (category.includes('meal')) return '就餐';
    return category || '内容';
  };

  const renderSavedFeedbackPage = (type: 'favorite' | 'read_later') => {
    const items = getSavedFeedbackItems(type);
    const title = type === 'favorite' ? '收藏夹' : '稍后再读';
    const description = type === 'favorite'
      ? '这里收纳你明确觉得值得保留的内容。'
      : '这里放适合之后细读、回头处理的内容。';

    return (
      <div className="report-wrapper">
        <div className="saved-page-header">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button className="refresh-btn" type="button" onClick={loadFeedbackEntries}>
            刷新列表
          </button>
        </div>

        {items.length > 0 ? (
          <div className="saved-items-grid">
            {items.map((item, index) => {
              const content = (
                <>
                  <div className="saved-item-meta">
                    <span>{categoryLabel(item.itemCategory)}</span>
                    <span>{formatSavedTime(item.createdAt)}</span>
                  </div>
                  <h3>{item.itemTitle}</h3>
                  <div className="saved-item-footer">
                    <span>{item.itemLink ? '打开原文' : '暂无链接'}</span>
                    {item.itemLink && <span>→</span>}
                  </div>
                </>
              );

              return item.itemLink ? (
                <a
                  className="saved-item-card"
                  href={item.itemLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  key={`${item.itemCategory}-${item.itemTitle}-${index}`}
                >
                  {content}
                </a>
              ) : (
                <div className="saved-item-card" key={`${item.itemCategory}-${item.itemTitle}-${index}`}>
                  {content}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state saved-empty-state">
            <span className="empty-icon">{type === 'favorite' ? '⭐' : '🕒'}</span>
            <span>{type === 'favorite' ? '还没有收藏内容' : '还没有稍后再读内容'}</span>
          </div>
        )}
      </div>
    );
  };

  const handleTabChange = (tab: ViewTab) => {
    setActiveTab(tab);
    if (tab === 'anime' || tab === 'favorites' || tab === 'read_later') {
      if (tab === 'favorites' || tab === 'read_later') {
        loadFeedbackEntries();
      }
      return;
    }
    const reports = tab === 'daily' ? dailyReports : weeklyReports;
    const dates = Object.keys(reports).sort();
    if (dates.length > 0) {
      const defaultDate = dates[dates.length - 1];
      setSelectedDate(defaultDate);
      const month = getMonthStr(defaultDate);
      setExpandedMonths((prev) => ({ ...prev, [month]: true }));
    } else {
      setSelectedDate('');
    }
  };

  const datesToRender = activeTab === 'weekly'
    ? Object.keys(weeklyReports).sort().reverse()
    : activeTab === 'daily'
      ? Object.keys(dailyReports).sort().reverse()
      : [];

  return (
    <div className="dashboard-container">
      {/* 1. Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-icon">AI</div>
            <span className="logo-text">ACG & Life Report</span>
          </div>
        </div>
        <div className="sidebar-scroll">
          {activeTab === 'favorites' || activeTab === 'read_later' ? (
            <div className="saved-sidebar-content">
              <div className="section-label">{activeTab === 'favorites' ? '收藏统计' : '待读统计'}</div>
              <div className="anime-sidebar-stats-card">
                <h4>{activeTab === 'favorites' ? '收藏夹' : '稍后再读'}</h4>
                <div className="stats-row">
                  <span>当前条目</span>
                  <strong>{getSavedFeedbackItems(activeTab === 'favorites' ? 'favorite' : 'read_later').length} 条</strong>
                </div>
                <div className="stats-row">
                  <span>反馈总数</span>
                  <strong>{feedbackEntries.length} 条</strong>
                </div>
              </div>
              {!adminToken && (
                <div style={{ padding: '0 8px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  设置管理口令后可读取收藏数据
                </div>
              )}
            </div>
          ) : activeTab === 'anime' ? (
            <div className="anime-sidebar-content">
              <div className="section-label">放送周期日程</div>
              <div className="anime-sidebar-days">
                {weekdaysOrder.map(dayName => {
                  const dayAnimeCount = getGroupedAnime(animeCalendar)[dayName]?.length || 0;
                  const isSelected = selectedAnimeDay === dayName;
                  const isToday = dayName === todayWeekday;
                  return (
                    <div 
                      key={dayName}
                      className={`date-item anime-day-item ${isSelected ? 'active' : ''} ${isToday ? 'is-today-sidebar' : ''}`}
                      onClick={() => setSelectedAnimeDay(dayName)}
                    >
                      <span className="date-text">{dayName}</span>
                      <span className="badge badge-anime">
                        {dayAnimeCount} 部
                      </span>
                    </div>
                  );
                })}
              </div>
              
              <div className="anime-sidebar-stats-card">
                <h4>放送数据统计</h4>
                <div className="stats-row">
                  <span>本周新番总数</span>
                  <strong>{animeCalendar.length} 部</strong>
                </div>
                <div className="stats-row">
                  <span>今日放送新番</span>
                  <strong>{getGroupedAnime(animeCalendar)[todayWeekday]?.length || 0} 部</strong>
                </div>
                {animeCalendar.length > 0 && (
                  <div className="stats-row">
                    <span>平均番剧评分</span>
                    <strong>
                      {(
                        animeCalendar.reduce((sum, item) => sum + (item.rating || 0), 0) /
                        (animeCalendar.filter(item => (item.rating || 0) > 0).length || 1)
                      ).toFixed(2)} ⭐
                    </strong>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="section-label">往期归档</div>
              {datesToRender.length === 0 ? (
                <div style={{ padding: '0 8px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  暂无历史报告，请先运行抓取
                </div>
              ) : (
                <div className="date-list">
                  {Object.entries(getGroupedDates(datesToRender)).map(([monthName, dates]) => {
                    const isExpanded = !!expandedMonths[monthName];
                    return (
                      <div key={monthName} className="month-group">
                        <div 
                          className="month-header" 
                          onClick={() => setExpandedMonths(prev => ({ ...prev, [monthName]: !isExpanded }))}
                        >
                          <span className="month-title">{monthName}</span>
                          <span className={`month-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
                        </div>
                        {isExpanded && (
                          <div className="month-date-list">
                            {dates.map(date => (
                              <div 
                                key={date} 
                                className={`date-item ${selectedDate === date ? 'active' : ''}`}
                                onClick={() => setSelectedDate(date)}
                              >
                                <span className="date-text">{date}</span>
                                <span className={`badge ${activeTab === 'daily' ? 'badge-daily' : 'badge-weekly'}`}>
                                  {activeTab === 'daily' ? '日报' : '周报'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* 2. Main Work Area */}
      <main className="main-content">
        <header className="top-bar">
          <div className="view-selector">
            <button 
              className={`view-btn ${activeTab === 'daily' ? 'active' : ''}`}
              onClick={() => handleTabChange('daily')}
            >
              每日日报
            </button>
            <button 
              className={`view-btn ${activeTab === 'weekly' ? 'active' : ''}`}
              onClick={() => handleTabChange('weekly')}
            >
              每周周报
            </button>
            <button 
              className={`view-btn ${activeTab === 'anime' ? 'active' : ''}`}
              onClick={() => handleTabChange('anime')}
            >
              新番日历
            </button>
            <button
              className={`view-btn ${activeTab === 'favorites' ? 'active' : ''}`}
              onClick={() => handleTabChange('favorites')}
            >
              收藏夹
            </button>
            <button
              className={`view-btn ${activeTab === 'read_later' ? 'active' : ''}`}
              onClick={() => handleTabChange('read_later')}
            >
              稍后再读
            </button>
          </div>
          
          <div className="refresh-container">
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              数据定时在每天 09:00 更新
            </span>
            <button
              className={`admin-token-btn ${adminToken ? 'configured' : ''}`}
              type="button"
              onClick={handleAdminTokenSettings}
              title={
                serverAdminTokenConfigured === false
                  ? '服务端未配置 ADMIN_TOKEN'
                  : adminToken
                    ? '当前浏览器已保存管理口令'
                    : '设置管理口令'
              }
            >
              {adminToken ? '🔐 管理口令' : '🔓 设置口令'}
            </button>
            {serverAdminTokenConfigured === false && (
              <span className="admin-token-warning">服务端未配置</span>
            )}
            {serverAdminTokenConfigured && selfUpdateEnabled === false && (
              <span className="admin-token-warning">更新未启用</span>
            )}
            <button 
              className={`refresh-btn crawl-btn ${crawling ? 'loading' : ''}`} 
              onClick={handleCrawl}
              disabled={crawling || updating}
              style={{ 
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(6, 182, 212, 0.2))',
                borderColor: 'var(--color-primary)' 
              }}
            >
              {crawling ? '⚡ 正在抓取分析...' : '⚡ 手动生成日报'}
            </button>
            <button 
              className="refresh-btn" 
              onClick={handleUpdate} 
              disabled={crawling || updating}
            >
              {updating ? '⚙️ 正在更新中...' : '🔄 检查系统更新'}
            </button>
            <button className="refresh-btn" onClick={() => loadData(true)} disabled={crawling || updating}>
              🔄 刷新看板
            </button>
          </div>
        </header>

        {loading ? (
          <div className="loading-screen">
            <div className="spinner"></div>
            <p style={{ color: 'var(--text-secondary)' }}>正在读取本地数据...</p>
          </div>
        ) : (
          <div className="report-area">
            {activeTab === 'favorites' ? (
              renderSavedFeedbackPage('favorite')
            ) : activeTab === 'read_later' ? (
              renderSavedFeedbackPage('read_later')
            ) : activeTab === 'daily' && activeDailyReport ? (
              <div className="report-wrapper">
                {/* TL;DR Today Summary */}
                <div className="tldr-card">
                  <div className="tldr-header">
                    <span style={{ fontSize: '18px' }}>💡</span>
                    <h3 className="tldr-title">今日编辑判断</h3>
                  </div>
                  <div className="tldr-content">{renderMarkdown(activeDailyReport.summary)}</div>
                </div>

                {/* Games Section */}
                <section>
                  <h2 className="section-title">🎮 游戏精选资讯</h2>
                  {((activeDailyReport.games_primary && activeDailyReport.games_primary.length > 0) || 
                    (activeDailyReport.games_secondary && activeDailyReport.games_secondary.length > 0)) ? (
                    <>
                      {activeDailyReport.games_primary && activeDailyReport.games_primary.length > 0 && (
                        <div className="primary-cards-grid">
                          {activeDailyReport.games_primary.map((game, i) => (
                            <a key={i} className="primary-card" href={game.link} target="_blank" rel="noopener noreferrer">
                              <div className="card-top">
                                <div className="card-header">
                                  <span className="card-source">{game.source}</span>
                                </div>
                                <h4 className="card-title">{game.title}</h4>
                                <p className="card-desc">{game.description}</p>
                              </div>
                              {game.editor_comment && (
                                <div className="editor-comment-box">
                                  <span className="editor-comment-avatar">✍️ 编辑点评:</span>
                                  <span className="editor-comment-text">{game.editor_comment}</span>
                                </div>
                              )}
                              <FeedbackControls title={game.title} category="daily_game_primary" link={game.link} />
                              <div className="card-footer" style={{ marginTop: '12px' }}>
                                <span>深度分析</span>
                                <span className="read-more">阅读全文 →</span>
                              </div>
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Games Secondary */}
                      {activeDailyReport.games_secondary && activeDailyReport.games_secondary.length > 0 && (
                        <div className="secondary-section">
                          <div className="secondary-title">
                            <span>📰 次要快讯汇总</span>
                          </div>
                          <div className="secondary-list">
                            {activeDailyReport.games_secondary.map((game, i) => (
                              <a key={i} className="secondary-item" href={game.link} target="_blank" rel="noopener noreferrer">
                                <div className="secondary-item-left">
                                  <span className="secondary-bullet">•</span>
                                  <h5 className="secondary-item-title">{game.title}</h5>
                                </div>
                                <span className="secondary-item-source">{game.source}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon">🎮</span>
                      <span>今日暂无匹配偏好的游戏精选</span>
                    </div>
                  )}
                </section>



                {/* Offline Activities Section (Changes only) */}
                <section>
                  <h2 className="section-title">🎪 线下活动 (同城变更)</h2>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-10px', marginBottom: '16px' }}>
                    * 本板块仅推送过去 24 小时内新上架、刚开票或购票状态发生改变的同城（深圳/广州）活动
                  </p>
                  {activeDailyReport.events && activeDailyReport.events.length > 0 ? (
                    <div className="event-list">
                      {activeDailyReport.events.map((evt, i) => (
                        <a key={i} className="event-row" href={evt.link} target="_blank" rel="noopener noreferrer">
                          <img className="event-img" src={evt.cover || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=200'} alt={evt.title} referrerPolicy="no-referrer" />
                          <div className="event-details">
                            <div className="event-info">
                              <div className="event-title-line">
                                <span className="event-city-badge">{evt.city}</span>
                                <h4 className="event-title">{evt.title}</h4>
                              </div>
                              <div className="event-meta">
                                <span>📍 {evt.venue}</span>
                                <span>📅 {evt.time}</span>
                              </div>
                            </div>
                            <div className="event-right">
                              <span className="event-price">{evt.price}</span>
                              <span className={`event-status ${evt.status.includes('售') ? 'status-active' : ''}`}>{evt.status}</span>
                            </div>
                            <FeedbackControls title={evt.title} category="daily_event" link={evt.link} />
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon">🎪</span>
                      <span>今日无新增或状态改变的同城展演活动</span>
                    </div>
                  )}
                </section>

                {/* Tech Section */}
                <section>
                  <h2 className="section-title tech-title">🚀 前沿科技与极客新闻</h2>
                  {((activeDailyReport.tech_primary && activeDailyReport.tech_primary.length > 0) || 
                    (activeDailyReport.tech_secondary && activeDailyReport.tech_secondary.length > 0)) ? (
                    <>
                      {activeDailyReport.tech_primary && activeDailyReport.tech_primary.length > 0 && (
                        <div className="primary-cards-grid">
                          {activeDailyReport.tech_primary.map((tech, i) => (
                            <a key={i} className="primary-card tech-primary-card" href={tech.link} target="_blank" rel="noopener noreferrer">
                              <div className="card-top">
                                <div className="card-header">
                                  <span className="card-source tech-source">{tech.source}</span>
                                </div>
                                <h4 className="card-title">{tech.title}</h4>
                                <p className="card-desc">{tech.description}</p>
                              </div>
                              {tech.editor_comment && (
                                <div className="editor-comment-box">
                                  <span className="editor-comment-avatar">✍️ 编辑点评:</span>
                                  <span className="editor-comment-text">{tech.editor_comment}</span>
                                </div>
                              )}
                              <FeedbackControls title={tech.title} category="daily_tech_primary" link={tech.link} />
                              <div className="card-footer" style={{ marginTop: '12px' }}>
                                <span>前沿思考</span>
                                <span className="read-more" style={{ color: 'var(--color-secondary)' }}>阅读全文 →</span>
                              </div>
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Tech Secondary */}
                      {activeDailyReport.tech_secondary && activeDailyReport.tech_secondary.length > 0 && (
                        <div className="secondary-section">
                          <div className="secondary-title">
                            <span>📰 次要快讯汇总</span>
                          </div>
                          <div className="secondary-list">
                            {activeDailyReport.tech_secondary.map((tech, i) => (
                              <a key={i} className="secondary-item" href={tech.link} target="_blank" rel="noopener noreferrer">
                                <div className="secondary-item-left">
                                  <span className="secondary-bullet">•</span>
                                  <h5 className="secondary-item-title">{tech.title}</h5>
                                </div>
                                <span className="secondary-item-source">{tech.source}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon">🚀</span>
                      <span>今日暂无科技热点更新</span>
                    </div>
                  )}
                </section>

                {/* ACG/Anime Section (airing today) */}
                <section>
                  <h2 className="section-title anime-title">📺 今日番剧广播</h2>
                  {activeDailyReport.anime && activeDailyReport.anime.length > 0 ? (
                    <div className="event-list" style={{ gap: '10px' }}>
                      {activeDailyReport.anime.map((anime, i) => (
                        <a key={i} className="anime-daily-row" href={anime.link} target="_blank" rel="noopener noreferrer">
                          <img className="anime-daily-img" src={anime.cover || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=100'} alt={anime.title} referrerPolicy="no-referrer" />
                          <div className="anime-daily-info">
                            <h4 className="anime-daily-title">{anime.title}</h4>
                            <div className="anime-daily-sub">
                              {anime.originalTitle} • {anime.airDate}
                            </div>
                          </div>
                          {anime.rating > 0 && (
                            <div className="anime-daily-rating">⭐ {anime.rating.toFixed(1)}</div>
                          )}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon">📺</span>
                      <span>今日没有新番放送</span>
                    </div>
                  )}
                </section>

                {/* Daily Meal Recommendations Section */}
                <section>
                  <h2 className="section-title meal-title">🍱 今日就餐建议 (外卖 & 单人友好)</h2>
                  {activeDailyReport.meals && activeDailyReport.meals.length > 0 ? (
                    <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                      {activeDailyReport.meals.map((meal, i) => (
                        <div key={i} className="meal-card">
                          <div className="meal-card-header">
                            <h4 className="meal-name">{meal.name}</h4>
                            <span className={`delivery-badge ${meal.delivery_type === '支持外卖' ? 'badge-delivery-takeout' : 'badge-delivery-dinein'}`}>
                              {meal.delivery_type}
                            </span>
                          </div>
                          <div className="meal-card-body">
                            <div className="meal-meta-row">
                              <span className="meal-cuisine-tag">{meal.cuisine}</span>
                              <span className="meal-price-tag">{meal.price_range}</span>
                              {meal.confidence && (
                                <span className={`meal-confidence confidence-${meal.confidence}`}>
                                  {confidenceLabel(meal.confidence)}
                                </span>
                              )}
                            </div>
                            
                            <div className="meal-suitability-box">
                              <span className="suitability-icon">🌡️</span>
                              <span className="suitability-text">{meal.suitability_index}</span>
                            </div>
                            
                            <p className="meal-reason-text">{meal.reason}</p>
                            
                            {meal.address && (
                              <div className="meal-address-box">
                                <span className="address-icon">📍</span>
                                <span className="address-text" title={meal.address}>{meal.address}</span>
                                {isConfirmedAddress(meal.address) && (
                                  <a
                                    className="meal-map-btn"
                                    href={`https://map.baidu.com/?newmap=1&ie=utf-8&s=s%26wd%3D${encodeURIComponent(meal.address + ' ' + meal.name)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    🗺️ 导航
                                  </a>
                                )}
                              </div>
                            )}
                            <FeedbackControls title={meal.name} category="meal" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon">🍱</span>
                      <span>今日暂无就餐建议</span>
                    </div>
                  )}
                </section>
              </div>
            ) : activeTab === 'weekly' && activeWeeklyReport ? (
              <div className="report-wrapper">
                {/* Weekly summary */}
                <div className="tldr-card" style={{ borderLeftColor: 'var(--color-accent)' }}>
                  <div className="tldr-header">
                    <span style={{ fontSize: '18px' }}>📅</span>
                    <h3 className="tldr-title" style={{ color: 'white' }}>本周周报前言 (Weekly Synthesis)</h3>
                  </div>
                  <div className="tldr-content">{renderMarkdown(activeWeeklyReport.summary)}</div>
                </div>

                {/* Weekly Stats Section (Strategy D) */}
                {(() => {
                  const stats = activeWeeklyReport.stats || {
                    total_articles: (activeWeeklyReport.games_primary?.length || 0) + (activeWeeklyReport.games_secondary?.length || 0) + (activeWeeklyReport.tech_primary?.length || 0) + (activeWeeklyReport.tech_secondary?.length || 0),
                    games_count: (activeWeeklyReport.games_primary?.length || 0) + (activeWeeklyReport.games_secondary?.length || 0),
                    tech_count: (activeWeeklyReport.tech_primary?.length || 0) + (activeWeeklyReport.tech_secondary?.length || 0),
                    events_count: (activeWeeklyReport.events?.length || 0),
                    fun_insight: "本周数据趣味分析：你在二次元和三次元世界之间取得了完美的平衡！新番追更不停，线下漫展活动也时刻关注。继续保持对科技和游戏的热爱吧！"
                  };
                  return (
                    <section className="weekly-stats-section">
                      <h2 className="section-title stats-title">📊 本周数据趣味盘点</h2>
                      <div className="stats-grid">
                        <div className="stat-card">
                          <span className="stat-icon">📰</span>
                          <div className="stat-info">
                            <span className="stat-label">阅读资讯总数</span>
                            <span className="stat-value">{stats.total_articles} <span className="stat-unit">篇</span></span>
                          </div>
                        </div>
                        <div className="stat-card">
                          <span className="stat-icon">🎮</span>
                          <div className="stat-info">
                            <span className="stat-label">游戏热点追踪</span>
                            <span className="stat-value">{stats.games_count} <span className="stat-unit">篇</span></span>
                          </div>
                        </div>
                        <div className="stat-card">
                          <span className="stat-icon">🚀</span>
                          <div className="stat-info">
                            <span className="stat-label">前沿科技洞察</span>
                            <span className="stat-value">{stats.tech_count} <span className="stat-unit">篇</span></span>
                          </div>
                        </div>
                        <div className="stat-card">
                          <span className="stat-icon">🎪</span>
                          <div className="stat-info">
                            <span className="stat-label">同城活动筛选</span>
                            <span className="stat-value">{stats.events_count} <span className="stat-unit">场</span></span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="fun-insight-card">
                        <div className="insight-header">
                          <span className="insight-icon">🔮</span>
                          <h4 className="insight-title">AI 周度趣味洞察</h4>
                        </div>
                        <p className="insight-content">{stats.fun_insight}</p>
                      </div>
                    </section>
                  );
                })()}

                {/* Shenzhen/Guangzhou Local Shop Recommendations */}
                <section>
                  <h2 className="section-title shop-title">☕ 周末闲暇特色探店</h2>
                  {activeWeeklyReport.shops && activeWeeklyReport.shops.length > 0 ? (
                    <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                      {activeWeeklyReport.shops.map((shop, i) => (
                        <div key={i} className="shop-card">
                          <div className="shop-banner">
                            <h4 className="shop-name">{shop.name}</h4>
                            <span className="shop-category-tag">{shop.category}</span>
                          </div>
                          <div className="shop-body">
                            <p className="shop-desc">{shop.description}</p>
                            <div className="shop-meta-line">
                              <div className="shop-meta-item">
                                <span className="shop-meta-icon">📍</span>
                                <span className="shop-meta-text">{shop.address}</span>
                              </div>
                              <a 
                                className="map-btn"
                                href={`https://map.baidu.com/?newmap=1&ie=utf-8&s=s%26wd%3D${encodeURIComponent(shop.city + ' ' + shop.name)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                🗺️ 地图导航
                              </a>
                            </div>
                            <FeedbackControls title={shop.name} category="weekly_shop" link={shop.link || shop.source_urls?.[0]} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon">☕</span>
                      <span>本周暂无推荐探店</span>
                    </div>
                  )}
                </section>

                {/* Full Upcoming 30-day Event Calendar */}
                <section>
                  <h2 className="section-title">🎪 线下活动 (未来30天全局列表)</h2>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-10px', marginBottom: '16px' }}>
                    * 本板块为您归纳未来 30 天内所有在深圳/广州举办、仍处于可购票/报名阶段的漫展与展演活动全局列表
                  </p>
                  {activeWeeklyReport.events && activeWeeklyReport.events.length > 0 ? (
                    <div className="event-list">
                      {activeWeeklyReport.events.map((evt, i) => (
                        <a key={i} className="event-row" href={evt.link} target="_blank" rel="noopener noreferrer">
                          <img className="event-img" src={evt.cover || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=200'} alt={evt.title} referrerPolicy="no-referrer" />
                          <div className="event-details">
                            <div className="event-info">
                              <div className="event-title-line">
                                <span className="event-city-badge">{evt.city}</span>
                                <h4 className="event-title">{evt.title}</h4>
                              </div>
                              <div className="event-meta">
                                <span>📍 {evt.venue}</span>
                                <span>📅 {evt.time}</span>
                              </div>
                            </div>
                            <div className="event-right">
                              <span className="event-price">{evt.price}</span>
                              <span className={`event-status ${evt.status.includes('售') ? 'status-active' : ''}`}>{evt.status}</span>
                            </div>
                            <FeedbackControls title={evt.title} category="weekly_event" link={evt.link} />
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon">🎪</span>
                      <span>未来30天内无处于售票期的展演活动</span>
                    </div>
                  )}
                </section>

                {/* Weekly aggregated Games section */}
                <section>
                  <h2 className="section-title">🎮 本周推荐游戏动态</h2>
                  {((activeWeeklyReport.games_primary && activeWeeklyReport.games_primary.length > 0) || 
                    (activeWeeklyReport.games_secondary && activeWeeklyReport.games_secondary.length > 0)) ? (
                    <>
                      {activeWeeklyReport.games_primary && activeWeeklyReport.games_primary.length > 0 && (
                        <div className="primary-cards-grid">
                          {activeWeeklyReport.games_primary.map((game, i) => (
                            <a key={i} className="primary-card" href={game.link} target="_blank" rel="noopener noreferrer">
                              <div className="card-top">
                                <div className="card-header">
                                  <span className="card-source">{game.source || '本周精选'}</span>
                                </div>
                                <h4 className="card-title">{game.title}</h4>
                                <p className="card-desc">{game.description}</p>
                              </div>
                              {game.editor_comment && (
                                <div className="editor-comment-box">
                                  <span className="editor-comment-avatar">✍️ 编辑点评:</span>
                                  <span className="editor-comment-text">{game.editor_comment}</span>
                                </div>
                              )}
                              <FeedbackControls title={game.title} category="weekly_game_primary" link={game.link} />
                              <div className="card-footer" style={{ marginTop: '12px' }}>
                                <span>本周精选</span>
                                <span className="read-more">阅读全文 →</span>
                              </div>
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Games Secondary */}
                      {activeWeeklyReport.games_secondary && activeWeeklyReport.games_secondary.length > 0 && (
                        <div className="secondary-section">
                          <div className="secondary-title">
                            <span>📰 本周其它精彩动态</span>
                          </div>
                          <div className="secondary-list">
                            {activeWeeklyReport.games_secondary.map((game, i) => (
                              <a key={i} className="secondary-item" href={game.link} target="_blank" rel="noopener noreferrer">
                                <div className="secondary-item-left">
                                  <span className="secondary-bullet">•</span>
                                  <h5 className="secondary-item-title">{game.title}</h5>
                                </div>
                                <span className="secondary-item-source">{game.source}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="empty-state">
                      <span>暂无本周游戏汇总</span>
                    </div>
                  )}
                </section>

                {/* Weekly aggregated Tech section */}
                <section>
                  <h2 className="section-title tech-title">🚀 本周科技热点精华</h2>
                  {((activeWeeklyReport.tech_primary && activeWeeklyReport.tech_primary.length > 0) || 
                    (activeWeeklyReport.tech_secondary && activeWeeklyReport.tech_secondary.length > 0)) ? (
                    <>
                      {activeWeeklyReport.tech_primary && activeWeeklyReport.tech_primary.length > 0 && (
                        <div className="primary-cards-grid">
                          {activeWeeklyReport.tech_primary.map((tech, i) => (
                            <a key={i} className="primary-card tech-primary-card" href={tech.link} target="_blank" rel="noopener noreferrer">
                              <div className="card-top">
                                <div className="card-header">
                                  <span className="card-source tech-source">{tech.source || '本周精选'}</span>
                                </div>
                                <h4 className="card-title">{tech.title}</h4>
                                <p className="card-desc">{tech.description}</p>
                              </div>
                              {tech.editor_comment && (
                                <div className="editor-comment-box">
                                  <span className="editor-comment-avatar">✍️ 编辑点评:</span>
                                  <span className="editor-comment-text">{tech.editor_comment}</span>
                                </div>
                              )}
                              <FeedbackControls title={tech.title} category="weekly_tech_primary" link={tech.link} />
                              <div className="card-footer" style={{ marginTop: '12px' }}>
                                <span>本周精选</span>
                                <span className="read-more" style={{ color: 'var(--color-secondary)' }}>阅读全文 →</span>
                              </div>
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Tech Secondary */}
                      {activeWeeklyReport.tech_secondary && activeWeeklyReport.tech_secondary.length > 0 && (
                        <div className="secondary-section">
                          <div className="secondary-title">
                            <span>📰 本周其它精彩动态</span>
                          </div>
                          <div className="secondary-list">
                            {activeWeeklyReport.tech_secondary.map((tech, i) => (
                              <a key={i} className="secondary-item" href={tech.link} target="_blank" rel="noopener noreferrer">
                                <div className="secondary-item-left">
                                  <span className="secondary-bullet">•</span>
                                  <h5 className="secondary-item-title">{tech.title}</h5>
                                </div>
                                <span className="secondary-item-source">{tech.source}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="empty-state">
                      <span>暂无本周科技汇总</span>
                    </div>
                  )}
                </section>
              </div>
            ) : activeTab === 'anime' ? (
              <div className="report-wrapper">
                <div className="tldr-card" style={{ borderLeftColor: 'var(--color-anime, #ec4899)' }}>
                  <div className="tldr-header">
                    <span style={{ fontSize: '18px' }}>📺</span>
                    <h3 className="tldr-title" style={{ color: 'white' }}>全局追番日历 (Anime Calendar)</h3>
                  </div>
                  <p className="tldr-content">
                    这里是本季度正在热播的动漫放送表。数据每周一自动拉取并更新。你可以点击左侧栏或下方星期标签切换查看每天的放送详情。
                  </p>
                </div>

                <section>
                  <div className="anime-tabs-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 className="section-title anime-title" style={{ margin: 0 }}>📅 {selectedAnimeDay} 放送节目单</h2>
                  </div>
                  
                  <div className="anime-tabs-container">
                    <div className="anime-day-tabs">
                      {weekdaysOrder.map(dayName => (
                        <button
                          key={dayName}
                          className={`anime-day-tab-btn ${selectedAnimeDay === dayName ? 'active' : ''} ${dayName === todayWeekday ? 'is-today' : ''}`}
                          onClick={() => setSelectedAnimeDay(dayName)}
                        >
                          {dayName}
                        </button>
                      ))}
                    </div>
                    <div className="anime-tab-content-grid" style={{ marginTop: '20px' }}>
                      {getGroupedAnime(animeCalendar)[selectedAnimeDay || '星期一']?.length > 0 ? (
                        getGroupedAnime(animeCalendar)[selectedAnimeDay || '星期一'].map((anime, idx) => (
                          <a key={idx} className="anime-card-detailed" href={anime.link} target="_blank" rel="noopener noreferrer">
                            <img className="anime-cover-detailed" src={anime.cover || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=100'} alt={anime.title} referrerPolicy="no-referrer" />
                            <div className="anime-info-detailed">
                              <div style={{ minWidth: 0 }}>
                                <h5 className="anime-title-detailed" title={anime.title}>{anime.title}</h5>
                                <p className="anime-subtitle-detailed" title={anime.originalTitle}>{anime.originalTitle}</p>
                              </div>
                              <div className="anime-meta-detailed">
                                <span className="anime-time-detailed">{anime.airDate}</span>
                                {anime.rating > 0 && (
                                  <span className="anime-rating-detailed">⭐ {anime.rating.toFixed(1)}</span>
                                )}
                              </div>
                            </div>
                          </a>
                        ))
                      ) : (
                        <div className="empty-state" style={{ gridColumn: '1 / -1', padding: '30px' }}>
                          <span className="empty-icon">📺</span>
                          <span>该日暂无新番放送</span>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-icon">📁</span>
                <h3>未找到选定日期的 {activeTab === 'daily' ? '日报' : activeTab === 'weekly' ? '周报' : '内容'}</h3>
                <p style={{ maxWidth: '400px', margin: '8px auto', fontSize: '14px' }}>
                  请确保爬虫已运行并生成了数据。您可以在终端运行以下命令来生成报告：
                </p>
                <code style={{ marginTop: '12px', fontSize: '13px' }}>
                  npm run {activeTab === 'daily' ? 'crawl' : activeTab === 'weekly' ? 'crawl:weekly' : 'crawl'}
                </code>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span className="toast-icon">
              {toast.type === 'success' && '✅'}
              {toast.type === 'error' && '❌'}
              {toast.type === 'info' && '⚡'}
            </span>
            <span className="toast-message">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
