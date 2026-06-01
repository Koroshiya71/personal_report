import { useState, useEffect } from 'react';
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
}

interface WeeklyReport {
  date: string;
  summary: string;
  games_primary: PrimaryNewsItem[];
  games_secondary: SecondaryNewsItem[];
  tech_primary: PrimaryNewsItem[];
  tech_secondary: SecondaryNewsItem[];
  anime_calendar: AnimeItem[];
  events: ActivityItem[];
  shops: ShopItem[];
}

const weekdaysOrder = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

const getTodayWeekday = () => {
  const day = new Date().getDay();
  const mapping = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return mapping[day];
};

const todayWeekday = getTodayWeekday();

function App() {
  const [activeTab, setActiveTab] = useState<'daily' | 'weekly'>('daily');
  const [dailyReports, setDailyReports] = useState<{ [date: string]: DailyReport }>({});
  const [weeklyReports, setWeeklyReports] = useState<{ [date: string]: WeeklyReport }>({});
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedAnimeDay, setSelectedAnimeDay] = useState<string>(todayWeekday);
  const [crawling, setCrawling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState<{ [key: string]: boolean }>({});

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
  const loadData = async () => {
    setLoading(true);
    try {
      const dailyRes = await fetch('/src/data/reports.json');
      if (dailyRes.ok) {
        const data = await dailyRes.json();
        setDailyReports(data);
      }
    } catch (e) {
      console.log('Daily reports not generated yet or missing.');
    }

    try {
      const weeklyRes = await fetch('/src/data/weekly.json');
      if (weeklyRes.ok) {
        const data = await weeklyRes.json();
        setWeeklyReports(data);
      }
    } catch (e) {
      console.log('Weekly reports not generated yet or missing.');
    }
    setLoading(false);
  };

  const handleCrawl = async () => {
    setCrawling(true);
    try {
      const res = await fetch('/api/crawl', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          alert('数据抓取任务已在后台启动！看板将在生成完成后自动刷新。');
        } else {
          alert('启动失败: ' + (data.error || '未知错误'));
          setCrawling(false);
        }
      } else {
        alert('接口调用失败。请确认服务运行于 Docker/NAS 环境中。如果是在本地调试，请在命令行中手动执行 npm run crawl。');
        setCrawling(false);
      }
    } catch (e) {
      alert('连接抓取接口失败。若是在本地开发，请使用 npm run crawl 命令行。');
      setCrawling(false);
    }
  };

  const handleUpdate = async () => {
    if (!window.confirm('确认要更新系统版本吗？服务将在后台从 Git 拉取最新代码，并自动重新编译。这需要几十秒到几分钟时间。')) {
      return;
    }
    setUpdating(true);
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          alert('系统更新已在后台启动！编译完成后页面将自动重新载入。');
        } else {
          alert('升级失败: ' + (data.error || '未知错误'));
          setUpdating(false);
        }
      } else {
        alert('接口调用失败。请确认服务运行于 Docker/NAS 环境中。');
        setUpdating(false);
      }
    } catch (e) {
      alert('连接更新接口失败。请确保容器网络正常。');
      setUpdating(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Poll task status in the background
  useEffect(() => {
    let intervalId: any;

    const pollStatus = async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const data = await res.json();

          setCrawling((prevCrawling) => {
            if (prevCrawling && !data.crawling) {
              alert('日报生成完成！已自动刷新看板数据。');
              loadData();
            }
            return data.crawling;
          });

          setUpdating((prevUpdating) => {
            if (prevUpdating && !data.updating) {
              alert('系统更新并编译完成！正在重新载入页面加载新版本。');
              window.location.reload();
            }
            return data.updating;
          });

          if (!data.crawling && !data.updating) {
            clearInterval(intervalId);
          }
        }
      } catch (e) {
        console.error('Failed to poll status:', e);
      }
    };

    // Check status immediately
    fetch('/api/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setCrawling(data.crawling);
          setUpdating(data.updating);
          if (data.crawling || data.updating) {
            intervalId = setInterval(pollStatus, 2000);
          }
        }
      })
      .catch((e) => console.error('Initial status check failed:', e));

    if (crawling || updating) {
      intervalId = setInterval(pollStatus, 2000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [crawling, updating]);

  // Auto-expand month containing the selectedDate
  useEffect(() => {
    if (selectedDate) {
      const month = getMonthStr(selectedDate);
      setExpandedMonths((prev) => ({ ...prev, [month]: true }));
    }
  }, [selectedDate]);

  // Set default selected date once reports are loaded
  useEffect(() => {
    if (activeTab === 'daily') {
      const dates = Object.keys(dailyReports).sort();
      if (dates.length > 0) {
        setSelectedDate(dates[dates.length - 1]); // default to latest
      } else {
        setSelectedDate('');
      }
    } else {
      const dates = Object.keys(weeklyReports).sort();
      if (dates.length > 0) {
        setSelectedDate(dates[dates.length - 1]); // default to latest
      } else {
        setSelectedDate('');
      }
    }
  }, [dailyReports, weeklyReports, activeTab]);

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

  const handleTabChange = (tab: 'daily' | 'weekly') => {
    setActiveTab(tab);
  };

  const datesToRender = activeTab === 'daily' 
    ? Object.keys(dailyReports).sort().reverse() 
    : Object.keys(weeklyReports).sort().reverse();

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
          </div>
          
          <div className="refresh-container">
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              数据定时在每天 09:00 更新
            </span>
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
            <button className="refresh-btn" onClick={loadData} disabled={crawling || updating}>
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
            {activeTab === 'daily' && activeDailyReport ? (
              <div className="report-wrapper">
                {/* TL;DR Today Summary */}
                <div className="tldr-card">
                  <div className="tldr-header">
                    <span style={{ fontSize: '18px' }}>💡</span>
                    <h3 className="tldr-title">TL;DR 今日总结</h3>
                  </div>
                  <p className="tldr-content">{activeDailyReport.summary}</p>
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
              </div>
            ) : activeTab === 'weekly' && activeWeeklyReport ? (
              <div className="report-wrapper">
                {/* Weekly summary */}
                <div className="tldr-card" style={{ borderLeftColor: 'var(--color-accent)' }}>
                  <div className="tldr-header">
                    <span style={{ fontSize: '18px' }}>📅</span>
                    <h3 className="tldr-title" style={{ color: 'white' }}>本周周报前言 (Weekly Synthesis)</h3>
                  </div>
                  <p className="tldr-content">{activeWeeklyReport.summary}</p>
                </div>

                {/* Weekly Anime Calendar (Day Tab Navigator) */}
                <section>
                  <h2 className="section-title anime-title">📅 新周番剧放送表</h2>
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
                    <div className="anime-tab-content-grid">
                      {getGroupedAnime(activeWeeklyReport.anime_calendar)[selectedAnimeDay || '星期一']?.length > 0 ? (
                        getGroupedAnime(activeWeeklyReport.anime_calendar)[selectedAnimeDay || '星期一'].map((anime, idx) => (
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
            ) : (
              <div className="empty-state">
                <span className="empty-icon">📁</span>
                <h3>未找到选定日期的 {activeTab === 'daily' ? '日报' : '周报'}</h3>
                <p style={{ maxWidth: '400px', margin: '8px auto', fontSize: '14px' }}>
                  请确保爬虫已运行并生成了数据。您可以在终端运行以下命令来生成报告：
                </p>
                <code style={{ marginTop: '12px', fontSize: '13px' }}>
                  npm run {activeTab === 'daily' ? 'crawl' : 'crawl:weekly'}
                </code>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
