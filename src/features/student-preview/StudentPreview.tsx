'use client';

import { useState } from 'react';
import Link from 'next/link';
import './student-preview.css';

type Screen = 'today' | 'assistant';
type AssistantState = 'empty' | 'thinking' | 'success' | 'ungrounded' | 'error';

export default function StudentPreview({ _lang = 'vi' }: { lang?: string; _lang?: string }) {
  void _lang;
  const [screen, setScreen] = useState<Screen>('today');
  const [todayEmpty, setTodayEmpty] = useState(false);
  const [assistantState, setAssistantState] = useState<AssistantState>('success');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [semesterCollapsed, setSemesterCollapsed] = useState(false);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [completedTasks, setCompletedTasks] = useState<Record<string, boolean>>({});

  // Mock Vietnamese dates
  const todayDateString = 'Thứ Bảy, 14 tháng 11, 2026';

  function toggleTask(id: string) {
    setCompletedTasks((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="sp-root">
      {/* 1. REVIEWER CONTROLS TOOLBAR */}
      <header className="sp-preview-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="sp-preview-badge">P5 Preview</span>
          <div className="sp-screen-switcher">
            <button
              type="button"
              className={`sp-switcher-btn ${screen === 'today' ? 'is-active' : ''}`}
              onClick={() => setScreen('today')}
            >
              Màn hình Hôm nay
            </button>
            <button
              type="button"
              className={`sp-switcher-btn ${screen === 'assistant' ? 'is-active' : ''}`}
              onClick={() => setScreen('assistant')}
            >
              Trợ lý học tập
            </button>
          </div>
        </div>

        {/* State simulator selectors */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {screen === 'today' ? (
            <div className="sp-state-selector">
              <span>Mô phỏng dữ liệu:</span>
              <button
                type="button"
                className={`sp-switcher-btn ${!todayEmpty ? 'is-active' : ''}`}
                onClick={() => setTodayEmpty(false)}
              >
                Có việc học
              </button>
              <button
                type="button"
                className={`sp-switcher-btn ${todayEmpty ? 'is-active' : ''}`}
                onClick={() => setTodayEmpty(true)}
              >
                Trạng thái trống
              </button>
            </div>
          ) : (
            <div className="sp-state-selector">
              <span>Trạng thái minh họa:</span>
              <select
                className="sp-state-select"
                value={assistantState}
                onChange={(e) => setAssistantState(e.target.value as AssistantState)}
              >
                <option value="empty">1. Chưa có hội thoại</option>
                <option value="thinking">2. Đang trả lời</option>
                <option value="success">3. Thành công (có trích dẫn & hành động)</option>
                <option value="ungrounded">4. Thiếu căn cứ (cảnh báo)</option>
                <option value="error">5. Lỗi kết nối mô hình</option>
              </select>
            </div>
          )}

          <div className="sp-toolbar-links">
            <Link href="/student" className="sp-toolbar-link">← Về Student hiện tại</Link>
            <Link href="/" className="sp-toolbar-link">◈ Office</Link>
          </div>
        </div>
      </header>

      {/* 2. MAIN APP SHELL */}
      <div className="sp-shell">
        {/* Left Navigation Sidebar */}
        <aside className={`sp-sidebar ${sidebarOpen ? 'is-mobile-open' : ''}`}>
          <div className="sp-sidebar-header">
            <a href="/student/preview" className="sp-brand">
              <span className="sp-brand-dot" />
              Student OS
            </a>
          </div>

          <nav className="sp-nav-group">
            <button
              type="button"
              className={`sp-nav-item ${screen === 'today' ? 'is-active' : ''}`}
              onClick={() => { setScreen('today'); setSidebarOpen(false); }}
            >
              <span>Hôm nay</span>
            </button>
            <button
              type="button"
              className={`sp-nav-item ${screen === 'assistant' ? 'is-active' : ''}`}
              onClick={() => { setScreen('assistant'); setSidebarOpen(false); }}
            >
              <span>Trợ lý học tập</span>
            </button>
            <button type="button" className="sp-nav-item" onClick={() => alert('Bản xem trước P5: Tính năng Nhật ký sẽ giữ nguyên logic P3-P4')}>
              <span>Nhật ký học tập</span>
            </button>
            <button type="button" className="sp-nav-item" onClick={() => alert('Bản xem trước P5: Danh sách học phần')}>
              <span>Học phần</span>
            </button>
            <button type="button" className="sp-nav-item" onClick={() => alert('Bản xem trước P5: Sở thích & ghi nhớ')}>
              <span>Sở thích chung</span>
            </button>
          </nav>

          {/* Collapsible Semester & Course section */}
          <div className="sp-collapse-section">
            <button
              type="button"
              className="sp-collapse-trigger"
              onClick={() => setSemesterCollapsed(!semesterCollapsed)}
            >
              <span>Học kỳ 1 · 2026-2027</span>
              <span className={`sp-collapse-icon ${!semesterCollapsed ? 'is-open' : ''}`}>▶</span>
            </button>

            {!semesterCollapsed && (
              <div style={{ marginTop: 4 }}>
                <div className="sp-semester-pill">
                  <span>Học kỳ hiện tại</span>
                  <span style={{ fontSize: 11, color: 'var(--sp-accent)' }}>Tuần 10</span>
                </div>
                <div className="sp-course-list">
                  <button type="button" className="sp-course-btn">
                    <span className="sp-course-code">CS201</span>
                    <span>Kiến trúc máy tính</span>
                  </button>
                  <button type="button" className="sp-course-btn">
                    <span className="sp-course-code">MA101</span>
                    <span>Giải tích 1</span>
                  </button>
                  <button type="button" className="sp-course-btn">
                    <span className="sp-course-code">CS305</span>
                    <span>Lập trình mạng</span>
                  </button>
                  <button type="button" className="sp-course-btn">
                    <span className="sp-course-code">ENG202</span>
                    <span>Tiếng Anh chuyên ngành</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="sp-sidebar-footer">
            <span>Offline SQLite · Asia/Bangkok</span>
          </div>
        </aside>

        {/* SCREEN 1: TODAY VIEW (MÀN HÌNH HÔM NAY) */}
        {screen === 'today' && (
          <main className="sp-main">
            {/* Top Bar */}
            <div className="sp-main-topbar">
              <div className="sp-date-display">
                <button
                  type="button"
                  className="sp-mobile-toggle-btn"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                >
                  ☰
                </button>
                <h1 className="sp-today-title">{todayDateString}</h1>
                <span className="sp-semester-tag">HK1 2026-2027 · Tuần 10</span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="sp-btn-primary">
                  <span>+</span> Thêm việc học
                </button>
              </div>
            </div>

            {/* Content: Empty State vs Normal State */}
            {todayEmpty ? (
              <div style={{ padding: '32px 28px', maxWidth: 760 }}>
                <div className="sp-empty-card">
                  <div className="sp-empty-icon">✓</div>
                  <h2 className="sp-empty-title">Chưa có việc học nào cho hôm nay</h2>
                  <p className="sp-empty-desc">
                    Lên kế hoạch các công việc cần làm hôm nay giúp bạn duy trì thói quen học tập đều đặn và không bỏ sót hạn nộp bài.
                  </p>
                  <button type="button" className="sp-btn-primary" style={{ marginTop: 8 }}>
                    + Thêm việc học đầu tiên
                  </button>
                </div>
              </div>
            ) : (
              <div className="sp-today-grid">
                {/* Main Column */}
                <div className="sp-col-main">
                  {/* Overdue Tasks Section */}
                  <section className="sp-card">
                    <div className="sp-card-header">
                      <h2 className="sp-card-title">
                        Việc quá hạn
                        <span className="sp-count-badge is-danger">2</span>
                      </h2>
                    </div>
                    <div className="sp-task-list">
                      <div className="sp-task-item is-overdue">
                        <input
                          type="checkbox"
                          className="sp-task-checkbox"
                          checked={!!completedTasks['od1']}
                          onChange={() => toggleTask('od1')}
                        />
                        <div className="sp-task-body">
                          <p className="sp-task-title" style={{ textDecoration: completedTasks['od1'] ? 'line-through' : 'none' }}>
                            Đọc Chương 4: Bộ nhớ Cache và phân cấp bộ nhớ
                          </p>
                          <div className="sp-task-meta">
                            <span className="sp-task-tag">CS201 · Kiến trúc máy tính</span>
                            <span>Ước tính: 45 phút</span>
                            <span className="sp-task-overdue-tag">Quá hạn 1 ngày</span>
                          </div>
                        </div>
                      </div>

                      <div className="sp-task-item is-overdue">
                        <input
                          type="checkbox"
                          className="sp-task-checkbox"
                          checked={!!completedTasks['od2']}
                          onChange={() => toggleTask('od2')}
                        />
                        <div className="sp-task-body">
                          <p className="sp-task-title" style={{ textDecoration: completedTasks['od2'] ? 'line-through' : 'none' }}>
                            Nộp bài tập trắc nghiệm Giải tích tuần 9
                          </p>
                          <div className="sp-task-meta">
                            <span className="sp-task-tag">MA101 · Giải tích 1</span>
                            <span>Ước tính: 30 phút</span>
                            <span className="sp-task-overdue-tag">Quá hạn 2 ngày</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Today's Tasks Section */}
                  <section className="sp-card">
                    <div className="sp-card-header">
                      <h2 className="sp-card-title">
                        Việc hôm nay
                        <span className="sp-count-badge">3</span>
                      </h2>
                      <span style={{ fontSize: 13, color: 'var(--sp-text-faint)' }}>Tổng: 2.5 giờ</span>
                    </div>
                    <div className="sp-task-list">
                      <div className="sp-task-item">
                        <input
                          type="checkbox"
                          className="sp-task-checkbox"
                          checked={!!completedTasks['td1']}
                          onChange={() => toggleTask('td1')}
                        />
                        <div className="sp-task-body">
                          <p className="sp-task-title" style={{ textDecoration: completedTasks['td1'] ? 'line-through' : 'none' }}>
                            Làm bài tập Pipeline Hazards & giải thích Forwarding
                          </p>
                          <div className="sp-task-meta">
                            <span className="sp-task-tag">CS201 · Kiến trúc máy tính</span>
                            <span>Ước tính: 60 phút</span>
                            <span style={{ color: 'var(--sp-accent)' }}>Hôm nay 17:00</span>
                          </div>
                        </div>
                      </div>

                      <div className="sp-task-item">
                        <input
                          type="checkbox"
                          className="sp-task-checkbox"
                          checked={!!completedTasks['td2']}
                          onChange={() => toggleTask('td2')}
                        />
                        <div className="sp-task-body">
                          <p className="sp-task-title" style={{ textDecoration: completedTasks['td2'] ? 'line-through' : 'none' }}>
                            Ôn tập công thức chuỗi Fourier và bài toán truyền nhiệt
                          </p>
                          <div className="sp-task-meta">
                            <span className="sp-task-tag">MA101 · Giải tích 1</span>
                            <span>Ước tính: 50 phút</span>
                            <span>Tối nay</span>
                          </div>
                        </div>
                      </div>

                      <div className="sp-task-item">
                        <input
                          type="checkbox"
                          className="sp-task-checkbox"
                          checked={!!completedTasks['td3']}
                          onChange={() => toggleTask('td3')}
                        />
                        <div className="sp-task-body">
                          <p className="sp-task-title" style={{ textDecoration: completedTasks['td3'] ? 'line-through' : 'none' }}>
                            Xem tài liệu Socket TCP/UDP trong Linux
                          </p>
                          <div className="sp-task-meta">
                            <span className="sp-task-tag">CS305 · Lập trình mạng</span>
                            <span>Ước tính: 40 phút</span>
                            <span>Tự do</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Continue Studying Courses */}
                  <section className="sp-card">
                    <div className="sp-card-header">
                      <h2 className="sp-card-title">Các môn để tiếp tục học</h2>
                      <a href="/student" style={{ fontSize: 13, color: 'var(--sp-accent)', textDecoration: 'none' }}>Tất cả học phần →</a>
                    </div>
                    <div className="sp-continue-grid">
                      <div className="sp-continue-card">
                        <div>
                          <span className="sp-continue-code">CS201</span>
                          <h3 className="sp-continue-name">Kiến trúc máy tính</h3>
                          <span style={{ fontSize: 12, color: 'var(--sp-text-muted)' }}>4 tài liệu PDF · 2 việc chờ</span>
                        </div>
                        <div className="sp-continue-footer" style={{ marginTop: 14 }}>
                          Tiếp tục học →
                        </div>
                      </div>

                      <div className="sp-continue-card">
                        <div>
                          <span className="sp-continue-code">MA101</span>
                          <h3 className="sp-continue-name">Giải tích 1</h3>
                          <span style={{ fontSize: 12, color: 'var(--sp-text-muted)' }}>2 tài liệu PDF · 1 việc chờ</span>
                        </div>
                        <div className="sp-continue-footer" style={{ marginTop: 14 }}>
                          Tiếp tục học →
                        </div>
                      </div>

                      <div className="sp-continue-card">
                        <div>
                          <span className="sp-continue-code">CS305</span>
                          <h3 className="sp-continue-name">Lập trình mạng</h3>
                          <span style={{ fontSize: 12, color: 'var(--sp-text-muted)' }}>3 tài liệu PDF · 1 việc chờ</span>
                        </div>
                        <div className="sp-continue-footer" style={{ marginTop: 14 }}>
                          Tiếp tục học →
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Secondary Column */}
                <div className="sp-col-side">
                  {/* Weekly Overview */}
                  <section className="sp-card">
                    <div className="sp-card-header">
                      <h2 className="sp-card-title">Tổng quan tuần</h2>
                      <span style={{ fontSize: 12, color: 'var(--sp-text-faint)' }}>09/11 - 15/11</span>
                    </div>

                    <div className="sp-week-summary-row">
                      <div className="sp-stat-box">
                        <div className="sp-stat-value">12.5h</div>
                        <div className="sp-stat-label">Thời gian học</div>
                      </div>
                      <div className="sp-stat-box">
                        <div className="sp-stat-value">8/11</div>
                        <div className="sp-stat-label">Việc hoàn thành</div>
                      </div>
                    </div>

                    <div className="sp-week-bars">
                      <div className="sp-day-col">
                        <div className="sp-bar-track">
                          <div className="sp-bar-fill" style={{ height: '70%' }} />
                        </div>
                        <span className="sp-day-label">T2</span>
                      </div>
                      <div className="sp-day-col">
                        <div className="sp-bar-track">
                          <div className="sp-bar-fill" style={{ height: '90%' }} />
                        </div>
                        <span className="sp-day-label">T3</span>
                      </div>
                      <div className="sp-day-col">
                        <div className="sp-bar-track">
                          <div className="sp-bar-fill" style={{ height: '40%' }} />
                        </div>
                        <span className="sp-day-label">T4</span>
                      </div>
                      <div className="sp-day-col">
                        <div className="sp-bar-track">
                          <div className="sp-bar-fill" style={{ height: '85%' }} />
                        </div>
                        <span className="sp-day-label">T5</span>
                      </div>
                      <div className="sp-day-col">
                        <div className="sp-bar-track">
                          <div className="sp-bar-fill" style={{ height: '100%' }} />
                        </div>
                        <span className="sp-day-label">T6</span>
                      </div>
                      <div className="sp-day-col">
                        <div className="sp-bar-track">
                          <div className="sp-bar-fill" style={{ height: '50%' }} />
                        </div>
                        <span className="sp-day-label" style={{ color: 'var(--sp-accent)' }}>T7</span>
                      </div>
                      <div className="sp-day-col">
                        <div className="sp-bar-track">
                          <div className="sp-bar-fill" style={{ height: '0%' }} />
                        </div>
                        <span className="sp-day-label">CN</span>
                      </div>
                    </div>
                  </section>

                  {/* Recent Logs */}
                  <section className="sp-card">
                    <div className="sp-card-header">
                      <h2 className="sp-card-title">Nhật ký gần đây</h2>
                      <span style={{ fontSize: 12, color: 'var(--sp-text-faint)' }}>P3 SQLite</span>
                    </div>
                    <div className="sp-log-list">
                      <div className="sp-log-item">
                        <div>
                          <div className="sp-log-title">Bài tập chuỗi Fourier</div>
                          <span style={{ fontSize: 11, color: 'var(--sp-text-faint)' }}>Hôm qua · MA101</span>
                        </div>
                        <span className="sp-log-time">90 phút</span>
                      </div>

                      <div className="sp-log-item">
                        <div>
                          <div className="sp-log-title">Đọc chương 3: ALU & Data Path</div>
                          <span style={{ fontSize: 11, color: 'var(--sp-text-faint)' }}>12/11 · CS201</span>
                        </div>
                        <span className="sp-log-time">60 phút</span>
                      </div>

                      <div className="sp-log-item">
                        <div>
                          <div className="sp-log-title">Từ vựng Unit 4 Networking</div>
                          <span style={{ fontSize: 11, color: 'var(--sp-text-faint)' }}>11/11 · ENG202</span>
                        </div>
                        <span className="sp-log-time">45 phút</span>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </main>
        )}

        {/* SCREEN 2: STUDY ASSISTANT (TRỢ LÝ HỌC TẬP) */}
        {screen === 'assistant' && (
          <div className="sp-assistant-layout">
            {/* Conversation List Sidebar */}
            <aside className={`sp-chat-sidebar ${chatSidebarOpen ? 'is-mobile-open' : ''}`}>
              <div className="sp-chat-sidebar-header">
                <button
                  type="button"
                  className="sp-btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => setAssistantState('empty')}
                >
                  + Hội thoại mới
                </button>
              </div>

              <div className="sp-conv-list">
                <button
                  type="button"
                  className={`sp-conv-item ${assistantState !== 'empty' ? 'is-active' : ''}`}
                  onClick={() => setAssistantState('success')}
                >
                  <span className="sp-conv-title">Pipeline hazards & xử lý rẽ nhánh</span>
                  <span className="sp-conv-date">CS201 · Hôm nay</span>
                </button>

                <button
                  type="button"
                  className="sp-conv-item"
                  onClick={() => setAssistantState('ungrounded')}
                >
                  <span className="sp-conv-title">Vi kiến trúc chip GPU chuyên dụng</span>
                  <span className="sp-conv-date">CS201 · Hôm qua</span>
                </button>

                <button
                  type="button"
                  className="sp-conv-item"
                  onClick={() => setAssistantState('success')}
                >
                  <span className="sp-conv-title">Chuỗi Fourier & biến đổi Laplace</span>
                  <span className="sp-conv-date">MA101 · 12/11</span>
                </button>

                <button
                  type="button"
                  className="sp-conv-item"
                  onClick={() => setAssistantState('success')}
                >
                  <span className="sp-conv-title">Giao thức bắt tay TCP 3 bước</span>
                  <span className="sp-conv-date">CS305 · 10/11</span>
                </button>
              </div>
            </aside>

            {/* Chat Main Area */}
            <div className="sp-chat-main">
              {/* Header: Provider & Model + Config Panel Toggle */}
              <div className="sp-chat-header">
                <div className="sp-chat-header-info">
                  <button
                    type="button"
                    className="sp-mobile-toggle-btn"
                    onClick={() => setChatSidebarOpen(!chatSidebarOpen)}
                  >
                    ☰ Hội thoại
                  </button>
                  <div className="sp-model-badge">
                    <span className="sp-model-status-dot" />
                    <span>Ollama Local · qwen2.5:7b</span>
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--sp-text-muted)' }}>Môn: Kiến trúc máy tính (CS201)</span>
                </div>

                <button
                  type="button"
                  className="sp-config-toggle"
                  onClick={() => setConfigPanelOpen(!configPanelOpen)}
                >
                  <span>Cấu hình ngữ cảnh & trả lời</span>
                  <span>{configPanelOpen ? '▲' : '▼'}</span>
                </button>
              </div>

              {/* Collapsible Config Panel */}
              {configPanelOpen && (
                <div className="sp-chat-config-panel">
                  <div className="sp-config-field">
                    <label className="sp-config-label">Nguồn tài liệu môn học</label>
                    <select className="sp-config-select" defaultValue="current">
                      <option value="current">CS201 · Kiến trúc máy tính (4 tài liệu PDF)</option>
                      <option value="all">Tất cả môn trong học kỳ 1</option>
                      <option value="none">Chỉ dùng kiến thức tổng quát (không kèm tài liệu)</option>
                    </select>
                  </div>

                  <div className="sp-config-field">
                    <label className="sp-config-label">Phong cách trả lời</label>
                    <select className="sp-config-select" defaultValue="academic">
                      <option value="academic">Học thuật & súc tích (kèm trích dẫn)</option>
                      <option value="detailed">Chi tiết từng bước kèm giải thích ví dụ</option>
                      <option value="socratic">Hỏi ngược gợi ý (phương pháp Socratic)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Chat Messages Container (Scrollable) */}
              <div className="sp-chat-messages">
                {/* STATE 1: EMPTY CHAT */}
                {assistantState === 'empty' && (
                  <div className="sp-empty-card" style={{ maxWidth: 640, margin: '40px auto 0' }}>
                    <div className="sp-empty-icon">💬</div>
                    <h2 className="sp-empty-title">Trợ lý học tập môn Kiến trúc máy tính</h2>
                    <p className="sp-empty-desc">
                      Hỏi bất kỳ kiến thức nào từ giáo trình và tài liệu slide đã tải lên. Trợ lý sẽ trích dẫn số trang chính xác cho bạn.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 12 }}>
                      <button
                        type="button"
                        className="sp-btn-secondary"
                        style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                        onClick={() => setAssistantState('thinking')}
                      >
                        💡 &ldquo;Pipeline hazards là gì và có mấy loại chính?&rdquo;
                      </button>
                      <button
                        type="button"
                        className="sp-btn-secondary"
                        style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                        onClick={() => setAssistantState('success')}
                      >
                        💡 &ldquo;Giải thích cơ chế phân cấp bộ nhớ Cache L1, L2, L3&rdquo;
                      </button>
                      <button
                        type="button"
                        className="sp-btn-secondary"
                        style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                        onClick={() => setAssistantState('ungrounded')}
                      >
                        💡 &ldquo;Kiến trúc GPU Tensor Core trong giáo trình có đề cập không?&rdquo;
                      </button>
                    </div>
                  </div>
                )}

                {/* STATE 2: THINKING / STREAMING */}
                {assistantState === 'thinking' && (
                  <>
                    <div className="sp-message is-user">
                      <div className="sp-message-bubble">
                        Pipeline hazards trong vi xử lý là gì và có mấy loại chính?
                      </div>
                    </div>
                    <div className="sp-message is-assistant">
                      <div className="sp-message-bubble">
                        <div className="sp-thinking-box">
                          <span className="sp-spinner" />
                          <span>Đang trích xuất nội dung từ KienTrucMayTinh_RISCV.pdf (trang 140–146)...</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* STATE 3: SUCCESS (FULL RESPONSE + CITATIONS + ACTIONS) */}
                {assistantState === 'success' && (
                  <>
                    <div className="sp-message is-user">
                      <div className="sp-message-bubble">
                        Pipeline hazards trong vi xử lý là gì và có mấy loại chính?
                      </div>
                    </div>

                    <div className="sp-message is-assistant">
                      <div className="sp-message-bubble">
                        <p style={{ margin: '0 0 10px 0' }}>
                          <strong>Pipeline Hazard (xung đột trong đường ống)</strong> là tình huống ngăn cản lệnh tiếp theo trong chuỗi chỉ thị được thực thi tại chu kỳ xung nhịp được chỉ định.
                        </p>
                        <p style={{ margin: '0 0 8px 0' }}>Có 3 loại xung đột chính được phân tích trong giáo trình:</p>
                        <ol style={{ margin: '0 0 12px 0', paddingLeft: 20 }}>
                          <li style={{ marginBottom: 6 }}>
                            <strong>Structural Hazard (Xung đột cấu trúc):</strong> Xảy ra khi phần cứng không đủ tài nguyên để hỗ trợ tất cả các lệnh thực thi đồng thời trong cùng một chu kỳ (ví dụ: chỉ có 1 cổng truy xuất bộ nhớ cho cả đọc lệnh và đọc dữ liệu).
                          </li>
                          <li style={{ marginBottom: 6 }}>
                            <strong>Data Hazard (Xung đột dữ liệu):</strong> Xảy ra khi một lệnh phụ thuộc vào kết quả của lệnh trước đó vẫn đang nằm trên pipeline chưa kịp ghi ngược về thanh ghi (RAW - Read After Write). Cách khắc phục phổ biến là kỹ thuật <em>Forwarding (Bypassing)</em>.
                          </li>
                          <li>
                            <strong>Control Hazard (Xung đột điều khiển):</strong> Phát sinh do các lệnh rẽ nhánh (branch, jump), khiến pipeline không biết trước lệnh tiếp theo cần nạp là gì cho đến khi điều kiện rẽ nhánh được tính toán xong.
                          </li>
                        </ol>

                        {/* Citation badges */}
                        <div className="sp-citations">
                          <span className="sp-citation-chip">📄 KienTrucMayTinh_RISCV.pdf · Trang 142</span>
                          <span className="sp-citation-chip">📄 BaiGiang_Chuong4_Pipeline.pdf · Trang 18</span>
                        </div>
                      </div>

                      {/* Quick action buttons below response */}
                      <div className="sp-message-actions">
                        <button type="button" className="sp-action-btn" onClick={() => alert('Đã lưu nội dung vào ghi chú môn CS201')}>
                          📌 Lưu vào ghi chú môn
                        </button>
                        <button type="button" className="sp-action-btn" onClick={() => alert('Đã mở hộp thoại ghi nhận nhật ký học tập (P3)')}>
                          ⏱️ Ghi vào nhật ký học tập
                        </button>
                        <button type="button" className="sp-action-btn" onClick={() => alert('Đã sao chép')}>
                          Sao chép
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* STATE 4: UNGROUNDED / LOW CONFIDENCE */}
                {assistantState === 'ungrounded' && (
                  <>
                    <div className="sp-message is-user">
                      <div className="sp-message-bubble">
                        Trong tài liệu môn học có phần nào hướng dẫn thiết kế kiến trúc Tensor Core cho GPU không?
                      </div>
                    </div>

                    <div className="sp-message is-assistant">
                      <div className="sp-message-bubble">
                        <div className="sp-ungrounded-banner">
                          <span>⚠️</span>
                          <div>
                            <strong>Thiếu căn cứ trong tài liệu môn học:</strong> Giáo trình hiện tại của môn <em>Kiến trúc máy tính (CS201)</em> chỉ tập trung vào vi xử lý đơn nhân RISC-V/MIPS và chưa có nội dung về Tensor Core của GPU.
                          </div>
                        </div>

                        <p style={{ margin: '0 0 10px 0' }}>
                          Dựa trên kiến thức kiến trúc máy tính tổng quát: Tensor Core là các khối phần cứng chuyên dụng được NVIDIA giới thiệu từ kiến trúc Volta (V100) để thực hiện phép nhân ma trận tích lũy (Fused Multiply-Add: D = A × B + C) trên các ma trận 4×4 hoặc 16×16 ở độ chính xác hỗn hợp (FP16/FP32).
                        </p>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--sp-text-muted)' }}>
                          Khuyến nghị: Bạn nên tra cứu thêm ở tài liệu chuyên đề Đồ họa & Xử lý song song.
                        </p>
                      </div>

                      <div className="sp-message-actions">
                        <button type="button" className="sp-action-btn">
                          🔍 Tìm trong tài liệu môn khác
                        </button>
                        <button type="button" className="sp-action-btn">
                          📌 Lưu ghi chú tham khảo
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* STATE 5: CONNECTION ERROR */}
                {assistantState === 'error' && (
                  <>
                    <div className="sp-message is-user">
                      <div className="sp-message-bubble">
                        Tổng hợp các công thức tính CPI trung bình và thời gian CPU thực thi chương trình?
                      </div>
                    </div>

                    <div className="sp-message is-assistant">
                      <div className="sp-error-banner">
                        <div>
                          <strong>❌ Lỗi kết nối mô hình AI cục bộ</strong>
                          <div style={{ marginTop: 4 }}>
                            Không thể kết nối đến Ollama tại <code>http://127.0.0.1:11434</code> (mô hình qwen2.5:7b chưa khởi động hoặc tiến trình bị tắt).
                          </div>
                        </div>
                        <button
                          type="button"
                          className="sp-btn-secondary"
                          style={{ flexShrink: 0, fontSize: 12 }}
                          onClick={() => setAssistantState('success')}
                        >
                          Thử lại
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Chat Input Bar (Pinned at bottom) */}
              <div className="sp-chat-input-bar">
                <div className="sp-chat-input-wrapper">
                  <input
                    type="text"
                    className="sp-chat-input"
                    placeholder="Hỏi trợ lý về bài học, slide hoặc tóm tắt tài liệu..."
                    defaultValue=""
                  />
                  <button type="button" className="sp-chat-send-btn" title="Gửi câu hỏi">
                    ↑
                  </button>
                </div>
                <div className="sp-chat-input-hint">
                  <span>Enter để gửi · Shift+Enter để xuống dòng</span>
                  <span>Ngữ cảnh: 4 tài liệu PDF môn CS201</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

