/**
 * 도식화 엔진 — renderChart(spec): string / renderAll(charts): RenderedChart[]
 * ChartSpec 유니온 9종을 결정적 SVG 문자열로 렌더한다.
 *
 * 강의 §9/§18 도식 커버:
 *   bar/line: 시장규모·추세 막대/선
 *   funnel  : TAM·SAM·SOM·LAM 깔때기
 *   radar   : 경쟁사 레이더(자사 highlight)
 *   positioning: 2축 포지셔닝맵 + 이동 화살표
 *   gantt   : 월별 개발 일정 막대 + done 음영
 *   roadmap : Phase 띠 + 매출 곡선 + 이벤트 마커
 *   flow    : 비즈니스 모델 흐름도(노드 + 가치/돈 화살표)
 *   table   : 수치 비교표(HTML 문자열)
 *
 * 보안: 모든 사용자 제공 텍스트는 escapeXml()로 처리 후 SVG에 삽입.
 * 결정성: Math.random 없음. 같은 입력 → 항상 같은 출력.
 * 견고성: 빈 배열·단일 점·음수도 크래시 없이 처리.
 */
import type {
  BarLineSpec,
  ChartSpec,
  FlowSpec,
  FunnelSpec,
  GanttSpec,
  PositioningSpec,
  RadarSpec,
  RenderedChart,
  RoadmapSpec,
  TableSpec,
} from "../domain/bizplan/types.js";

// ── 공통 상수 ──────────────────────────────────────────────────────────────
const W = 680;           // 전체 폭(viewBox 기준)
const FONT = "font-family=\"'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif\"";

// 색상(다크모드 무관, 명시 색상)
const C = {
  self: "#2563EB",      // 자사(파란색)
  comp: "#64748B",      // 경쟁사(슬레이트)
  done: "#C7D2FE",      // 완료 음영(연보라)
  active: "#3B82F6",    // 활성/진행
  accent: "#EF4444",    // 강조/화살표
  positive: "#10B981",  // 긍정/매출
  phase: [              // Phase 띠 색상 순환(4개)
    "#BFDBFE", "#BBF7D0", "#FDE68A", "#F5D0FE",
  ],
  grid: "#E2E8F0",      // 격자선
  text: "#1E293B",      // 본문 텍스트
  sub: "#64748B",       // 보조 텍스트
  bg: "#F8FAFC",        // 배경
  white: "#FFFFFF",
  border: "#CBD5E1",
} as const;

// ── XSS 방어 ───────────────────────────────────────────────────────────────
/** SVG/HTML 텍스트에 삽입 전 이스케이프. <, >, &, ", ' 모두 처리. */
function escapeXml(raw: unknown): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── 수치 유틸 ──────────────────────────────────────────────────────────────
/** 가드: 배열이 비어 있으면 대체값으로 채운다 */
function nonEmpty<T>(arr: T[], fallback: T[]): T[] {
  return arr && arr.length > 0 ? arr : fallback;
}

/** 안전 최대값(0 분모 방지) */
function safeMax(...vals: number[]): number {
  const m = Math.max(...vals.filter(isFinite));
  return m > 0 ? m : 1;
}

/** 반올림 표시(정수) */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

// ── SVG 래퍼 ───────────────────────────────────────────────────────────────
function svgWrap(height: number, content: string, title?: string): string {
  const titleTag = title ? `<title>${escapeXml(title)}</title>` : "";
  return (
    `<svg viewBox="0 0 ${W} ${height}" xmlns="http://www.w3.org/2000/svg" ` +
    `${FONT} style="background:${C.white};border-radius:8px;border:1px solid ${C.border}">` +
    titleTag +
    content +
    `</svg>`
  );
}

/** 제목 텍스트(상단 16px 볼드) */
function titleText(text: string, y = 24): string {
  return `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="14" font-weight="bold" fill="${C.text}">${escapeXml(text)}</text>`;
}

/** 마커 정의(arrowhead) */
const DEFS_ARROW = `
<defs>
  <marker id="arrowBlue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L0,6 L8,3 z" fill="${C.self}"/>
  </marker>
  <marker id="arrowRed" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L0,6 L8,3 z" fill="${C.accent}"/>
  </marker>
  <marker id="arrowGray" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L0,6 L8,3 z" fill="${C.comp}"/>
  </marker>
</defs>`;

// ══════════════════════════════════════════════════════════════════════════
// 1. BAR / LINE
// ══════════════════════════════════════════════════════════════════════════
function renderBarLine(spec: BarLineSpec): string {
  const pad = { top: 50, right: 40, bottom: 60, left: 70 };
  const H = 300;
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  const points = nonEmpty(spec.points, [{ label: "데이터 없음", value: 0 }]);
  const maxVal = safeMax(...points.map((p) => p.value));
  const unit = escapeXml(spec.unit ?? "");
  const source = spec.source ? `출처: ${escapeXml(spec.source)}` : "[출처 입력 필요]";

  const n = points.length;
  const slotW = cW / n;
  const barW = Math.max(slotW * 0.5, 4);

  // 격자선 5개
  const gridLines = [0, 1, 2, 3, 4]
    .map((i) => {
      const val = (maxVal * i) / 4;
      const y = pad.top + cH - (val / maxVal) * cH;
      return (
        `<line x1="${pad.left}" y1="${y}" x2="${pad.left + cW}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>` +
        `<text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.sub}">${fmt(val)}</text>`
      );
    })
    .join("");

  // X축 라벨
  const xLabels = points
    .map((p, i) => {
      const cx = pad.left + slotW * i + slotW / 2;
      return `<text x="${cx}" y="${pad.top + cH + 18}" text-anchor="middle" font-size="11" fill="${C.sub}">${escapeXml(p.label)}</text>`;
    })
    .join("");

  let seriesContent: string;

  if (spec.kind === "bar") {
    seriesContent = points
      .map((p, i) => {
        const cx = pad.left + slotW * i + slotW / 2;
        const bH = Math.max((p.value / maxVal) * cH, 0);
        const bY = pad.top + cH - bH;
        return (
          `<rect x="${cx - barW / 2}" y="${bY}" width="${barW}" height="${bH}" fill="${C.active}" rx="2"/>` +
          `<text x="${cx}" y="${bY - 4}" text-anchor="middle" font-size="11" fill="${C.text}">${fmt(p.value)}</text>`
        );
      })
      .join("");
  } else {
    // line
    const pathPts = points.map((p, i) => {
      const cx = pad.left + slotW * i + slotW / 2;
      const cy = pad.top + cH - Math.max((p.value / maxVal) * cH, 0);
      return `${i === 0 ? "M" : "L"}${cx},${cy}`;
    });
    const circles = points
      .map((p, i) => {
        const cx = pad.left + slotW * i + slotW / 2;
        const cy = pad.top + cH - Math.max((p.value / maxVal) * cH, 0);
        return (
          `<circle cx="${cx}" cy="${cy}" r="4" fill="${C.self}"/>` +
          `<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="11" fill="${C.text}">${fmt(p.value)}</text>`
        );
      })
      .join("");
    seriesContent =
      `<polyline points="" d="" fill="none"/>` + // 더미(삭제방지)
      `<path d="${pathPts.join(" ")}" fill="none" stroke="${C.self}" stroke-width="2.5" stroke-linejoin="round"/>` +
      circles;
  }

  const content =
    titleText(spec.title) +
    `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + cH}" stroke="${C.text}" stroke-width="1.5"/>` +
    `<line x1="${pad.left}" y1="${pad.top + cH}" x2="${pad.left + cW}" y2="${pad.top + cH}" stroke="${C.text}" stroke-width="1.5"/>` +
    gridLines +
    seriesContent +
    xLabels +
    `<text x="${pad.left + cW / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${C.sub}">${escapeXml(source)}</text>` +
    (unit ? `<text x="${pad.left - 4}" y="${pad.top - 8}" text-anchor="end" font-size="10" fill="${C.sub}">(${unit})</text>` : "");

  return svgWrap(H, content, spec.title);
}

// ══════════════════════════════════════════════════════════════════════════
// 2. FUNNEL — TAM·SAM·SOM·LAM 깔때기
// ══════════════════════════════════════════════════════════════════════════
function renderFunnel(spec: FunnelSpec): string {
  const levels = nonEmpty(spec.levels, [
    { label: "TAM", value: 0 },
    { label: "SAM", value: 0 },
    { label: "SOM", value: 0 },
    { label: "LAM", value: 0 },
  ]);
  const n = levels.length;
  const rowH = 64;
  const H = 60 + n * rowH + 40;
  const maxW = W - 120; // 최대 트라페조이드 폭
  const cx = W / 2;
  const source = spec.source ? `출처: ${escapeXml(spec.source)}` : "[출처 입력 필요]";

  const colors = ["#BFDBFE", "#93C5FD", "#60A5FA", "#3B82F6", "#1D4ED8"];

  const rows = levels
    .map((lv, i) => {
      const frac = n > 1 ? 1 - (i / (n - 1)) * 0.65 : 1;
      const hw = (maxW * frac) / 2;
      const hwNext = (maxW * (n > 1 ? 1 - ((i + 1) / (n - 1)) * 0.65 : 0.35)) / 2;
      const y0 = 50 + i * rowH;
      const y1 = y0 + rowH;
      const fill = colors[Math.min(i, colors.length - 1)];
      const val = lv.value > 0 ? `${fmt(lv.value)}${lv.unit ? " " + escapeXml(lv.unit) : ""}` : "─";
      const note = lv.note ? `  (${escapeXml(lv.note)})` : "";
      return (
        `<polygon points="${cx - hw},${y0} ${cx + hw},${y0} ${cx + Math.min(hwNext, hw)},${y1} ${cx - Math.min(hwNext, hw)},${y1}" fill="${fill}" stroke="${C.border}" stroke-width="1"/>` +
        `<text x="${cx}" y="${y0 + rowH / 2 - 6}" text-anchor="middle" font-size="13" font-weight="bold" fill="${C.text}">${escapeXml(lv.label)}</text>` +
        `<text x="${cx}" y="${y0 + rowH / 2 + 12}" text-anchor="middle" font-size="11" fill="${C.text}">${val}${note}</text>`
      );
    })
    .join("");

  const content =
    titleText(spec.title) +
    rows +
    `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="10" fill="${C.sub}">${escapeXml(source)}</text>`;

  return svgWrap(H, content, spec.title);
}

// ══════════════════════════════════════════════════════════════════════════
// 3. RADAR — 경쟁사 비교 레이더(자사 highlight)
// ══════════════════════════════════════════════════════════════════════════
function polarToCart(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle - Math.PI / 2), cy + r * Math.sin(angle - Math.PI / 2)];
}

function renderRadar(spec: RadarSpec): string {
  const axes = nonEmpty(spec.axes, ["항목1", "항목2", "항목3"]);
  const series = nonEmpty(spec.series, [{ name: "자사", values: axes.map(() => 0) }]);
  const maxVal = spec.max ?? 10;
  const n = axes.length;
  const H = 380;
  const cx = W / 2;
  const cy = 190;
  const R = 120; // 최대 반경
  const levels = 4;

  // 격자(레벨별 다각형)
  const gridPolys = Array.from({ length: levels }, (_, li) => {
    const r = (R * (li + 1)) / levels;
    const pts = Array.from({ length: n }, (__, i) => {
      const angle = (2 * Math.PI * i) / n;
      const [x, y] = polarToCart(cx, cy, r, angle);
      return `${x},${y}`;
    }).join(" ");
    return `<polygon points="${pts}" fill="none" stroke="${C.grid}" stroke-width="1"/>`;
  }).join("");

  // 축선 + 라벨
  const axisLines = axes
    .map((ax, i) => {
      const angle = (2 * Math.PI * i) / n;
      const [x, y] = polarToCart(cx, cy, R, angle);
      // 라벨 위치를 축 끝 조금 밖으로
      const [lx, ly] = polarToCart(cx, cy, R + 22, angle);
      const anchor = lx < cx - 10 ? "end" : lx > cx + 10 ? "start" : "middle";
      return (
        `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${C.border}" stroke-width="1"/>` +
        `<text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" font-size="11" fill="${C.text}">${escapeXml(ax)}</text>`
      );
    })
    .join("");

  // 시리즈 폴리곤
  const seriesPolys = series
    .map((s) => {
      const vals = s.values.length >= n ? s.values : [...s.values, ...Array(n - s.values.length).fill(0)];
      const pts = Array.from({ length: n }, (_, i) => {
        const angle = (2 * Math.PI * i) / n;
        const v = Math.max(0, Math.min(vals[i] ?? 0, maxVal));
        const r = (v / maxVal) * R;
        const [x, y] = polarToCart(cx, cy, r, angle);
        return `${x},${y}`;
      }).join(" ");
      const color = s.highlight ? C.self : C.comp;
      const opacity = s.highlight ? 0.25 : 0.1;
      return (
        `<polygon points="${pts}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="${s.highlight ? 2.5 : 1.5}"/>` +
        // 자사는 꼭짓점 원 표시
        (s.highlight
          ? Array.from({ length: n }, (__, i) => {
              const angle = (2 * Math.PI * i) / n;
              const v = Math.max(0, Math.min((s.values[i] ?? 0), maxVal));
              const r = (v / maxVal) * R;
              const [x, y] = polarToCart(cx, cy, r, angle);
              return `<circle cx="${x}" cy="${y}" r="4" fill="${C.self}"/>`;
            }).join("")
          : "")
      );
    })
    .join("");

  // 범례
  const legend = series
    .map((s, i) => {
      const color = s.highlight ? C.self : C.comp;
      const lx = 30;
      const ly = 50 + i * 22;
      return (
        `<rect x="${lx}" y="${ly - 10}" width="14" height="14" rx="2" fill="${color}" fill-opacity="${s.highlight ? 0.7 : 0.4}" stroke="${color}"/>` +
        `<text x="${lx + 20}" y="${ly}" font-size="11" fill="${C.text}">${escapeXml(s.name)}</text>`
      );
    })
    .join("");

  const content =
    DEFS_ARROW +
    titleText(spec.title) +
    gridPolys +
    axisLines +
    seriesPolys +
    legend;

  return svgWrap(H, content, spec.title);
}

// ══════════════════════════════════════════════════════════════════════════
// 4. POSITIONING — 포지셔닝 맵(2축 + 점 + 이동 화살표)
// ══════════════════════════════════════════════════════════════════════════
function renderPositioning(spec: PositioningSpec): string {
  const H = 400;
  const pad = 80;
  const plotW = W - pad * 2;
  const plotH = H - 120;
  const cx = pad + plotW / 2;
  const cy = 60 + plotH / 2;

  // 좌표 변환: -1..1 → SVG
  const tx = (v: number) => cx + (v * plotW) / 2;
  const ty = (v: number) => cy - (v * plotH) / 2;

  const points = nonEmpty(spec.points, []);

  // 십자 축
  const axes =
    `<line x1="${pad}" y1="${cy}" x2="${pad + plotW}" y2="${cy}" stroke="${C.border}" stroke-width="1.5" stroke-dasharray="4,3"/>` +
    `<line x1="${cx}" y1="60" x2="${cx}" y2="${60 + plotH}" stroke="${C.border}" stroke-width="1.5" stroke-dasharray="4,3"/>`;

  // 축 라벨
  const axisLabels =
    `<text x="${pad}" y="${cy + 18}" font-size="11" fill="${C.sub}" text-anchor="start">${escapeXml(spec.xAxis[0])}</text>` +
    `<text x="${pad + plotW}" y="${cy + 18}" font-size="11" fill="${C.sub}" text-anchor="end">${escapeXml(spec.xAxis[1])}</text>` +
    `<text x="${cx}" y="55" font-size="11" fill="${C.sub}" text-anchor="middle">${escapeXml(spec.yAxis[1])}</text>` +
    `<text x="${cx}" y="${60 + plotH + 20}" font-size="11" fill="${C.sub}" text-anchor="middle">${escapeXml(spec.yAxis[0])}</text>`;

  // 이동 화살표(현재→목표)
  const moveArrow = spec.move
    ? `<line x1="${tx(spec.move.from[0])}" y1="${ty(spec.move.from[1])}" ` +
      `x2="${tx(spec.move.to[0])}" y2="${ty(spec.move.to[1])}" ` +
      `stroke="${C.accent}" stroke-width="2.5" stroke-dasharray="6,3" marker-end="url(#arrowRed)"/>`
    : "";

  // 경쟁사/자사 점
  const dots = points
    .map((p) => {
      const px = tx(Math.max(-1, Math.min(1, p.x)));
      const py = ty(Math.max(-1, Math.min(1, p.y)));
      const fill = p.self ? C.self : C.comp;
      const r = p.self ? 8 : 6;
      return (
        `<circle cx="${px}" cy="${py}" r="${r}" fill="${fill}"/>` +
        `<text x="${px}" y="${py - r - 4}" text-anchor="middle" font-size="11" font-weight="${p.self ? "bold" : "normal"}" fill="${fill}">${escapeXml(p.label)}</text>`
      );
    })
    .join("");

  const content =
    DEFS_ARROW +
    titleText(spec.title) +
    axes +
    axisLabels +
    moveArrow +
    dots;

  return svgWrap(H, content, spec.title);
}

// ══════════════════════════════════════════════════════════════════════════
// 5. GANTT — 월별 개발 일정 막대 + done 음영
// ══════════════════════════════════════════════════════════════════════════
function renderGantt(spec: GanttSpec): string {
  const periods = nonEmpty(spec.periods, ["1구간"]);
  const rows = nonEmpty(spec.rows, [{ label: "항목", start: 0, end: 0 }]);
  const nP = periods.length;
  const nR = rows.length;

  const labelW = 130;
  const pad = { top: 55, right: 20, bottom: 25 };
  const rowH = 32;
  const H = pad.top + nR * rowH + pad.bottom + 10;
  const gridW = W - labelW - pad.right - 20;
  const cellW = gridW / nP;

  // 열 헤더(기간)
  const headers = periods
    .map((p, i) => {
      const x = 20 + labelW + i * cellW;
      return `<text x="${x + cellW / 2}" y="42" text-anchor="middle" font-size="11" fill="${C.sub}">${escapeXml(p)}</text>`;
    })
    .join("");

  // 격자선(열)
  const gridLines = Array.from({ length: nP + 1 }, (_, i) => {
    const x = 20 + labelW + i * cellW;
    return `<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + nR * rowH}" stroke="${C.grid}" stroke-width="1"/>`;
  }).join("");

  // 행 라벨 + 막대
  const rowItems = rows
    .map((row, ri) => {
      const y = pad.top + ri * rowH;
      const xStart = 20 + labelW + row.start * cellW;
      const barW = Math.max((row.end - row.start) * cellW, cellW * 0.1);
      const doneW = row.done !== undefined ? Math.max((row.done - row.start) * cellW, 0) : 0;
      return (
        // 배경행(짝수 음영)
        (ri % 2 === 0 ? `<rect x="20" y="${y}" width="${W - 40}" height="${rowH}" fill="${C.bg}"/>` : "") +
        // 행 라벨
        `<text x="25" y="${y + rowH / 2 + 4}" font-size="12" fill="${C.text}">${escapeXml(row.label)}</text>` +
        // 전체 bar(회색)
        `<rect x="${xStart}" y="${y + 7}" width="${barW}" height="${rowH - 14}" rx="3" fill="${C.active}" fill-opacity="0.35"/>` +
        // done 음영(진보라)
        (doneW > 0
          ? `<rect x="${xStart}" y="${y + 7}" width="${doneW}" height="${rowH - 14}" rx="3" fill="${C.done}"/>`
          : "")
      );
    })
    .join("");

  // 행 구분선
  const rowLines = Array.from({ length: nR + 1 }, (_, i) => {
    const y = pad.top + i * rowH;
    return `<line x1="20" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>`;
  }).join("");

  const content =
    titleText(spec.title) +
    headers +
    `<rect x="20" y="${pad.top}" width="${W - 40}" height="${nR * rowH}" fill="${C.white}" stroke="${C.border}" stroke-width="1"/>` +
    gridLines +
    rowItems +
    rowLines;

  return svgWrap(H, content, spec.title);
}

// ══════════════════════════════════════════════════════════════════════════
// 6. ROADMAP — Phase 띠 + 매출 곡선 + 이벤트 마커
// ══════════════════════════════════════════════════════════════════════════
function renderRoadmap(spec: RoadmapSpec): string {
  const years = nonEmpty(spec.years, ["Y1", "Y2", "Y3"]);
  const phases = spec.phases ?? [];
  const revenue = spec.revenue ?? [];
  const events = spec.events ?? [];
  const nY = years.length;

  const H = 380;
  const pad = { top: 50, left: 50, right: 30, bottom: 50 };
  const areaW = W - pad.left - pad.right;
  const cellW = areaW / nY;

  // Phase 띠 높이
  const phaseH = 34;
  const phaseY = pad.top;

  // 연도 헤더
  const yearLabels = years
    .map((y, i) => {
      const x = pad.left + i * cellW + cellW / 2;
      return `<text x="${x}" y="${phaseY - 8}" text-anchor="middle" font-size="12" font-weight="bold" fill="${C.text}">${escapeXml(y)}</text>`;
    })
    .join("");

  // 연도 격자선
  const yearLines = Array.from({ length: nY + 1 }, (_, i) => {
    const x = pad.left + i * cellW;
    return `<line x1="${x}" y1="${phaseY}" x2="${x}" y2="${H - pad.bottom}" stroke="${C.grid}" stroke-width="1"/>`;
  }).join("");

  // Phase 띠
  const phaseBands = phases
    .map((ph, pi) => {
      const sy = ph.startYear;
      const ey = ph.endYear;
      if (sy >= nY || ey < 0) return "";
      const x1 = pad.left + Math.max(sy, 0) * cellW;
      const x2 = pad.left + Math.min(ey + 1, nY) * cellW;
      const color = C.phase[pi % C.phase.length];
      const progs = ph.programs?.map((p) => escapeXml(p)).join(" / ") ?? "";
      return (
        `<rect x="${x1}" y="${phaseY}" width="${x2 - x1}" height="${phaseH}" fill="${color}" stroke="${C.border}" stroke-width="1" rx="3"/>` +
        `<text x="${(x1 + x2) / 2}" y="${phaseY + 13}" text-anchor="middle" font-size="11" font-weight="bold" fill="${C.text}">${escapeXml(ph.label)}</text>` +
        (progs ? `<text x="${(x1 + x2) / 2}" y="${phaseY + 27}" text-anchor="middle" font-size="9" fill="${C.sub}">${progs}</text>` : "")
      );
    })
    .join("");

  // 매출 곡선 영역
  const revenueY = phaseY + phaseH + 20;
  const revenueH = H - pad.bottom - revenueY - 30;

  let revPath = "";
  let revCircles = "";
  if (revenue.length > 1) {
    const maxRev = safeMax(...revenue.map((r) => r.value));
    const pts = revenue.map((r, i) => {
      const xi = years.indexOf(r.label);
      const x = xi >= 0 ? pad.left + xi * cellW + cellW / 2 : pad.left + i * cellW + cellW / 2;
      const y = revenueY + revenueH - Math.max((r.value / maxRev) * revenueH, 0);
      return { x, y, r };
    });
    revPath =
      `<path d="M${pts.map((p) => `${p.x},${p.y}`).join(" L")}" fill="none" stroke="${C.positive}" stroke-width="2.5"/>`;
    revCircles = pts
      .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${C.positive}"/><text x="${p.x}" y="${p.y - 8}" text-anchor="middle" font-size="10" fill="${C.positive}">${fmt(p.r.value)}</text>`)
      .join("");
  }

  // 이벤트 마커(하단)
  const eventY = H - pad.bottom;
  const eventMarkers = events
    .map((ev) => {
      const xi = years.indexOf(String(ev.year));
      const x = xi >= 0 ? pad.left + xi * cellW + cellW / 2 : -999;
      if (x < 0) return "";
      return (
        `<line x1="${x}" y1="${eventY - 18}" x2="${x}" y2="${eventY - 5}" stroke="${C.accent}" stroke-width="1.5"/>` +
        `<text x="${x}" y="${eventY + 10}" text-anchor="middle" font-size="9" fill="${C.accent}">${escapeXml(ev.label)}</text>`
      );
    })
    .join("");

  const content =
    titleText(spec.title) +
    yearLabels +
    yearLines +
    phaseBands +
    // 매출축
    (revenue.length > 1
      ? `<text x="${pad.left - 5}" y="${revenueY - 4}" font-size="10" fill="${C.positive}" text-anchor="end">매출</text>` +
        `<line x1="${pad.left}" y1="${revenueY}" x2="${pad.left}" y2="${revenueY + revenueH}" stroke="${C.grid}" stroke-width="1"/>` +
        `<line x1="${pad.left}" y1="${revenueY + revenueH}" x2="${W - pad.right}" y2="${revenueY + revenueH}" stroke="${C.grid}" stroke-width="1"/>` +
        revPath +
        revCircles
      : "") +
    eventMarkers;

  return svgWrap(H, content, spec.title);
}

// ══════════════════════════════════════════════════════════════════════════
// 7. FLOW — 비즈니스 모델 흐름도(노드 박스 + 가치/돈 화살표)
// ══════════════════════════════════════════════════════════════════════════
function renderFlow(spec: FlowSpec): string {
  const nodes = nonEmpty(spec.nodes, [{ id: "A", label: "시작" }]);
  const edges = spec.edges ?? [];
  const n = nodes.length;

  // 노드를 한 행에 배치(최대 5개; 초과 시 2행)
  const cols = Math.min(n, 5);
  const rows = Math.ceil(n / cols);
  const H = 80 + rows * 110 + 40;

  const nodeW = 110;
  const nodeH = 44;
  const hGap = (W - 60 - cols * nodeW) / Math.max(cols - 1, 1);

  // 노드 위치 계산
  const nodePos: Record<string, { x: number; y: number }> = {};
  nodes.forEach((nd, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 30 + col * (nodeW + hGap) + nodeW / 2;
    const y = 60 + row * 110 + nodeH / 2;
    nodePos[nd.id] = { x, y };
  });

  // 노드 박스
  const nodeBoxes = nodes
    .map((nd) => {
      const { x, y } = nodePos[nd.id] ?? { x: 50, y: 60 };
      return (
        `<rect x="${x - nodeW / 2}" y="${y - nodeH / 2}" width="${nodeW}" height="${nodeH}" rx="6" fill="${C.bg}" stroke="${C.active}" stroke-width="1.5"/>` +
        `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="12" fill="${C.text}">${escapeXml(nd.label)}</text>`
      );
    })
    .join("");

  // 엣지(화살표)
  const edgePaths = edges
    .map((e) => {
      const from = nodePos[e.from];
      const to = nodePos[e.to];
      if (!from || !to) return "";
      const color = e.kind === "돈" ? C.accent : e.kind === "가치" ? C.self : C.comp;
      const markerId = e.kind === "돈" ? "arrowRed" : e.kind === "가치" ? "arrowBlue" : "arrowGray";
      // 직선(노드 중심→중심, 짧게 클리핑)
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ox = (dx / dist) * (nodeW / 2 + 4);
      const oy = (dy / dist) * (nodeH / 2 + 4);
      const x1 = from.x + ox;
      const y1 = from.y + oy;
      const x2 = to.x - ox;
      const y2 = to.y - oy;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2 - 12;
      return (
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.8" marker-end="url(#${markerId})"/>` +
        `<rect x="${mx - 28}" y="${my - 10}" width="56" height="14" rx="3" fill="${C.white}" fill-opacity="0.85"/>` +
        `<text x="${mx}" y="${my}" text-anchor="middle" font-size="10" fill="${color}">${escapeXml(e.label)}</text>`
      );
    })
    .join("");

  // 범례
  const legend =
    `<rect x="30" y="${H - 32}" width="10" height="10" fill="${C.self}" rx="2"/>` +
    `<text x="44" y="${H - 22}" font-size="10" fill="${C.text}">가치 흐름</text>` +
    `<rect x="120" y="${H - 32}" width="10" height="10" fill="${C.accent}" rx="2"/>` +
    `<text x="134" y="${H - 22}" font-size="10" fill="${C.text}">돈 흐름</text>`;

  const content =
    DEFS_ARROW +
    titleText(spec.title) +
    edgePaths +   // 엣지를 먼저(박스 아래)
    nodeBoxes +
    legend;

  return svgWrap(H, content, spec.title);
}

// ══════════════════════════════════════════════════════════════════════════
// 8. TABLE — 수치 비교 표(SVG)
// ══════════════════════════════════════════════════════════════════════════
function renderTable(spec: TableSpec): string {
  const headers = nonEmpty(spec.headers, ["항목"]);
  const rows = nonEmpty(spec.rows, [["데이터 없음"]]);
  const nC = headers.length;
  const nR = rows.length;

  const cellH = 30;
  const H = 50 + (nR + 1) * cellH + 20;
  const colW = (W - 40) / nC;

  // 헤더행
  const headerRow = headers
    .map((h, ci) => {
      const x = 20 + ci * colW;
      return (
        `<rect x="${x}" y="40" width="${colW}" height="${cellH}" fill="${C.active}" fill-opacity="0.2" stroke="${C.border}" stroke-width="1"/>` +
        `<text x="${x + colW / 2}" y="${40 + cellH / 2 + 5}" text-anchor="middle" font-size="12" font-weight="bold" fill="${C.text}">${escapeXml(h)}</text>`
      );
    })
    .join("");

  // 데이터 행
  const dataRows = rows
    .map((row, ri) => {
      const y = 40 + (ri + 1) * cellH;
      const isHighlight = spec.highlightRow === ri;
      return row
        .map((cell, ci) => {
          const x = 20 + ci * colW;
          const fill = isHighlight ? "#DBEAFE" : ri % 2 === 0 ? C.white : C.bg;
          const bold = isHighlight ? "bold" : "normal";
          return (
            `<rect x="${x}" y="${y}" width="${colW}" height="${cellH}" fill="${fill}" stroke="${C.border}" stroke-width="1"/>` +
            `<text x="${x + colW / 2}" y="${y + cellH / 2 + 5}" text-anchor="middle" font-size="11" font-weight="${bold}" fill="${C.text}">${escapeXml(cell)}</text>`
          );
        })
        .join("");
    })
    .join("");

  const content =
    titleText(spec.title) +
    headerRow +
    dataRows;

  return svgWrap(H, content, spec.title);
}

// ══════════════════════════════════════════════════════════════════════════
// 공개 API
// ══════════════════════════════════════════════════════════════════════════

/**
 * ChartSpec 하나를 결정적 SVG 문자열로 렌더.
 * 인식 불가한 kind가 오더라도 크래시 없이 빈 SVG 반환.
 */
export function renderChart(spec: ChartSpec): string {
  try {
    switch (spec.kind) {
      case "bar":
      case "line":
        return renderBarLine(spec);
      case "funnel":
        return renderFunnel(spec);
      case "radar":
        return renderRadar(spec);
      case "positioning":
        return renderPositioning(spec);
      case "gantt":
        return renderGantt(spec);
      case "roadmap":
        return renderRoadmap(spec);
      case "flow":
        return renderFlow(spec);
      case "table":
        return renderTable(spec);
    }
  } catch (err) {
    // 견고성: 렌더 중 예외 → 에러 메시지 SVG 반환, 크래시하지 않음
    const msg = escapeXml(String(err).slice(0, 120));
    return svgWrap(80, `<text x="${W / 2}" y="48" text-anchor="middle" font-size="12" fill="#EF4444">렌더 오류: ${msg}</text>`);
  }
}

/**
 * RenderedChart 배열에서 svg가 없는 항목을 렌더해 채운다.
 * 이미 svg가 있는 항목은 그대로 유지(멱등).
 */
export function renderAll(charts: RenderedChart[]): RenderedChart[] {
  return charts.map((c) => {
    if (c.svg) return c;
    return { ...c, svg: renderChart(c.spec) };
  });
}
