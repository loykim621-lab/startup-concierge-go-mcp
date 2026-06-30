/**
 * 로드맵 엔진 — buildRoadmap()
 * §7 마일스톤 4축, §8 자금 징검다리, §16 로드맵을 결정적 규칙으로 인코딩(정부지원 사업계획서 표준 방법론).
 *
 * 핵심 원칙(강의):
 * - 로드맵은 "시간 나열"이 아니라 시장변화·인과 사슬("무엇이 되어야 다음이 가능한가").
 * - 과거준비(완료) + 미래계획을 하나의 타임라인에 맞물려 4축(아이템/자금/마케팅/운영)으로.
 * - 자금은 징검다리: 예창패→초창패→도약/TIPS (FUNDING_MAP과 매칭).
 * - 1·3·5·7년 서술은 "회사 자랑"이 아니라 "시장이 어떻게 변하고 우리가 어디에 서는가".
 *
 * 사실 무결성 원칙(최우선):
 * - 창업자의 사실(수치·실적·기관명)을 지어내지 않는다. 빠진 사실은 입력필요에 "[입력 필요: ___]".
 * - 결정적: Math.random 금지. 같은 입력 → 같은 출력.
 * - ChartSpec만 RenderedChart.spec에 담고 svg는 비운다(렌더는 tool 계층).
 */
import type {
  RenderedChart,
  RoadmapInput,
  RoadmapMilestoneInput,
  RoadmapResult,
  RoadmapSpec,
  축,
} from "./types.js";
import {
  FUNDING_MAP,
  마일스톤4축,
  자금타임라인순서,
} from "./knowledge.js";
import { 작성고지 } from "../disclaimer.js";

// ───────────────────────────── 시점 파싱 ─────────────────────────────
//
// 지원 형식: "2026", "2026-09", "2026-9", "2026-Q3", "2026Q3", "2026-H1".
// 정렬을 위해 (연, 월서수)로 환산한다. 분기/반기는 시작 월로, 월 미상은 0(연초)으로.
// 비교는 정렬에만 쓰며, 표기는 원문 그대로 보존한다(사실 무결성).

interface 시점키 {
  연: number | null;
  월서수: number; // 0=미상(연초), 1~12=월
  원문: string;
}

function parse시점(raw: string | undefined): 시점키 {
  const 원문 = (raw ?? "").trim();
  if (!원문) return { 연: null, 월서수: 0, 원문 };

  const 연match = 원문.match(/(\d{4})/);
  const 연 = 연match ? parseInt(연match[1], 10) : null;

  // 분기 Q1~Q4 → 시작 월(1/4/7/10)
  const q = 원문.match(/Q\s*([1-4])/i);
  if (q) return { 연, 월서수: (parseInt(q[1], 10) - 1) * 3 + 1, 원문 };

  // 반기 H1/H2 → 시작 월(1/7)
  const h = 원문.match(/H\s*([1-2])/i);
  if (h) return { 연, 월서수: parseInt(h[1], 10) === 1 ? 1 : 7, 원문 };

  // YYYY-MM (연 다음 1~2자리 월)
  if (연match) {
    const rest = 원문.slice(연match.index! + 연match[1].length);
    const m = rest.match(/[-/.\s]\s*(\d{1,2})/);
    if (m) {
      const mm = parseInt(m[1], 10);
      if (mm >= 1 && mm <= 12) return { 연, 월서수: mm, 원문 };
    }
  }
  return { 연, 월서수: 0, 원문 };
}

/** 정렬 비교: 연(미상은 맨 앞=과거 취급) → 월서수 → 원문(안정 정렬). */
function 시점비교(a: 시점키, b: 시점키): number {
  const ay = a.연 ?? -Infinity;
  const by = b.연 ?? -Infinity;
  if (ay !== by) return ay - by;
  if (a.월서수 !== b.월서수) return a.월서수 - b.월서수;
  return a.원문.localeCompare(b.원문, "ko");
}

// ───────────────────────────── 축 추론 ─────────────────────────────
//
// 미래계획은 축을 명시받지만, 과거준비는 자유 텍스트이므로 키워드로 축을 추론한다.
// 강의 §7 4축: 아이템 / 자금 / 마케팅 / 운영.

const 축키워드: { 축: 축; 패턴: RegExp }[] = [
  {
    축: "자금",
    패턴: /(예창패|초창패|도약패|예비창업|초기창업|창업도약|패키지|지원금|출연|융자|보증|투자|TIPS|엔젤|VC|펀드|기보|신보|IP|R&BD|디딤돌|자금)/i,
  },
  {
    축: "운영",
    패턴: /(법인|사업자등록|연구소|벤처기업|인증|채용|인력|조직|특허\s*등록|이전)/,
  },
  {
    축: "마케팅",
    패턴: /(마케팅|광고|노출|유입|퍼널|거점|입점|판로|채널|확장|고객\s*확보)/,
  },
  {
    축: "아이템",
    패턴: /(MVP|시제품|프로토타입|개발|고도화|제작|기능|특허\s*출원|R&D|연구개발|제품|서비스)/i,
  },
];

function 추론축(내용: string): 축 {
  for (const { 축, 패턴 } of 축키워드) {
    if (패턴.test(내용)) return 축;
  }
  // 키워드 미검출 시: 준비물은 통상 아이템·운영 성격 → '아이템'을 기본으로(추측 최소화).
  return "아이템";
}

// ───────────────────────── 자금 프로그램 매칭 ─────────────────────────
//
// 사용자 표기(약칭 포함)를 FUNDING_MAP의 정식 프로그램과 매칭한다.
// 매칭 실패 시: 자금타임라인순서/FUNDING_MAP에서 가장 가까운 프로그램을 제안하고 비고에 표기.

/** 매칭용 정규화: 공백·괄호·기호 제거, 소문자, 약칭 펼침. */
function 정규화(s: string): string {
  let t = (s ?? "").toLowerCase().replace(/[\s()（）·.,/\-]/g, "");
  // 흔한 약칭 → 정식 토큰
  const 약칭: [RegExp, string][] = [
    [/예창패|예비창업/g, "예비창업패키지"],
    [/초창패|초기창업/g, "초기창업패키지"],
    [/도약패|창도패|창업도약/g, "창업도약패키지"],
    [/tips/g, "tips"],
    [/r&bd|rbd|디딤돌|창업성장기술/g, "창업성장기술개발디딤돌rbd"],
    [/기보|기술보증/g, "기술보증기금기보"],
    [/신보|신용보증/g, "신용보증기금신보"],
  ];
  for (const [re, rep] of 약칭) t = t.replace(re, rep);
  return t;
}

/** 두 정규화 문자열의 토큰(2글자 단위) 겹침 점수 — 결정적 근접도. */
function 근접점수(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1000;
  if (a.includes(b) || b.includes(a)) return 500 + Math.min(a.length, b.length);
  const grams = (s: string): Set<string> => {
    const g = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
  };
  const ga = grams(a);
  const gb = grams(b);
  let 겹침 = 0;
  for (const g of ga) if (gb.has(g)) 겹침++;
  return 겹침;
}

interface 자금매칭 {
  프로그램: string;
  종류: string;
  비고: string;
}

/** 사용자 표기 한 건을 FUNDING_MAP과 매칭. 실패하면 가장 가까운 프로그램을 제안. */
function 매칭자금(표기: string): 자금매칭 {
  const norm표기 = 정규화(표기);
  let best: { p: (typeof FUNDING_MAP)[number]; 점수: number } | null = null;
  for (const p of FUNDING_MAP) {
    const 점수 = 근접점수(norm표기, 정규화(p.이름));
    if (!best || 점수 > best.점수) best = { p, 점수 };
  }
  // 정확/포함 매칭(점수>=500)이면 채택, 부분 겹침(>=2)이면 채택+주의, 그 외엔 제안.
  if (best && best.점수 >= 500) {
    return {
      프로그램: best.p.이름,
      종류: best.p.종류,
      비고: best.p.비고 ?? best.p.조건 ?? "",
    };
  }
  if (best && best.점수 >= 2) {
    return {
      프로그램: best.p.이름,
      종류: best.p.종류,
      비고: `입력 '${표기}'을(를) 가장 가까운 '${best.p.이름}'(으)로 추정 — 정확한 프로그램명을 공고로 확인하세요.${best.p.비고 ? " " + best.p.비고 : ""}`,
    };
  }
  // 제안 폴백: 강의 자금타임라인순서의 첫 단계를 제안.
  return {
    프로그램: 표기,
    종류: "확인 불가",
    비고: `'${표기}'을(를) 자금조달 지도(FUNDING_MAP)에서 매칭하지 못함 — 단계별 징검다리(${자금타임라인순서
      .slice(0, 4)
      .join(" → ")} …) 중 해당 프로그램을 공고로 확인하세요. [입력 필요: 정확한 자금 프로그램명]`,
  };
}

// ───────────────────────── 시장변화 서술 스캐폴드 ─────────────────────────
//
// 강의 §10/§16: "회사 자랑"이 아니라 "시장이 어떻게 변하고 우리가 어디에 서는가".
// 구체 사실(수치·기관·지명)은 [입력 필요]로 — 지어내지 않는다.

function 시장변화서술(거점?: string): string[] {
  const LAM = 거점 && 거점.trim() ? 거점.trim() : "[입력 필요: 최초 거점(LAM)]";
  return [
    `1년차 — 시장변화: [입력 필요: 1년 내 시장의 핵심 변화(수요·규제·경쟁)]. 우리의 위치: ${LAM} 거점에서 검증·초기 점유(SOM 확보).`,
    "3년차 — 시장변화: [입력 필요: 3년 내 시장 구조 변화(예: 양극화·신규 수요 부상)]. 우리의 위치: 검증된 모델로 인접 지역/세그먼트 확장.",
    "5년차 — 시장변화: [입력 필요: 5년 내 기술·행동 전환(예: AI가 기존 채널 대체)]. 우리의 위치: 축적한 데이터·관계(해자)로 전국/주류 시장 진입.",
    "7년차 — 시장변화: [입력 필요: 7년 시점 시장의 재편 양상]. 우리의 위치: 전환비용·네트워크로 락인(lock-in) 완성, 후발주자 진입 차단.",
  ];
}

// ───────────────────────────── 차트 빌드 ─────────────────────────────
//
// roadmap ChartSpec: years(가로축 연도), phases(Phase 띠), revenue(매출 곡선), events(마커).
// 자금/운영 축의 핵심 사건(사업자등록·기보/신보·연구소설립·투자 등)은 events 마커로.

const 이벤트마커패턴 =
  /(사업자등록|법인\s*설립|법인전환|기보|기술보증|신보|신용보증|벤처기업|연구소\s*설립|기업부설연구소|특허\s*등록|TIPS|투자\s*유치|상장|IPO)/i;

interface 정렬항목 {
  시점: string;
  키: 시점키;
  축: 축;
  내용: string;
  상태: "완료" | "진행중" | "예정";
  인과: string;
}

function build차트(정렬: 정렬항목[], 사업명?: string): RenderedChart {
  const 입력필요: string[] = [];

  // 연도 축: 타임라인에 등장한 연도 + 강의 기본(없으면 입력 필요).
  const 연도집합 = new Set<number>();
  for (const it of 정렬) if (it.키.연 != null) 연도집합.add(it.키.연);
  const years = Array.from(연도집합)
    .sort((a, b) => a - b)
    .map((y) => String(y));
  if (years.length === 0) 입력필요.push("[입력 필요: 로드맵 연도 축(미래계획 시점을 연 단위로 입력)]");

  // Phase 띠: 강의 형식(Phase 1/2/3)을 골격으로, 시작/끝 연도는 타임라인에서 추론.
  const phases: RoadmapSpec["phases"] = [];
  if (years.length > 0) {
    const 시작 = 연도집합.size ? Math.min(...연도집합) : 0;
    const 끝 = 연도집합.size ? Math.max(...연도집합) : 0;
    const 자금프로그램 = 정렬
      .filter((it) => it.축 === "자금")
      .map((it) => it.내용);
    phases.push({
      label: "Phase 1 (검증·초기 점유)",
      startYear: 시작,
      endYear: Math.min(시작 + (끝 > 시작 ? 1 : 0), 끝),
      programs: 자금프로그램.slice(0, 2),
    });
    if (끝 > 시작) {
      phases.push({
        label: "Phase 2 (확장)",
        startYear: Math.min(시작 + 1, 끝),
        endYear: 끝,
        programs: 자금프로그램.slice(2, 4),
      });
    }
  }

  // 매출 곡선: 사실(수치)이 없으므로 입력 필요로만 남기고 임의 수치 금지.
  let revenue: RoadmapSpec["revenue"] | undefined;
  if (years.length > 0) {
    입력필요.push("[입력 필요: 연도별 매출 추정치(단계별 누적 — 임의 수치 금지)]");
  }

  // 이벤트 마커: 운영/자금 축의 핵심 사건.
  const events: NonNullable<RoadmapSpec["events"]> = [];
  for (const it of 정렬) {
    if (it.키.연 == null) continue;
    if (이벤트마커패턴.test(it.내용)) {
      const m = it.내용.match(이벤트마커패턴);
      events.push({ year: it.키.연, label: m ? m[0] : it.내용 });
    }
  }

  const spec: RoadmapSpec = {
    kind: "roadmap",
    title: 사업명 ? `${사업명} 성장 로드맵` : "성장 로드맵",
    years,
    phases,
    revenue,
    events,
  };

  return { spec, svg: "", 입력필요: 입력필요.length ? 입력필요 : undefined };
}

// ───────────────────────────── 메인 ─────────────────────────────

export function buildRoadmap(input: RoadmapInput): RoadmapResult {
  const 입력필요: string[] = [];

  const 과거 = input.과거준비 ?? [];
  const 미래 = input.미래계획 ?? [];

  if (과거.length === 0) {
    입력필요.push(
      "[입력 필요: 과거준비(완료) — 시장조사·강의수료·자격증·동종업계 재직·MVP 제작 등 이미 한 것을 '완료'로]"
    );
  }
  if (미래.length === 0) {
    입력필요.push(
      "[입력 필요: 미래계획 — 시점·축(아이템/자금/마케팅/운영)·내용·인과를 가진 마일스톤]"
    );
  }

  // ── 1. 과거준비 → 타임라인 항목(완료) ──
  const 항목들: 정렬항목[] = [];
  for (const p of 과거) {
    const 키 = parse시점(p.시점);
    if (!p.시점) {
      입력필요.push(`[입력 필요: 과거준비 '${p.내용}'의 시점]`);
    }
    항목들.push({
      시점: p.시점 ?? "(시점 미상)",
      키,
      축: 추론축(p.내용),
      내용: p.내용,
      상태: "완료",
      // 예시의 '예정'을 '완료/운영 중'으로 — 과거준비는 강점의 뿌리.
      인과: "이미 완료 — 이후 단계의 전제(이 사람이라서 되겠다의 증거).",
    });
  }

  // ── 2. 미래계획 → 타임라인 항목 ──
  for (const m of 미래 as RoadmapMilestoneInput[]) {
    const 키 = parse시점(m.시점);
    if (!m.시점) 입력필요.push(`[입력 필요: 미래계획 '${m.내용}'의 시점]`);
    항목들.push({
      시점: m.시점 ?? "(시점 미상)",
      키,
      축: m.축,
      내용: m.내용,
      상태: m.상태 ?? "예정",
      인과:
        m.인과 ??
        "[입력 필요: 인과 — '무엇이 되어야 이 단계가 가능한가'(시간 나열이 아니라 인과 사슬)]",
    });
  }

  // ── 3. 시점 오름차순 정렬(완료=과거가 앞, 미래가 뒤로 자연 정렬) ──
  항목들.sort((a, b) => 시점비교(a.키, b.키));

  const 타임라인 = 항목들.map((it) => ({
    시점: it.시점,
    축: it.축,
    내용: it.내용,
    상태: it.상태,
    인과: it.인과,
  }));

  // ── 4. 자금 징검다리 ──
  // 우선순위: input.자금계획(명시) → 미래계획의 자금축 항목. 시점은 미래계획에서 끌어온다.
  const 자금징검다리: RoadmapResult["자금징검다리"] = [];

  // (a) 자금축 미래계획 항목 → 시점 보유
  const 자금미래 = 항목들.filter((it) => it.축 === "자금");
  // (b) input.자금계획 표기 → 위 항목과 매칭 시 시점 연결, 아니면 시점 미상
  const 자금계획 = input.자금계획 ?? [];

  if (자금계획.length > 0) {
    for (const 표기 of 자금계획) {
      const 매칭 = 매칭자금(표기);
      // 같은 프로그램을 가리키는 미래계획 항목의 시점을 찾는다(결정적: 첫 일치).
      const 연결 = 자금미래.find(
        (it) => 매칭자금(it.내용).프로그램 === 매칭.프로그램
      );
      자금징검다리.push({
        시점: 연결?.시점 ?? "(시점 미상)",
        프로그램: 매칭.프로그램,
        종류: 매칭.종류,
        비고: 연결
          ? 매칭.비고
          : 매칭.비고
            ? `${매칭.비고} (시점은 미래계획 자금축으로 연결 권장)`
            : "시점은 미래계획 자금축으로 연결 권장.",
      });
    }
  } else if (자금미래.length > 0) {
    // 자금계획 미입력 시: 미래계획 자금축에서 직접 추출.
    for (const it of 자금미래) {
      const 매칭 = 매칭자금(it.내용);
      자금징검다리.push({
        시점: it.시점,
        프로그램: 매칭.프로그램,
        종류: 매칭.종류,
        비고: 매칭.비고,
      });
    }
  } else {
    입력필요.push(
      `[입력 필요: 자금 징검다리 — 자금계획(예: 예비창업패키지 → 초기창업패키지 → TIPS) 또는 자금축 미래계획. 표준 골격: ${자금타임라인순서
        .slice(0, 5)
        .join(" → ")} …]`
    );
  }

  // 자금징검다리는 시점 오름차순으로(시점 미상은 뒤로).
  자금징검다리.sort((a, b) => 시점비교(parse시점(a.시점), parse시점(b.시점)));

  // ── 5. 시장변화 서술(1·3·5·7년) ──
  const 시장변화 = 시장변화서술(input.거점);

  // ── 6. 차트 ──
  const chart = build차트(항목들, input.사업명);
  if (chart.입력필요) 입력필요.push(...chart.입력필요);

  // ── 평가포인트(강의 §16) ──
  const 평가포인트: string[] = [
    "시간 나열 금지 — 각 단계는 '무엇이 되어야 다음이 가능한가' 인과 사슬로 연결되어야 한다(인과 미입력 항목은 [입력 필요] 표시).",
    `자금은 징검다리로 — ${마일스톤4축.find((a) => a.축 === "자금")?.설명 ?? "지원금 징검다리→융자→투자"} (예: 예비창업패키지 → 초기창업패키지 → 창업도약패키지/TIPS).`,
    "예시의 '예정' 표현을 '완료/운영 중'으로 치환 — 과거준비를 '완료' 상태로 드러내 '이 사람이라서 되겠다'를 증명.",
    "1·3·5·7년 서술은 회사 자랑이 아니라 '시장이 어떻게 변하고 우리가 어디에 서는가'(시장 변화 중심).",
    "4축(아이템·자금·마케팅·운영)이 한 타임라인에 맞물려야 한다 — 한 축만 있으면 사고 수준이 얕아 보인다.",
  ];

  return {
    타임라인,
    자금징검다리,
    시장변화서술: 시장변화,
    chart,
    입력필요: Array.from(new Set(입력필요)),
    평가포인트,
    고지: 작성고지,
  };
}
