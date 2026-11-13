'use client';

import { useMemo, useState } from 'react';
import type { StudyHeatmapDay, StudySummary } from './types';

interface StudyHeatmapProps {
  summary: StudySummary | null;
  selectedDate?: string | null;
  onSelectDate?: (date: string | null) => void;
  lang?: string;
}

const LEVEL_COLORS_LIGHT = [
  '#ebedf0', // 0
  '#9be9a8', // 1
  '#40c463', // 2
  '#30a14e', // 3
  '#216e39', // 4
];

const LEVEL_LABELS = {
  vi: ['0 bản ghi', '1 bản ghi', '2–3 bản ghi', '4–5 bản ghi', '≥6 bản ghi'],
  en: ['0 records', '1 record', '2–3 records', '4–5 records', '≥6 records'],
};

const DAY_NAMES = {
  vi: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

const MONTH_NAMES = {
  vi: ['Thg 1', 'Thg 2', 'Thg 3', 'Thg 4', 'Thg 5', 'Thg 6', 'Thg 7', 'Thg 8', 'Thg 9', 'Thg 10', 'Thg 11', 'Thg 12'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

export default function StudyHeatmap({ summary, selectedDate, onSelectDate, lang = 'vi' }: StudyHeatmapProps) {
  const [hoveredDay, setHoveredDay] = useState<{ day: StudyHeatmapDay; x: number; y: number } | null>(null);

  const isVi = lang === 'vi';
  const dayLabels = isVi ? DAY_NAMES.vi : DAY_NAMES.en;
  const monthLabels = isVi ? MONTH_NAMES.vi : MONTH_NAMES.en;

  // Organize days into 7 rows (by day of week: Sunday = 0 ... Saturday = 6)
  // across columns (weeks).
  const { weeks, monthHeaders } = useMemo(() => {
    if (!summary || !summary.days.length) return { weeks: [], monthHeaders: [] };

    const days = summary.days;
    const firstDate = new Date(days[0].date + 'T00:00:00Z');
    const firstDayOfWeek = firstDate.getUTCDay();

    // Pad beginning of first week if needed
    const paddedDays: (StudyHeatmapDay | null)[] = Array(firstDayOfWeek).fill(null);
    for (const d of days) paddedDays.push(d);

    const weeksList: (StudyHeatmapDay | null)[][] = [];
    for (let i = 0; i < paddedDays.length; i += 7) {
      weeksList.push(paddedDays.slice(i, i + 7));
    }

    // Determine month labels header positions
    const headers: { month: string; colIndex: number }[] = [];
    let lastMonth = -1;

    weeksList.forEach((week, colIdx) => {
      const validDay = week.find((d) => d !== null);
      if (validDay) {
        const m = new Date(validDay.date + 'T00:00:00Z').getUTCMonth();
        if (m !== lastMonth) {
          headers.push({ month: monthLabels[m], colIndex: colIdx });
          lastMonth = m;
        }
      }
    });

    return { weeks: weeksList, monthHeaders: headers };
  }, [summary, monthLabels]);

  if (!summary || !summary.days.length) {
    return <div className="student-heatmap-empty">{isVi ? 'Đang tải biểu đồ học tập...' : 'Loading study heatmap...'}</div>;
  }

  return (
    <div className="student-heatmap-card">
      <div className="student-heatmap-header">
        <div className="student-heatmap-stats">
          <div className="student-stat-item">
            <span className="student-stat-val">{summary.stats?.totalLogs ?? summary.totalLogs}</span>
            <span className="student-stat-lbl">{isVi ? 'Bản ghi' : 'Logs'}</span>
          </div>
          <div className="student-stat-item">
            <span className="student-stat-val">
              {Math.floor((summary.stats?.totalMinutes ?? summary.totalMinutes) / 60)}h{' '}
              {(summary.stats?.totalMinutes ?? summary.totalMinutes) % 60}m
            </span>
            <span className="student-stat-lbl">{isVi ? 'Thời gian học' : 'Study time'}</span>
          </div>
          <div className="student-stat-item">
            <span className="student-stat-val">{summary.stats?.activeDays ?? 0}</span>
            <span className="student-stat-lbl">{isVi ? 'Ngày có học' : 'Active days'}</span>
          </div>
        </div>

        {selectedDate && (
          <div className="student-heatmap-filter-pill">
            <span>{isVi ? `Đang lọc: ${selectedDate}` : `Filtered: ${selectedDate}`}</span>
            <button
              type="button"
              className="student-filter-clear"
              onClick={() => onSelectDate?.(null)}
              aria-label={isVi ? 'Xóa lọc ngày' : 'Clear date filter'}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="student-heatmap-wrapper" tabIndex={0} aria-label={isVi ? 'Biểu đồ quá trình học 12 tháng' : '12-Month Study Heatmap'}>
        <div className="student-heatmap-grid-container">
          {/* Month labels along top */}
          <div className="student-heatmap-months">
            <div style={{ width: 28, flexShrink: 0 }} />
            <div className="student-heatmap-months-track">
              {monthHeaders.map((hdr, i) => (
                <span
                  key={i}
                  className="student-heatmap-month-label"
                  style={{ left: `${hdr.colIndex * 14}px` }}
                >
                  {hdr.month}
                </span>
              ))}
            </div>
          </div>

          <div className="student-heatmap-body">
            {/* Day of week labels along left */}
            <div className="student-heatmap-days-col">
              <span className="student-day-label">{dayLabels[1]}</span>
              <span className="student-day-label" style={{ marginTop: 12 }}>{dayLabels[3]}</span>
              <span className="student-day-label" style={{ marginTop: 12 }}>{dayLabels[5]}</span>
            </div>

            {/* Weeks columns */}
            <div className="student-heatmap-weeks">
              {weeks.map((week, wIdx) => (
                <div key={wIdx} className="student-heatmap-col">
                  {week.map((day, dIdx) => {
                    if (!day) {
                      return <div key={dIdx} className="student-heat-cell student-heat-empty" />;
                    }

                    const isSelected = selectedDate === day.date;
                    const color = LEVEL_COLORS_LIGHT[day.level];

                    return (
                      <button
                        key={day.date}
                        type="button"
                        className={`student-heat-cell student-heat-level-${day.level} ${isSelected ? 'student-heat-selected' : ''}`}
                        style={{ backgroundColor: color }}
                        aria-label={`${day.date}: ${day.count} ${isVi ? 'bản ghi' : 'records'}, ${day.totalMinutes} ${isVi ? 'phút' : 'minutes'}`}
                        onClick={() => {
                          if (isSelected) onSelectDate?.(null);
                          else onSelectDate?.(day.date);
                        }}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredDay({
                            day,
                            x: rect.left + rect.width / 2,
                            y: rect.top - 8,
                          });
                        }}
                        onMouseLeave={() => setHoveredDay(null)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating tooltip */}
      {hoveredDay && (
        <div
          className="student-heatmap-tooltip"
          style={{
            position: 'fixed',
            left: hoveredDay.x,
            top: hoveredDay.y,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          <strong>{hoveredDay.day.date}</strong>
          <div>
            {hoveredDay.day.count} {isVi ? 'bản ghi' : 'records'}
            {hoveredDay.day.totalMinutes > 0 && ` · ${hoveredDay.day.totalMinutes} ${isVi ? 'phút' : 'min'}`}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="student-heatmap-legend">
        <span className="student-legend-text">{isVi ? 'Ít hơn' : 'Less'}</span>
        {LEVEL_COLORS_LIGHT.map((c, i) => (
          <span
            key={i}
            className="student-heat-cell student-legend-cell"
            style={{ backgroundColor: c }}
            title={LEVEL_LABELS[isVi ? 'vi' : 'en'][i]}
          />
        ))}
        <span className="student-legend-text">{isVi ? 'Nhiều hơn' : 'More'}</span>
      </div>
    </div>
  );
}

