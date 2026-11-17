// The study heatmap & progress panel: 12-month GitHub-style contribution matrix, streak, and daily plan.
// Static markup: the office's code (src/office/replay/timeline.js) fills it in with live offline SQLite data.
import { getT } from '@/i18n/server';

export default async function TimelinePanel() {
  const t = await getT();
  return (
    <section className="tl tl-study" id="tl" hidden role="dialog" aria-labelledby="tl-title">
      <header className="tl-head">
        <div className="tl-title">
          <h2 id="tl-title">{t('ui.timeline.title')}</h2>
          <p id="tl-subtitle">{t('ui.timeline.intro')}</p>
        </div>
        <div className="seg tl-ranges" id="tl-courses-filter" role="group" aria-label="Lọc môn học">
          <button type="button" data-course="" aria-pressed="true">Tất cả môn</button>
        </div>
        <div className="tl-head-actions">
          <button type="button" className="btn btn--sm" id="tl-add-task-btn" title="Thêm việc cần làm hôm nay">
            <span data-icon="plus"></span>Thêm việc
          </button>
          <button type="button" className="btn btn--sm" id="tl-add-log-btn" title="Ghi nhận thời gian học thực tế">
            <span data-icon="pencil"></span>Ghi nhật ký
          </button>
          <button type="button" className="icon-btn" id="tl-close" aria-label={t('common.close')}>
            <span data-icon="x"></span>
          </button>
        </div>
      </header>

      <div className="tl-kpis" id="tl-kpis"></div>

      <div className="tl-scroll" id="tl-scroll">
        {/* Heatmap Card */}
        <div className="tl-card tl-heatmap-card">
          <div className="tl-card-head">
            <div className="tl-card-title">
              <span className="tl-card-icon">📅</span>
              <b>Ma Trận Học Tập 12 Tháng</b>
              <span className="tl-card-tag">Múi giờ Asia/Bangkok (UTC+7)</span>
            </div>
            <div className="tl-legend" id="tl-legend">
              <span>Ít</span>
              <span className="tl-cell-dot lvl-0"></span>
              <span className="tl-cell-dot lvl-1"></span>
              <span className="tl-cell-dot lvl-2"></span>
              <span className="tl-cell-dot lvl-3"></span>
              <span className="tl-cell-dot lvl-4"></span>
              <span>Nhiều</span>
            </div>
          </div>

          <div className="tl-heatmap-wrap">
            <div className="tl-month-labels" id="tl-month-labels"></div>
            <div className="tl-heatmap-inner">
              <div className="tl-day-labels">
                <span>T2</span>
                <span>T4</span>
                <span>T6</span>
                <span>CN</span>
              </div>
              <div className="tl-heatmap-grid" id="tl-heatmap-grid"></div>
            </div>
          </div>

          <div className="tl-heatmap-info" id="tl-heatmap-info">
            <span className="tl-info-date">Rê chuột vào một ô vuông để xem chi tiết ngày học</span>
          </div>
        </div>

        {/* Bottom Split: Day Logs & Today's Plan */}
        <div className="tl-split">
          {/* Left: Day Details */}
          <div className="tl-card tl-pane-day">
            <div className="tl-card-head">
              <div className="tl-card-title">
                <span className="tl-card-icon">📖</span>
                <b>Nhật Ký Học Tập: <span id="tl-selected-date-text">Hôm nay</span></b>
              </div>
              <button type="button" className="btn btn--xs" id="tl-day-add-btn">+ Ghi thêm</button>
            </div>
            <div className="tl-pane-list" id="tl-day-logs-list">
              <p className="tl-empty">Đang tải nhật ký…</p>
            </div>
          </div>

          {/* Right: Today's Plan */}
          <div className="tl-card tl-pane-plan">
            <div className="tl-card-head">
              <div className="tl-card-title">
                <span className="tl-card-icon">🎯</span>
                <b>Kế Hoạch Hôm Nay</b>
                <span className="tl-card-counter" id="tl-plan-counter">0/0</span>
              </div>
              <button type="button" className="btn btn--xs" id="tl-plan-add-btn">+ Thêm việc</button>
            </div>
            <div className="tl-pane-list" id="tl-today-tasks-list">
              <p className="tl-empty">Đang tải kế hoạch…</p>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Prompt / Modal for logging minutes */}
      <div className="tl-modal-layer" id="tl-modal" hidden>
        <div className="tl-modal-box">
          <div className="tl-modal-head">
            <h3 id="tl-modal-title">Ghi nhật ký học tập</h3>
            <button type="button" className="icon-btn" id="tl-modal-close"><span data-icon="x"></span></button>
          </div>
          <form id="tl-modal-form" className="tl-modal-body">
            <div className="tl-form-group">
              <label htmlFor="tl-form-course">Môn học</label>
              <select id="tl-form-course" className="tl-input"></select>
            </div>
            <div className="tl-form-group">
              <label htmlFor="tl-form-title">Nội dung / Tiêu đề bài học</label>
              <input type="text" id="tl-form-title" className="tl-input" placeholder="Ví dụ: Ôn tập Tính Đóng Gói (OOP)..." required />
            </div>
            <div className="tl-form-group">
              <label htmlFor="tl-form-minutes">Thời gian học thực tế (phút)</label>
              <div className="tl-quick-minutes">
                <button type="button" data-m="30">30p</button>
                <button type="button" data-m="45">45p</button>
                <button type="button" data-m="60">60p</button>
                <button type="button" data-m="90">90p</button>
              </div>
              <input type="number" id="tl-form-minutes" className="tl-input" min="1" max="1440" defaultValue="45" required />
            </div>
            <div className="tl-form-group">
              <label htmlFor="tl-form-notes">Ghi chú đã học được gì (tuỳ chọn)</label>
              <textarea id="tl-form-notes" className="tl-input tl-textarea" rows={3} placeholder="Kiến thức đã nắm vững, điểm cần lưu ý..."></textarea>
            </div>
            <div className="tl-modal-actions">
              <button type="button" className="btn btn--sm" id="tl-modal-cancel">Hủy</button>
              <button type="submit" className="btn btn--sm btn--primary">Lưu nhật ký</button>
            </div>
          </form>
        </div>
      </div>

      <div className="tl-tip" id="tl-tip" hidden></div>
    </section>
  );
}

