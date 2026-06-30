/**
 * 사업계획서 작성 지원 — 도메인 계약(타입).
 * 출처: 정부지원 창업 사업계획서 표준 방법론(검증된 공개 프레임워크)
 *   (PSST·PEST·TAM/SAM/SOM/LAM·해자·퍼널·로드맵 4축·자금조달·예창패 양식·HWP 실무)
 *
 * 사실 무결성 원칙(최우선):
 * - 이 엔진은 창업자의 "사실(수치·실적·기관명)"을 지어내지 않는다.
 * - 프레임워크 골격·필수 도식·체크리스트·루브릭 피드백을 제공하고,
 *   창업자가 넣은 입력을 PSST 구조로 다듬되, 빠진 사실은 "[입력 필요: ___]"로 표시한다.
 */

// ── PSST ──
export type PsstKey = "P" | "S1" | "S2" | "T"; // 문제인식 / 실현가능성 / 성장전략 / 팀구성

export interface PsstSectionSpec {
  key: PsstKey;
  한글명: string;
  핵심질문: string;
  /** 양식이 요구하는 구성요소(예창패 골격) */
  요구내용: string[];
  /** 이 섹션에 들어가야 하는 필수 도식 종류 */
  필수도식: ChartKind[];
  /** 작성 원칙(강의 규칙) */
  작성원칙: string[];
}

// ── 도식(도표/그래프) 스펙 — 도식화 엔진(viz)이 SVG로 렌더 ──
export type ChartKind =
  | "bar" // 시장규모 등 막대
  | "line" // 추세/매출 곡선
  | "funnel" // TAM·SAM·SOM·LAM 깔때기
  | "radar" // 경쟁사 비교 레이더
  | "positioning" // 포지셔닝 맵(2축 + 점 + 이동 화살표)
  | "gantt" // 간트형 일정표
  | "roadmap" // Phase 띠 + 매출 곡선 + 이벤트 마커
  | "flow" // 비즈니스 모델 흐름도
  | "table"; // 수치 비교 표(렌더는 텍스트/HTML 표로)

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface BarLineSpec {
  kind: "bar" | "line";
  title: string;
  unit?: string;
  points: SeriesPoint[];
  source?: string; // 데이터 출처(사실무결성). 없으면 "[출처 입력 필요]"
}

export interface FunnelSpec {
  kind: "funnel";
  title: string;
  /** 위(넓음)→아래(좁음): TAM,SAM,SOM,LAM 순 */
  levels: { label: string; value: number; unit?: string; note?: string }[];
  source?: string;
}

export interface RadarSpec {
  kind: "radar";
  title: string;
  axes: string[]; // 평가 축(예: 가격·정확도·DB수·신뢰)
  series: { name: string; values: number[]; highlight?: boolean }[]; // 자사 highlight
  max?: number;
}

export interface PositioningSpec {
  kind: "positioning";
  title: string;
  xAxis: [string, string]; // [좌, 우]
  yAxis: [string, string]; // [하, 상]
  points: { label: string; x: number; y: number; self?: boolean }[]; // -1..1
  /** 자사의 현재→목표 이동 경로 */
  move?: { from: [number, number]; to: [number, number] };
}

export interface GanttSpec {
  kind: "gantt";
  title: string;
  /** 가로 구간 라벨(월: 예 "6월".."1월") */
  periods: string[];
  rows: { label: string; start: number; end: number; done?: number }[]; // period index
}

export interface RoadmapSpec {
  kind: "roadmap";
  title: string;
  years: string[]; // 가로축 연도
  phases: { label: string; startYear: number; endYear: number; programs?: string[] }[];
  revenue?: SeriesPoint[]; // 연도별 매출 곡선
  events?: { year: number; label: string }[]; // 하단 마커(사업자등록·기보 등)
}

export interface FlowSpec {
  kind: "flow";
  title: string;
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label: string; kind?: "가치" | "돈" }[];
}

export interface TableSpec {
  kind: "table";
  title: string;
  headers: string[];
  rows: string[][];
  highlightRow?: number; // 자사 핵심 경쟁력 행
}

export type ChartSpec =
  | BarLineSpec
  | FunnelSpec
  | RadarSpec
  | PositioningSpec
  | GanttSpec
  | RoadmapSpec
  | FlowSpec
  | TableSpec;

/** 도식 + 렌더된 SVG(있으면) + 사실무결성 메모 */
export interface RenderedChart {
  spec: ChartSpec;
  svg?: string;
  입력필요?: string[];
}

// ── 시장조사 ──
export interface PestInput {
  정치?: string;
  경제?: string;
  사회?: string;
  기술?: string;
}
export interface MarketSizeInput {
  tam?: { value?: number; unit?: string; 근거?: string; 출처?: string };
  sam?: { value?: number; unit?: string; 근거?: string; 출처?: string };
  som?: { value?: number; unit?: string; 근거?: string; 출처?: string };
  lam?: { value?: number; unit?: string; 근거?: string; 출처?: string };
}
export interface CompetitorInput {
  name: string;
  /** 비교 지표 → 값(수치 권장; 정성적 표현은 경고) */
  metrics: Record<string, string | number>;
  self?: boolean;
}
export interface MarketResearchInput {
  업종?: string;
  지역?: string;
  pest?: PestInput;
  marketSize?: MarketSizeInput;
  competitors?: CompetitorInput[];
  /** 비교 축(레이더/표 공통) */
  비교축?: string[];
}
export interface MarketResearchResult {
  pest: { 항목: string; 내용: string; 시사점: string }[];
  시장규모: { 단계: string; 값: string; 근거: string; 출처: string }[];
  경쟁비교: { 표: TableSpec; 정성적경고: string[] };
  charts: RenderedChart[];
  입력필요: string[];
  평가포인트: string[];
  고지: string;
}

// ── 로드맵 ──
export type 축 = "아이템" | "자금" | "마케팅" | "운영";
export interface RoadmapMilestoneInput {
  시점: string; // "2026-Q3" 또는 "2026-09" 등
  축: 축;
  내용: string;
  상태?: "완료" | "진행중" | "예정";
  인과?: string; // "무엇이 되어야 가능한가"
}
export interface RoadmapInput {
  사업명?: string;
  거점?: string; // LAM
  과거준비?: { 시점?: string; 내용: string }[]; // 시장조사·강의수료·자격증·동종업계 재직 등
  미래계획?: RoadmapMilestoneInput[];
  /** 자금 징검다리 의향(예창패→초창패→TIPS 등) */
  자금계획?: string[];
}
export interface RoadmapResult {
  타임라인: { 시점: string; 축: 축; 내용: string; 상태: string; 인과: string }[];
  자금징검다리: { 시점: string; 프로그램: string; 종류: string; 비고: string }[];
  시장변화서술: string[]; // 1·3·5·7년
  chart: RenderedChart;
  입력필요: string[];
  평가포인트: string[];
  고지: string;
}

// ── 자금조달 지도 ──
export type 자금종류 = "출연(지원금)" | "금융(융자·보증)" | "투자금" | "자기자본";
export interface FundingProgram {
  이름: string;
  부처: string;
  종류: 자금종류;
  금액?: string;
  단계: ("예비" | "초기" | "도약" | "성장")[];
  조건?: string;
  비고?: string;
}

// ── PSST 골격(plan_outline) / 섹션 초안(draft_section) ──
export interface PlanOutlineResult {
  아이템명형식: string;
  섹션: {
    key: PsstKey;
    한글명: string;
    핵심질문: string;
    요구내용: string[];
    필수도식: ChartKind[];
    작성원칙: string[];
    이공고_유의: string[]; // 선택 공고/프로필 기반 맞춤 유의점
  }[];
  관통원칙: string[];
  체크리스트: string[];
  고지: string;
}

export interface DraftSectionInput {
  section: PsstKey;
  /** 창업자가 제공한 원재료(사실) */
  inputs: Record<string, string>;
}
export interface DraftSectionResult {
  section: PsstKey;
  한글명: string;
  요약: string[]; // 단락 상단 ■ 핵심요약 2~3줄
  본문: string; // 창업자 입력을 PSST 규칙으로 구조화(사실 미조작)
  입력필요: string[]; // 빠진 사실 → [입력 필요]
  경고: string[]; // 0점답변·정성적표현 등 감지
  추천도식: ChartKind[];
  고지: string;
}

// ── 체크리스트(plan_review) ──
export interface ChecklistItem {
  항목: string;
  통과: boolean | "확인필요";
  근거: string;
}
export interface ChecklistResult {
  점수: number; // 통과 항목 비율(참고)
  항목: ChecklistItem[];
  치명경고: string[]; // 0점답변 등
  고지: string;
}

// ── HWP 레이아웃 가이드 ──
export interface HwpLayoutInput {
  목표페이지?: number;
  현재글자수?: number;
  섹션별글자수?: Record<string, number>;
}
export interface HwpLayoutResult {
  진단: string;
  조정제안: { 문제: string; 조치: string; 단축키?: string }[];
  단축키표: { 기능: string; 단축키: string }[];
  가독성원칙: string[];
  페이지추정: string;
  고지: string;
}
