/**
 * 시장조사 엔진 — buildMarketResearch()
 * 강의(§2 PEST · §3 TAM/SAM/SOM/LAM · §9-3 경쟁비교)를 결정적 규칙으로 인코딩.
 *
 * 사실 무결성 원칙(최우선):
 * - 어떤 시장 수치도 임의 생성 금지. 입력값만 시각화한다.
 * - 빠진 PEST/시장규모/출처/경쟁 데이터는 모두 결과의 '입력필요'에 "[입력 필요: ___]"로 표시한다.
 * - 정성적 표현(매우 빠름/우수 등)은 isQualitative()로 잡아 "수치로 바꾸라"로 안내한다.
 * - 결정적: Math.random 없음. 같은 입력 → 같은 출력.
 * - viz를 import하지 않는다. ChartSpec만 RenderedChart.spec에 담고 svg는 비운다(렌더는 tool 계층).
 */
import type {
  FunnelSpec,
  MarketResearchInput,
  MarketResearchResult,
  RadarSpec,
  RenderedChart,
  TableSpec,
} from "./types.js";
import { isQualitative } from "./knowledge.js";
import { 시장고지 } from "../disclaimer.js";

// ── PEST 4항목 메타(강의 §2) ──
const PEST_항목: {
  키: keyof NonNullable<MarketResearchInput["pest"]>;
  표시: string;
  시사점가이드: string;
}[] = [
  { 키: "정치", 표시: "P 정치", 시사점가이드: "법·제도·정책·규제·예산이 '왜 지금'을 뒷받침하는지로 연결하세요." },
  { 키: "경제", 표시: "E 경제", 시사점가이드: "소득·지출 변화로 '닫힌 지갑에서도 사는 must-have'임을 보이세요." },
  { 키: "사회", 표시: "S 사회", 시사점가이드: "1인가구·반려·AI 등 사회 변화가 수요를 키우는 고리를 명시하세요." },
  { 키: "기술", 표시: "T 기술", 시사점가이드: "도입·준비 중인 기술이 우리 솔루션을 가능케 함을 연결하세요." },
];

// ── 시장규모 4단계 메타(강의 §3) ──
const 시장규모단계: {
  키: keyof NonNullable<MarketResearchInput["marketSize"]>;
  표시: string;
  설명: string;
}[] = [
  { 키: "tam", 표시: "TAM (전체시장)", 설명: "이론상 전체 시장" },
  { 키: "sam", 표시: "SAM (유효시장)", 설명: "비즈니스모델·기술·지역으로 도달 가능한 시장" },
  { 키: "som", 표시: "SOM (수익시장)", 설명: "초기 현실적 점유분 — 투자자가 가장 중시" },
  { 키: "lam", 표시: "LAM (거점시장)", 설명: "최초 거점 시장(예: 광주)" },
];

/** 숫자 값을 천단위 콤마로 표기(결정적). 음수/NaN은 그대로 문자열화. */
function 값표기(value: number, unit?: string): string {
  const n = Number.isFinite(value) ? value.toLocaleString("en-US") : String(value);
  return unit ? `${n} ${unit}` : n;
}

export function buildMarketResearch(
  input: MarketResearchInput
): MarketResearchResult {
  const 입력필요: string[] = [];
  const 평가포인트: string[] = [];
  const charts: RenderedChart[] = [];

  // ── 1. PEST (§2) ──
  const pestIn = input.pest ?? {};
  const pest = PEST_항목.map(({ 키, 표시, 시사점가이드 }) => {
    const 내용 = (pestIn[키] ?? "").trim();
    if (!내용) {
      입력필요.push(`[입력 필요: PEST ${표시}]`);
      return { 항목: 표시, 내용: "[입력 필요]", 시사점: 시사점가이드 };
    }
    return { 항목: 표시, 내용, 시사점: 시사점가이드 };
  });

  // ── 2. 시장규모 TAM→SAM→SOM→LAM (§3) ──
  const sizeIn = input.marketSize ?? {};
  const funnelLevels: FunnelSpec["levels"] = [];
  const 시장규모 = 시장규모단계.map(({ 키, 표시, 설명 }) => {
    const cell = sizeIn[키];
    const 값있음 = cell?.value !== undefined && cell.value !== null;
    const 값 = 값있음 ? 값표기(cell!.value as number, cell!.unit) : "[입력 필요: 값]";
    const 근거 = (cell?.근거 ?? "").trim() || "[입력 필요: 산정 근거]";
    const 출처 = (cell?.출처 ?? "").trim() || "[입력 필요: 출처]";

    if (!값있음) 입력필요.push(`[입력 필요: 시장규모 ${표시} 값]`);
    if (!(cell?.근거 ?? "").trim()) 입력필요.push(`[입력 필요: 시장규모 ${표시} 산정 근거]`);
    if (!(cell?.출처 ?? "").trim()) 입력필요.push(`[입력 필요: 시장규모 ${표시} 출처]`);

    // funnel은 수치가 있는 단계만 위→아래 순서로 쌓는다(임의 수치 생성 금지)
    if (값있음) {
      funnelLevels.push({
        label: 표시,
        value: cell!.value as number,
        unit: cell!.unit,
        note: 설명,
      });
    }
    return { 단계: `${표시} — ${설명}`, 값, 근거, 출처 };
  });

  // funnel ChartSpec (수치가 1개 이상일 때만 생성; spec만, svg 비움)
  if (funnelLevels.length > 0) {
    const funnelSpec: FunnelSpec = {
      kind: "funnel",
      title: "시장규모 추정 (TAM·SAM·SOM·LAM)",
      levels: funnelLevels,
    };
    charts.push({
      spec: funnelSpec,
      입력필요:
        funnelLevels.length < 4
          ? [`깔때기 4단계 중 ${funnelLevels.length}개만 입력됨 — 나머지 단계 값/출처를 채우세요.`]
          : undefined,
    });

    // 시장규모 막대(bar) — 단계별 규모 비교(같은 단위일 때 의미). spec만.
    charts.push({
      spec: {
        kind: "bar",
        title: "시장규모 단계별 비교",
        points: funnelLevels.map((l) => ({ label: l.label, value: l.value })),
        source: "입력값 기반 — 출처는 시장규모 표 참조",
      },
    });
  }

  // 시장규모 평가포인트(허풍형/구멍가게형 — §3)
  const hasTAM = sizeIn.tam?.value !== undefined && sizeIn.tam?.value !== null;
  const hasSOM = sizeIn.som?.value !== undefined && sizeIn.som?.value !== null;
  평가포인트.push(
    "시장규모는 위→아래(TAM→SAM→SOM→LAM)로 추정하되, 스토리는 아래→위(LAM→SOM→SAM→TAM)로 '작게 시작해 크게 큰다'를 말하세요."
  );
  if (hasTAM && !hasSOM) {
    평가포인트.push(
      "⚠️ 허풍형 위험: TAM은 있는데 SOM(초기 현실 점유분)이 없습니다. 투자자가 가장 중시하는 SOM을 반드시 산정하세요."
    );
  }
  if (!hasTAM && hasSOM) {
    평가포인트.push(
      "⚠️ 구멍가게형 위험: SOM만 있고 TAM(전체시장)이 없습니다. 시장의 성장 천장(상방)을 보여주세요."
    );
  }
  if (!hasTAM && !hasSOM) {
    평가포인트.push(
      "시장규모(TAM·SOM 등)가 비어 있습니다. 최소한 TAM과 SOM은 출처와 함께 채워야 평가 가능합니다."
    );
  }
  // must-have / 컨택포인트(§2, §4)
  평가포인트.push(
    "닫힌 지갑 시장: 'nice to have'는 감점입니다. '없으면 안 되는 must-have'임을 PEST E(경제)에서 증명하세요."
  );
  평가포인트.push(
    "컨택포인트(이미 가진, 복제 불가한 통로·관계)를 시장 진입 근거로 드러내면 SOM의 현실성이 올라갑니다."
  );

  // ── 3. 경쟁비교 (§9-3) ──
  const { 표, 정성적경고, radar } = buildCompetition(input, 입력필요, 평가포인트);
  if (radar) charts.push({ spec: radar });

  return {
    pest,
    시장규모,
    경쟁비교: { 표, 정성적경고 },
    charts,
    입력필요,
    평가포인트,
    고지: 시장고지,
  };
}

/**
 * 경쟁비교표(TableSpec) + 정성적 경고 + (축이 충분하면) radar.
 * - 비교축(공통)을 헤더로, competitors를 행으로.
 * - self=true 행을 highlightRow로.
 * - 셀이 isQualitative()면 정성적경고에 추가.
 */
function buildCompetition(
  input: MarketResearchInput,
  입력필요: string[],
  평가포인트: string[]
): { 표: TableSpec; 정성적경고: string[]; radar?: RadarSpec } {
  const competitors = input.competitors ?? [];
  const 정성적경고: string[] = [];

  // 비교축: 명시 비교축 우선, 없으면 competitors metrics 키들의 합집합(입력 순서 보존)
  // (caller 입력 배열을 변형하지 않도록 복사본 사용 — 결정성·불변성)
  const 비교축: string[] = [...(input.비교축 ?? [])];
  if (비교축.length === 0) {
    const seen = new Set<string>();
    for (const c of competitors) {
      for (const k of Object.keys(c.metrics ?? {})) {
        if (!seen.has(k)) {
          seen.add(k);
          비교축.push(k);
        }
      }
    }
  }

  // 입력 부족 처리(사실 무결성)
  if (competitors.length === 0) {
    입력필요.push("[입력 필요: 경쟁사 목록(자사 포함, 비교지표별 수치)]");
  }
  if (비교축.length === 0) {
    입력필요.push("[입력 필요: 경쟁 비교축(가격·정확도·DB수 등)]");
  }
  if (competitors.length > 0 && !competitors.some((c) => c.self)) {
    입력필요.push("[입력 필요: 경쟁비교표에 자사(self=true) 행]");
    평가포인트.push("경쟁비교표에 자사 행이 없습니다 — 자사 핵심 경쟁력 행을 강조(highlight)해야 합니다.");
  }

  // 표 구성: 헤더 = [구분, ...비교축]
  const headers = ["구분", ...비교축];
  let highlightRow: number | undefined;
  const rows: string[][] = competitors.map((c, idx) => {
    if (c.self) highlightRow = idx;
    const cells = 비교축.map((축) => {
      const v = c.metrics?.[축];
      if (v === undefined || v === null || String(v).trim() === "") {
        입력필요.push(`[입력 필요: '${c.name}'의 '${축}' 수치]`);
        return "[입력 필요]";
      }
      // 정성적 표현 감지(§0-6, §9-3)
      if (isQualitative(v)) {
        정성적경고.push(
          `'${c.name}'의 '${축}' = "${v}" 는 정성적 표현입니다 — 전력량·가격·DB수처럼 수치로 바꾸세요.`
        );
      }
      return String(v);
    });
    return [c.name, ...cells];
  });

  const 표: TableSpec = {
    kind: "table",
    title: "경쟁제품 수치 비교 (자사 핵심 경쟁력 행 강조)",
    headers,
    rows,
    highlightRow,
  };

  // 정성적 경고가 있으면 평가포인트에도 요약
  if (정성적경고.length > 0) {
    평가포인트.push(
      `정성적 표현 ${정성적경고.length}건 감지 — '매우 빠름/우수'식 형용사는 감점입니다. 모두 수치로 교체하세요.`
    );
  } else if (competitors.length > 0 && 비교축.length > 0) {
    평가포인트.push("경쟁비교가 수치로 작성되어 있습니다(정성적 표현 없음) — 좋은 신호입니다.");
  }

  // radar: 비교축이 3개 이상이고, 모든 셀이 수치로 변환 가능할 때만 생성
  let radar: RadarSpec | undefined;
  if (비교축.length >= 3 && competitors.length > 0) {
    const series: RadarSpec["series"] = [];
    let 전부수치 = true;
    for (const c of competitors) {
      const values: number[] = [];
      for (const 축 of 비교축) {
        const raw = c.metrics?.[축];
        const num = toNumeric(raw);
        if (num === undefined) {
          전부수치 = false;
          break;
        }
        values.push(num);
      }
      if (!전부수치) break;
      series.push({ name: c.name, values, highlight: c.self === true });
    }
    if (전부수치 && series.length > 0) {
      radar = {
        kind: "radar",
        title: "자사 vs 경쟁사 다축 비교",
        axes: 비교축,
        series,
      };
    } else {
      평가포인트.push(
        "레이더 차트는 모든 비교축이 수치일 때 생성됩니다 — 정성적/누락 셀을 수치로 채우면 자동 생성됩니다."
      );
    }
  }

  return { 표, 정성적경고, radar };
}

/** 셀 값을 숫자로 변환(단위·콤마 제거). 변환 불가면 undefined(레이더 제외). */
function toNumeric(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const m = String(raw).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : undefined;
}
