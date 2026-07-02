/**
 * 요청 업그레이드 플래너 — upgradeRequest()
 *
 * 보스 비전: 사용자가 짧게 요청하면("인천 AI 창업 공고 찾아줘") 그 요청을
 * 'AI 활용도를 극대화하는 업그레이드된 작업 플랜/프롬프트'로 증폭해,
 * ① 무엇을 어떻게 확장할지 요약을 보여주고 ② 꼭 필요한 것만 1~2개 물은 뒤
 * ③ 승인 1회로 기존 17개 tool 시퀀스를 그대로 실행하게 만든다.
 *
 * 불변 원칙(설계 게이트):
 *  - 결정적: Math.random·Date.now·외부 I/O 금지. 같은 입력 → 같은 출력(2회 동일).
 *  - 사실 무결성: 사용자 사실(수치·실적·업종·단계 등)을 추정해 슬롯에 채우지 않는다.
 *    모르는 슬롯은 추가질문으로만 확인한다("전략은 채워도 사실은 채우지 않는다").
 *  - 재사용: 의도·지역·업종·단계 신호 추출에 synonyms.ts를 재사용한다(중복 구현 금지).
 *    실제 tool명·인자명은 register.ts/schemas.ts와 정확히 일치시킨다(오호출 방지).
 *  - 이 파일은 순수 계획 로직만 담는다(다른 tool을 실제로 호출하지 않는다 —
 *    프리뷰 병행 실행은 register.ts의 upgrade_request 핸들러가 담당하도록 프롬프트로 지시).
 */
import { tokenMatches, REGION_NAMES } from "../lib/synonyms.js";

// ────────────────────────────────────────────────────────────
// 타입 (이 파일에서 완결 정의·export)
// ────────────────────────────────────────────────────────────

/** 결정적 키워드 규칙으로 분류하는 의도 버킷. */
export type Intent =
  | "공고찾기"
  | "자격확인"
  | "서류작성"
  | "계획서작성"
  | "시장조사"
  | "로드맵"
  | "복합"
  | "기타";

/** 요청에서 추출한 사실 신호(지어내지 않은, 텍스트에 실제로 등장한 값만). */
export interface ExtractedSignals {
  /** 광역 지역명(REGION_NAMES 기준). 없으면 null. */
  지역: string | null;
  /** 업종/분야 키워드(SYNONYM_GROUPS 대표어 매칭). 여러 개 가능. */
  업종: string[];
  /** 창업 단계(예비/초기/도약). 텍스트에 명시된 경우만. 없으면 null. */
  단계: "예비" | "초기" | "도약" | null;
  /** 요청에 명시된 grant_id(예: kstartup:178198). 없으면 null. */
  grant_id: string | null;
  /** 요청에 이미 특정 tool명이 명시되었는가(스킵 신호). */
  tool명시: boolean;
  /** 사용자가 '바로/그냥/설명 됐고' 류 스킵 의사를 표현했는가. */
  스킵의사: boolean;
}

/** 확장 플랜의 한 단계. */
export interface PlanStep {
  순번: number;
  행동: string;
  /** 이 단계에서 호출할 기존 tool 이름(있으면). */
  도구?: string;
  이유: string;
}

/** upgradeRequest() 반환. structuredContent로도 그대로 노출 가능한 평면 구조. */
export interface UpgradeResult {
  의도: Intent;
  /** 요청이 이미 충분히 구체적이면 true — 업그레이드 없이 바로 실행 권장. */
  바로실행: boolean;
  /** 사용자에게 보여줄 5줄 이내 요약(3단 고정 틀: 확장방식 / 즉시가치 / 최소질문). */
  업그레이드요약: string[];
  /** 실행 순서(호스트가 그대로 순회). */
  확장플랜: PlanStep[];
  /** 각 항목에 그것을 실제로 검증하는 기존 tool/로직 이름을 괄호로 병기(과대광고 방지). */
  품질기준: string[];
  /** 플랜 정밀화에 실질적으로 필요한 것만 1~2개(모르는 슬롯 우선순위 정렬). */
  추가질문: string[];
  /** 존댓말·양자택일형 승인 1문장. */
  승인요청: string;
  /** 호스트 AI가 승인 후 그대로 따를 실행 지시문(번호 강제·사실 미조작·재호출 금지 포함). */
  업그레이드프롬프트: string;
  /** 추출된 사실 신호(지어내지 않음 — 투명 공개). */
  신호: ExtractedSignals;
  /** 참고용 고지. */
  고지: string;
  /** 이 지시문을 따르는 동안 upgrade_request 재호출 금지 플래그. */
  승인후_재호출불필요: true;
}

// ────────────────────────────────────────────────────────────
// 상수 — 의도 버킷 키워드(결정적) · 고지
// ────────────────────────────────────────────────────────────

/** 이 플랜은 전략 제안이며 사실은 추가질문으로 확인해야 한다(upgrade 전용 고지). */
export const 업그레이드고지 =
  "이 플랜은 요청을 확장한 전략 제안이며, 사용자 사실(수치·실적·업종·단계 등)은 추정하지 않고 추가질문으로 확인합니다. " +
  "합격선 기본 70은 참고값이며 공고별 실제 합격선은 운영기관(공고 원문)으로 확인해야 합니다.";

/**
 * 의도 버킷별 매칭 키워드 세트.
 * 토큰화된 요청을 각 버킷에 대해 세어 최다 득점 버킷을 의도로 선택한다.
 * 부분 문자열 매칭(한글) — synonyms.tokenMatches로 검사한다.
 */
const INTENT_KEYWORDS: Record<Exclude<Intent, "복합" | "기타">, string[]> = {
  공고찾기: ["공고", "찾아", "찾아줘", "검색", "추천", "지원사업", "모집", "지원금", "사업공고", "지원사업공고"],
  자격확인: ["자격", "되나요", "가능한가", "가능한가요", "결격", "대상", "해당되", "신청가능", "자격요건", "지원자격"],
  서류작성: ["서식", "양식", "칸", "붙여넣", "hwp", "hwpx", "조립", "제출용", "신청서", "작성서식", "서류"],
  계획서작성: ["사업계획서", "psst", "써줘", "작성해", "계획서", "초안", "작성해줘", "사업계획"],
  시장조사: ["시장", "경쟁사", "tam", "sam", "som", "경쟁분석", "시장조사", "경쟁", "시장규모"],
  로드맵: ["로드맵", "마일스톤", "자금계획", "징검다리", "성장전략", "타임라인", "일정계획"],
};

/** 단계 신호 사전 — 텍스트 표기 → 표준 단계값. */
const STAGE_HINTS: Array<{ 표기: string[]; 값: "예비" | "초기" | "도약" }> = [
  { 표기: ["예비창업", "예비 창업", "예비창업자", "예비"], 값: "예비" },
  { 표기: ["초기창업", "초기 창업", "초기창업자", "3년 이내", "3년이내", "초기"], 값: "초기" },
  { 표기: ["도약", "7년 이내", "7년이내", "성장기", "도약기"], 값: "도약" },
];

/** 스킵 의사(즉시 실행) 표현. */
const SKIP_HINTS = ["바로", "그냥", "설명 됐", "설명됐", "설명은 됐", "묻지 말", "묻지말", "질문 없이", "바로 해", "그냥 해", "빨리"];

// ────────────────────────────────────────────────────────────
// 신호 추출(사실 — 지어내지 않음)
// ────────────────────────────────────────────────────────────

/** 요청 텍스트에서 광역 지역명을 추출(REGION_NAMES 순회). 여러 개면 첫 등장 우선. */
export function extractRegion(text: string): string | null {
  const t = text ?? "";
  let best: { name: string; idx: number } | null = null;
  for (const r of REGION_NAMES) {
    const idx = t.indexOf(r);
    if (idx >= 0 && (best === null || idx < best.idx)) best = { name: r, idx };
  }
  return best?.name ?? null;
}

/** 요청에서 업종/분야 대표어를 추출(SYNONYM_GROUPS 재사용 — 표기 변형 흡수). */
function extractIndustries(lower: string): string[] {
  // 대표 후보(각 그룹의 첫 단어)로 매칭해 정규화된 대표어를 돌려준다.
  const 후보: string[] = [
    "ai", "sw", "it", "앱", "플랫폼", "데이터", "바이오", "로봇", "콘텐츠",
    "관광", "환경", "글로벌", "제조", "푸드", "핀테크", "재창업", "소상공인",
  ];
  const out: string[] = [];
  for (const c of 후보) {
    if (tokenMatches(lower, c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** 단계 신호 추출(명시된 경우만 — 없으면 null, 추정 금지). */
function extractStage(lower: string): "예비" | "초기" | "도약" | null {
  for (const h of STAGE_HINTS) {
    if (h.표기.some((p) => lower.includes(p.toLowerCase()))) return h.값;
  }
  return null;
}

/** grant_id 추출(예: kstartch:178198, bizinfo:xxx 형태의 'prefix:토큰'). */
function extractGrantId(text: string): string | null {
  // 'grant_id=...' 또는 'id 접두어:숫자/영숫자' 패턴. 결정적 정규식.
  const m = text.match(/\bgrant_id\s*[=:]\s*([A-Za-z][\w-]*:[\w-]+)/);
  if (m) return m[1];
  const m2 = text.match(/\b([a-z][a-z0-9_-]*:[0-9][\w-]*)\b/i);
  return m2 ? m2[1] : null;
}

/** 요청에 특정 tool명이 명시되어 있는가(스킵 신호). */
function mentionsToolName(lower: string): boolean {
  const tools = [
    "find_grants", "recommend_grants", "check_eligibility", "score_application",
    "win_strategy", "plan_outline", "market_research", "build_roadmap",
    "draft_section", "plan_review", "hwp_layout", "required_inputs",
    "assemble_plan", "locate_form_source", "analyze_form", "compose_application",
    "export_document",
  ];
  return tools.some((n) => lower.includes(n));
}

export function extractSignals(요청: string, 맥락?: string): ExtractedSignals {
  const combined = `${요청 ?? ""} ${맥락 ?? ""}`;
  const lower = combined.toLowerCase();
  return {
    지역: extractRegion(combined),
    업종: extractIndustries(lower),
    단계: extractStage(lower),
    grant_id: extractGrantId(combined),
    tool명시: mentionsToolName(lower),
    스킵의사: SKIP_HINTS.some((h) => lower.includes(h.toLowerCase())),
  };
}

// ────────────────────────────────────────────────────────────
// 의도 분류(버킷 채점 + 복합 감지 + 기타 폴백)
// ────────────────────────────────────────────────────────────

interface IntentScore {
  의도: Intent;
  /** 버킷별 매칭 점수(디버그·복합 판정용). */
  scores: Array<{ bucket: Exclude<Intent, "복합" | "기타">; score: number }>;
}

/**
 * 결정적 의도 분류.
 * 1) 각 버킷의 키워드가 요청 텍스트에 몇 개 매칭되는지 센다(tokenMatches).
 * 2) 최다 득점 버킷이 의도. 단, 2개 이상 버킷이 매칭되고 1·2위 점수 차 ≤ 1이면 '복합'.
 * 3) 매칭 0건이면 '기타' 폴백.
 * 동점·순서 안정성: INTENT_KEYWORDS의 선언 순서로 tie-break(결정적).
 */
export function classifyIntent(요청: string, 맥락?: string): IntentScore {
  const lower = `${요청 ?? ""} ${맥락 ?? ""}`.toLowerCase();
  const buckets = Object.keys(INTENT_KEYWORDS) as Array<Exclude<Intent, "복합" | "기타">>;
  const scores = buckets.map((bucket) => {
    let score = 0;
    for (const kw of INTENT_KEYWORDS[bucket]) {
      // 영문 짧은 토큰(ai·it·sw·psst 등)은 tokenMatches의 경계 규칙을 타고,
      // 한글/긴 토큰은 부분 문자열 매칭. 동의어 확장도 흡수.
      if (tokenMatches(lower, kw)) score += 1;
    }
    return { bucket, score };
  });

  // 참조 명사 강등: "이 공고 자격 되나요"처럼 '공고'류 명사만 맞고(찾아/검색/추천 같은
  // 행동어 없음) 다른 버킷이 더 높으면, '공고'는 검색 의도가 아니라 대상 지칭이다 → 0점 처리.
  // (동점이면 강등하지 않음 — "공고 찾고 자격도 봐줘" 같은 진짜 복합 요청 보존)
  const 검색행동어 = ["찾아", "검색", "추천"];
  const 공고Idx = scores.findIndex((s) => s.bucket === "공고찾기");
  if (공고Idx >= 0 && scores[공고Idx].score > 0) {
    const has행동 = 검색행동어.some((kw) => tokenMatches(lower, kw));
    const maxOther = Math.max(
      ...scores.filter((s) => s.bucket !== "공고찾기").map((s) => s.score)
    );
    if (!has행동 && maxOther > scores[공고Idx].score) {
      scores[공고Idx] = { ...scores[공고Idx], score: 0 };
    }
  }

  const 총합 = scores.reduce((s, x) => s + x.score, 0);
  if (총합 === 0) return { 의도: "기타", scores };

  // 점수 내림차순(동점은 선언 순서 유지 — buckets는 이미 선언 순).
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted[1];

  // 복합: 2위도 실제로 매칭(≥1)되고 1·2위 차가 1 이하.
  if (second && second.score >= 1 && top.score - second.score <= 1) {
    return { 의도: "복합", scores };
  }
  return { 의도: top.bucket, scores };
}

// ────────────────────────────────────────────────────────────
// 플랜 템플릿(의도별) — 실제 tool명·인자명을 정확히 사용
// ────────────────────────────────────────────────────────────

/** 신호를 프롬프트에 안전하게 끼워넣기 위한 리터럴(사실만·따옴표 처리). */
function 지역리터럴(s: ExtractedSignals): string {
  return s.지역 ? `'${s.지역}'` : "(지역 미상 — 사용자에게 확인)";
}
function 업종리터럴(s: ExtractedSignals): string {
  return s.업종.length ? `[${s.업종.map((x) => `'${x}'`).join(", ")}]` : "(업종 미상)";
}
function 키워드배열리터럴(s: ExtractedSignals): string {
  return s.업종.length ? `[${s.업종.map((x) => `'${x}'`).join(", ")}]` : "[]";
}
function 단계리터럴(s: ExtractedSignals): string {
  return s.단계 ? `'${s.단계}'` : "(단계 미상 — 사용자에게 확인)";
}

/** find_grants / recommend_grants 병행 호출 지시(인자 체계가 서로 다름 — 절대 혼용 금지). */
function 확장검색지시(s: ExtractedSignals): string {
  const region = s.지역 ? s.지역 : "";
  const kwStr = s.업종.length ? s.업종.join(" ") : "";
  const kwArr = s.업종.length ? s.업종.map((x) => `'${x}'`).join(", ") : "";
  // find_grants: region/keywords 는 단수 string. recommend_grants: 지역/키워드 는 각각 string / string[].
  const fgArgs: string[] = [];
  if (kwStr) fgArgs.push(`keywords:'${kwStr}'`);
  if (region) fgArgs.push(`region:'${region}'`);
  if (s.단계) fgArgs.push(`stage:'${s.단계}'`);
  const rgArgs: string[] = [];
  if (kwArr) rgArgs.push(`키워드:[${kwArr}]`);
  if (region) rgArgs.push(`지역:'${region}'`);
  if (s.단계) rgArgs.push(`단계:'${s.단계}'`);
  return (
    `recommend_grants({${rgArgs.join(", ")}})와 find_grants({${fgArgs.join(", ")}})를 나란히 병행 호출하라. ` +
    `두 tool은 인자 체계가 다르다(find_grants.region/keywords=단수 string, recommend_grants.지역=string·키워드=string[]) — 인자명을 서로 대입하지 마라. ` +
    (region
      ? `${region} 밀착 공고를 최우선으로 두되, 접수 지역이 '전국'이라 ${region} 기업도 지원 가능한 공고까지 함께 보여줘라(지역 배제 금지). `
      : "") +
    `키워드는 동의어(예: AI=인공지능·생성형·머신러닝·LLM)까지 자동 확장해 검색하라(synonyms 재사용).`
  );
}

/** score_application 반복 보완 루프(종료조건·카운트를 문자열로 고정 — 호스트가 임의 종료 못 하게). */
const 채점보완루프 =
  "score_application을 호출해 총점을 합격선(사용자가 지정하지 않으면 70 — 참고값이며 실제 합격선은 공고 원문 확인)과 비교하라. " +
  "총점이 합격선 미만이면, 반환된 '다음수정제안' 중 감점이 가장 큰 항목부터 draft_section(또는 서류작성 흐름이면 compose_application의 해당 칸)으로 다시 써서 반영한 뒤 score_application을 다시 호출하라. " +
  "이 재작성→재채점 사이클을 총점이 합격선 이상이 되거나 3회 반복할 때까지(최초 1회 + 보완 최대 2회 = score_application 호출 최대 3회) 계속하라. " +
  "3회 후에도 미달이면 어느 항목이 근본적으로 부족한지(예: 실적·수치 부재)를 있는 그대로 보고하고 추가 사실을 요청하라(임의로 채우지 마라).";

/** 사실 미조작·번호 준수·재호출 금지 공통 규율(모든 업그레이드프롬프트 말미). */
const 프롬프트공통규율 =
  "[규율] 위 번호 순서를 지켜 진행하라. 각 단계 결과의 출처·기준시점·고지를 사용자에게 그대로 전달하라. " +
  "사용자의 사실(수치·실적·기관명·업종·단계·날짜)을 절대 추정해 채우지 마라 — 모르면 묻고, 사용자도 모르면 '[입력 필요]'로 남겨라. " +
  "이 실행 지시문을 따르는 동안 upgrade_request를 다시 호출하지 마라(무한 승인 루프 금지). 후속 대화·순서 조정(예: '3번 스킵하고 5번부터')은 이 지시문 안에서 직접 처리하라.";

interface Template {
  플랜: PlanStep[];
  품질기준: string[];
  요약생성: (s: ExtractedSignals) => string[];
  프롬프트본문: (s: ExtractedSignals) => string;
  /** 이 의도에서 프리뷰(확장검색 병행)를 권장하는가(사용자 사실 불필요한 의도만). */
  프리뷰권장: boolean;
}

function 템플릿(의도: Intent): Template {
  switch (의도) {
    case "공고찾기":
      return {
        프리뷰권장: true,
        플랜: [
          { 순번: 1, 행동: "요청에서 지역·업종·단계·키워드 신호 정리·확인(1줄)", 이유: "확장 정확도 확보 — 사실만 사용, 미상은 질문" },
          { 순번: 2, 행동: "확장 검색 병행 실행(지역 밀착 + 전국에서 지원가능 + 동의어 확장)", 도구: "recommend_grants + find_grants", 이유: "적합도 랭킹(추천)과 조건 검색(발견)을 함께 제시" },
          { 순번: 3, 행동: "적합도·매칭이유와 함께 5건 이내로 제시(출처·기준시점 포함)", 도구: "recommend_grants", 이유: "선택 가능한 실제 공고만 노출" },
          { 순번: 4, 행동: "사용자가 공고를 고르면 자격 확인으로 자연 연결", 도구: "check_eligibility", 이유: "찾기→자격의 원스톱 흐름" },
        ],
        품질기준: [
          "수집된 실제 공고만 노출(find_grants/recommend_grants가 스토어만 조회 — 공고 지어내기 0건)",
          "지역 밀착 우선 + 전국 지원가능 포함(find_grants partitionByRegion 재사용)",
          "동의어 확장으로 표기 변형 누락 0(synonyms.tokenMatches 재사용)",
          "모든 공고에 출처·기준시점·고지 포함(각 tool 출력에 내장)",
        ],
        요약생성: (s) => [
          `① ${s.지역 ? s.지역 + " 밀착 공고 + " + s.지역 + " 기업도 지원 가능한 전국 공고까지" : "관련 공고를"} 함께 찾고, ` +
            `${s.업종.length ? s.업종.join("·") + " 동의어(예: AI=인공지능·생성형·머신러닝·LLM)" : "키워드 동의어"}도 포함해 검색합니다.`,
          "② 승인하시면 recommend_grants+find_grants를 병행해 적합도순 5건 이내로 바로 보여드립니다(가능하면 미리보기 첨부).",
          "③ 꼭 필요한 확인:",
        ],
        프롬프트본문: (s) =>
          `[의도: 공고찾기 — 확장 검색]\n` +
          `1) 요청에서 지역=${지역리터럴(s)}, 업종/키워드=${업종리터럴(s)}, 단계=${단계리터럴(s)} 를 정리해 한 줄로 확인받아라(미상은 추정 말고 질문).\n` +
          `2) ${확장검색지시(s)}\n` +
          `3) 적합도·매칭이유·출처·기준시점과 함께 5건 이내로 제시하라. 결과가 0건이면 조건을 완화해 재검색하고, 그래도 없으면 '해당 없음(확인 불가)'을 정직하게 알려라.\n` +
          `4) 사용자가 공고를 고르면 check_eligibility({grant_id, profile})로 자격 확인까지 이어가라.`,
      };

    case "자격확인":
      return {
        프리뷰권장: false,
        플랜: [
          { 순번: 1, 행동: "대상 공고 확정(grant_id 없으면 먼저 검색)", 도구: "recommend_grants / find_grants", 이유: "자격은 특정 공고 기준으로만 판정 가능" },
          { 순번: 2, 행동: "프로필(업력·지역·업종·투자유치·결격상태) 최소 확인", 도구: "required_inputs", 이유: "판정에 필요한 사실만 질문 — 추정 금지" },
          { 순번: 3, 행동: "결정적 규칙으로 자격 판정(적합/확인필요/부적합 + 공고문구 근거)", 도구: "check_eligibility", 이유: "창업여부·업력·지역·신산업·결격·새출발기금 예외 등" },
          { 순번: 4, 행동: "부적합/확인필요면 사유·대안·보완액션 안내, 적합이면 전략으로 연결", 도구: "win_strategy", 이유: "탈락·환수 오판 방지 + 다음 행동 제시" },
        ],
        품질기준: [
          "특정 공고 기준으로만 판정(check_eligibility는 grant_id 필수 — 일반화 금지)",
          "결격·업력·지역·신산업·새출발기금 예외를 결정적 규칙으로 판정(check_eligibility 도메인 로직)",
          "근거 없는 항목은 '확인 불가'로 정직 표기(자격 지어내기 0건)",
          "자격 보증 금지 — 운영기관 최종확인 고지 포함(자격고지 내장)",
        ],
        요약생성: (s) => [
          `① ${s.grant_id ? "지정하신 공고 " + s.grant_id : "대상 공고"}에 대해 창업여부·업력·지역·결격(새출발기금 예외 포함)을 결정적 규칙으로 판정합니다.`,
          "② 승인하시면 부족한 프로필만 최소로 여쭙고 바로 적합/확인필요/부적합 + 공고문구 근거를 드립니다.",
          "③ 꼭 필요한 확인:",
        ],
        프롬프트본문: (s) =>
          `[의도: 자격확인]\n` +
          `1) 대상 공고를 확정하라. grant_id=${s.grant_id ?? "(미지정)"}. 없으면 recommend_grants/find_grants로 먼저 공고를 고르게 하라.\n` +
          `2) required_inputs({grant_id})로 판정에 필요한 프로필 항목을 확인하고, 사용자가 아직 주지 않은 것만 우선순위대로 물어라(업력→지역→업종→투자유치→결격).\n` +
          `3) check_eligibility({grant_id, profile})로 판정하라. 근거 없는 항목은 '확인 불가'로 남기고 지어내지 마라.\n` +
          `4) 부적합/확인필요면 사유·대안·보완액션을 제시하고, 적합이면 win_strategy({grant_id, profile})로 합격 전략까지 이어가라.`,
      };

    case "서류작성":
      return {
        프리뷰권장: false,
        플랜: [
          { 순번: 1, 행동: "대상 공고 확정 + 서식 출처 안내(파일 대신 받아오지 않음)", 도구: "locate_form_source", 이유: "HWP는 PDF 변환/전체복사로 받아야 분석 가능" },
          { 순번: 2, 행동: "사용자가 붙여넣은 서식 텍스트를 칸·질문 목록으로 분석", 도구: "analyze_form", 이유: "칸 유형·PSST 매핑·필요 사실 도출(원래 순서 보존)" },
          { 순번: 3, 행동: "칸별로 아직 없는 사실만 최소 질문(교차 확인)", 도구: "required_inputs", 이유: "한 번에 몰아 묻지 않음 — 추정 금지" },
          { 순번: 4, 행동: "답변을 칸 유형별 규칙으로 조립(서식 순서 보존)", 도구: "compose_application", 이유: "0점답변·정성표현 경고·자금표 합계 검증" },
          { 순번: 5, 행동: "조립 결과 체크리스트 점검(0점답변·정성표현·요약)", 도구: "plan_review", 이유: "감점요인 자동 판정" },
          { 순번: 6, 행동: "채점 후 합격선 미달이면 감점 큰 칸부터 재작성→재채점(최대 3회)", 도구: "score_application", 이유: "'다시 쓰게' 만들어 합격권으로 끌어올림" },
          { 순번: 7, 행동: "최종본을 다운로드 문서(docx)로 내보내기 + 전문 폴백", 도구: "export_document", 이유: "제출용 파일 제공" },
        ],
        품질기준: [
          "0점답변(아직 없다/최초/선점/지원해주면) 0건(plan_review·compose_application이 검사)",
          "정성적 경쟁표현 0건(plan_review·compose_application이 검사)",
          "자금표 자동합계=표기합계 일치(compose_application 자금검증 재사용)",
          "서식 원래 칸 순서 보존(compose_application이 재배열하지 않음)",
          "score_application 총점 ≥ 합격선(기본 70)까지 재작성→재채점 최대 3회(호스트가 반복 호출)",
        ],
        요약생성: () => [
          "① 서식 칸을 분석→부족한 정보만 최소 질문→칸 유형별 규칙으로 조립→채점까지 원스톱으로 진행합니다.",
          "② 채점 결과 합격선(기본 70) 미달이면 감점 큰 칸부터 다시 써서 재채점을 최대 3회 반복해 끌어올립니다(예: 65점→78점).",
          "③ 꼭 필요한 확인:",
        ],
        프롬프트본문: (s) =>
          `[의도: 서류작성 — 서식 원스톱]\n` +
          `1) 대상 공고 확정(grant_id=${s.grant_id ?? "(미지정)"}). 없으면 recommend_grants/find_grants로 고르게 한 뒤 locate_form_source({grant_id})로 서식 출처를 안내하라. 서식이 HWP면 'PDF 변환 업로드 또는 전체복사 붙여넣기'를 안내하고 완성본은 DOCX로 제공된다고 알려라. 서식을 줄 때까지 기다려라(파일을 대신 받아오지 마라).\n` +
          `2) 사용자가 서식 텍스트를 주면 analyze_form({form_text, grant_id?})로 칸·질문 목록을 뽑아라(원래 순서 보존).\n` +
          `3) required_inputs({grant_id?, provided?})와 교차해 아직 없는 사실만 최소로 물어라(몰아 묻지 마라).\n` +
          `4) compose_application({fields:[{칸이름,유형?,psst매핑?,답변?}], grant_id?, 사업아이템명?})로 칸별로 조립하라(PSST 순서로 재배열 금지). 0점답변·정성표현·자금표 합계 경고를 사용자에게 전달하라.\n` +
          `5) plan_review({sections?|fullText?})로 조립 결과를 점검하고 경고가 있으면 다시 쓰게 하라.\n` +
          `6) ${채점보완루프}\n` +
          `7) 합격권에 들면 export_document({제목, sections:[{칸이름,내용}], format:'docx'})로 최종 파일을 만들고 다운로드 URL과 전문을 함께 안내하라.`,
      };

    case "계획서작성":
      return {
        프리뷰권장: false,
        플랜: [
          { 순번: 1, 행동: "사업 자료에서 업종·단계·지역·강점·키워드 정리·확인", 도구: "plan_outline", 이유: "PSST 골격·작성원칙·유의점 확보" },
          { 순번: 2, 행동: "계획서에 꼭 필요한 사실만 섹션별 최소 질문", 도구: "required_inputs", 이유: "P·S1·S2·T 사실 확보 — 추정 금지" },
          { 순번: 3, 행동: "제공 사실로 P→S1→S2→T 섹션 초안 작성", 도구: "draft_section", 이유: "■요약·해자·수치·0점답변 차단 규칙 적용" },
          { 순번: 4, 행동: "필요 도식 생성(시장규모·경쟁 / 자금 징검다리)", 도구: "market_research + build_roadmap", 이유: "정성표현 경고·수치 시각화" },
          { 순번: 5, 행동: "체크리스트 점검 + 채점, 합격선 미달이면 재작성→재채점(최대 3회)", 도구: "plan_review + score_application", 이유: "감점요인 제거·합격권 도달" },
          { 순번: 6, 행동: "전체 합본(정부양식 순서) + 분량 조정", 도구: "assemble_plan + hwp_layout", 이유: "제출 가능한 형태로 마무리" },
        ],
        품질기준: [
          "0점답변 0건·정성표현 0건(plan_review·assemble_plan이 검사)",
          "시장·자금 수치는 입력 기반만·미상은 '[입력 필요]'(market_research·build_roadmap이 강제)",
          "자금합계 일치·분량 목표 대비 진단(assemble_plan·hwp_layout 재사용)",
          "score_application 총점 ≥ 합격선(기본 70)까지 재작성→재채점 최대 3회(호스트가 반복 호출)",
        ],
        요약생성: (s) => [
          `① 주신 자료로 PSST(문제·실현·성장·팀) 골격을 잡고, 부족한 사실만 최소로 여쭤 초안을 만듭니다${s.업종.length ? ` (업종: ${s.업종.join("·")})` : ""}.`,
          "② 시장·자금 도식을 붙이고, 채점 결과 합격선(기본 70) 미달이면 감점 큰 섹션부터 다시 써서 재채점을 최대 3회 반복합니다.",
          "③ 꼭 필요한 확인:",
        ],
        프롬프트본문: (s) =>
          `[의도: 계획서작성 — PSST 풀코스]\n` +
          `1) 사업 자료에서 업종=${업종리터럴(s)}·단계=${단계리터럴(s)}·지역=${지역리터럴(s)}·강점·키워드를 정리해 확인받고 plan_outline({업종?,지역?,대표경력?,grant_id?})로 골격을 잡아라.\n` +
          `2) required_inputs({grant_id?, provided?})로 P·S1·S2·T에 꼭 필요한 사실만 섹션별로 물어라(몰아 묻지 마라, 추정 금지).\n` +
          `3) draft_section({section:'P'|'S1'|'S2'|'T', inputs})로 P→S1→S2→T를 차례로 작성하라. 제공 사실만 쓰고 빠진 건 '[입력 필요]'로 두어라. 0점답변·정성표현이 잡히면 고쳐 써라.\n` +
          `4) market_research({...})·build_roadmap({...})로 시장규모·경쟁·자금 징검다리 도식을 만들어라(수치는 입력값만).\n` +
          `5) plan_review로 점검한 뒤, ${채점보완루프}\n` +
          `6) assemble_plan({sections:{P?,S1?,S2?,T?}, grant_id?, 목표페이지?, charts?})로 정부양식 순서로 합본하고 hwp_layout({목표페이지?,현재글자수?})로 분량을 맞춰라. 최종은 사용자가 검토 후 HWP 양식에 넣는다고 안내하라.`,
      };

    case "시장조사":
      return {
        프리뷰권장: false,
        플랜: [
          { 순번: 1, 행동: "업종·지역·비교축 확인(수치·출처는 사용자 제공)", 도구: "required_inputs", 이유: "시장 수치는 지어내지 않음" },
          { 순번: 2, 행동: "PEST·TAM/SAM/SOM/LAM·경쟁비교표·레이더 도식 생성", 도구: "market_research", 이유: "정성표현 경고·입력필요 표시" },
          { 순번: 3, 행동: "계획서 S1/S2에 반영하거나 채점으로 연결", 도구: "draft_section / score_application", 이유: "시장 근거를 심사 포인트로 전환" },
        ],
        품질기준: [
          "시장 수치는 입력 기반만·미상은 '[입력 필요]'(market_research가 강제 — 수치 지어내기 0건)",
          "정성적 경쟁표현 경고 노출(market_research 정성적경고 재사용)",
          "출처는 사용자가 확인·기입(시장고지 내장)",
        ],
        요약생성: (s) => [
          `① ${s.업종.length ? s.업종.join("·") + " " : ""}시장을 PEST·TAM/SAM/SOM/LAM·경쟁비교(레이더)로 구조화합니다.`,
          "② 승인하시면 도식을 생성하되, 수치·출처는 지어내지 않고 없는 값은 '[입력 필요]'로 표시합니다.",
          "③ 꼭 필요한 확인:",
        ],
        프롬프트본문: (s) =>
          `[의도: 시장조사]\n` +
          `1) required_inputs로 업종=${업종리터럴(s)}·지역=${지역리터럴(s)}·비교축·시장 수치(TAM/SAM/SOM/LAM)·출처를 사용자에게 확인하라(수치는 절대 추정 금지).\n` +
          `2) market_research({업종?,지역?,pest?,marketSize?,competitors?,비교축?})로 PEST·시장규모·경쟁비교표·레이더 도식을 생성하라. 없는 값은 '[입력 필요]'로 남겨라.\n` +
          `3) 결과를 draft_section(S1/S2)에 반영하거나 score_application으로 심사 포인트로 연결하라.`,
      };

    case "로드맵":
      return {
        프리뷰권장: false,
        플랜: [
          { 순번: 1, 행동: "거점·과거준비(완료)·미래 마일스톤·자금계획 확인", 도구: "required_inputs", 이유: "매출 수치·시점은 사용자 제공" },
          { 순번: 2, 행동: "4축 인과 타임라인 + 자금 징검다리 + 시장변화 서술 + 도식", 도구: "build_roadmap", 이유: "시간 나열이 아닌 인과 사슬" },
          { 순번: 3, 행동: "계획서 S2(성장전략)에 반영 또는 채점 연결", 도구: "draft_section / score_application", 이유: "로드맵을 성장전략 근거로 전환" },
        ],
        품질기준: [
          "매출·시점 수치는 입력 기반만·미상은 '[입력 필요]'(build_roadmap이 강제)",
          "자금 징검다리는 지식베이스 매칭만(build_roadmap이 지어내지 않음)",
          "시장변화는 인과 사슬로 서술(build_roadmap 골격 재사용)",
        ],
        요약생성: (s) => [
          `① ${s.업종.length ? s.업종.join("·") + " " : ""}성장 로드맵을 4축(아이템·자금·마케팅·운영) 인과 타임라인 + 자금 징검다리로 구성합니다.`,
          "② 승인하시면 도식까지 만들되, 매출·시점 수치는 지어내지 않고 없는 값은 '[입력 필요]'로 둡니다.",
          "③ 꼭 필요한 확인:",
        ],
        프롬프트본문: (s) =>
          `[의도: 로드맵]\n` +
          `1) required_inputs로 거점=${지역리터럴(s)}·과거준비(완료)·미래 마일스톤(시점·인과)·자금계획을 확인하라(수치·시점 추정 금지).\n` +
          `2) build_roadmap({사업명?,거점?,과거준비?,미래계획?,자금계획?})로 4축 인과 타임라인·자금 징검다리·1·3·5·7년 시장변화 서술·로드맵 도식을 생성하라.\n` +
          `3) 결과를 draft_section(S2 성장전략)에 반영하거나 score_application으로 연결하라.`,
      };

    case "복합":
      return {
        프리뷰권장: true,
        플랜: [
          { 순번: 1, 행동: "요청·자료에서 업종·단계·지역·키워드 정리·확인", 이유: "복합 흐름의 공통 출발점 — 사실만" },
          { 순번: 2, 행동: "맞는 공고를 적합도순으로 추천", 도구: "recommend_grants", 이유: "발견부터 시작해 자연 연결" },
          { 순번: 3, 행동: "고른 공고 자격 확인", 도구: "check_eligibility", 이유: "찾기→자격 누락 방지" },
          { 순번: 4, 행동: "계획서에 필요한 최소 정보 확인 후 골격·초안", 도구: "required_inputs + draft_section", 이유: "자격 통과 후 작성으로 이어짐" },
          { 순번: 5, 행동: "채점 후 합격선 미달이면 재작성→재채점(최대 3회)", 도구: "score_application", 이유: "합격권 도달" },
        ],
        품질기준: [
          "찾기→자격→작성 단계 누락 0(복합 템플릿이 순서 강제)",
          "공고·자격·수치 지어내기 0(각 tool 도메인 로직·고지 재사용)",
          "score_application 총점 ≥ 합격선(기본 70)까지 재작성→재채점 최대 3회(호스트가 반복 호출)",
        ],
        요약생성: (s) => [
          `① 주신 요청·자료로 공고 추천→자격 확인→계획서 골격까지 한 흐름으로 도와드립니다${s.업종.length ? ` (업종: ${s.업종.join("·")})` : ""}.`,
          "② 승인하시면 recommend_grants부터 시작해 자격·작성까지 순서대로 진행합니다(사실은 그때그때 최소로만 확인).",
          "③ 꼭 필요한 확인:",
        ],
        프롬프트본문: (s) =>
          `[의도: 복합 — 추천→자격→작성]\n` +
          `1) 요청·자료에서 업종=${업종리터럴(s)}·단계=${단계리터럴(s)}·지역=${지역리터럴(s)}·키워드를 정리해 확인받아라(추정 금지).\n` +
          `2) recommend_grants({키워드:${키워드배열리터럴(s)}${s.지역 ? `, 지역:'${s.지역}'` : ""}${s.단계 ? `, 단계:'${s.단계}'` : ""}})로 맞는 공고를 5건 이내 추천하라(필요시 find_grants 병행).\n` +
          `3) 사용자가 공고를 고르면 check_eligibility({grant_id, profile})로 자격을 확인하라.\n` +
          `4) 적합하면 required_inputs로 최소 정보를 확인하고 draft_section(P→S1→S2→T)으로 초안을 작성하라(빠진 건 '[입력 필요]').\n` +
          `5) ${채점보완루프}`,
      };

    default: // 기타 — 폴백
      return {
        프리뷰권장: true,
        플랜: [
          { 순번: 1, 행동: "요청 원문에서 파악 가능한 신호만 정리하고 목적을 1문장 확인", 이유: "분류 신뢰도가 낮아 목적을 먼저 좁힘" },
          { 순번: 2, 행동: "가장 가까운 흐름(공고찾기)으로 우선 진행 — recommend_grants+find_grants 병행", 도구: "recommend_grants + find_grants", 이유: "빈손 대신 즉시 가치 제공" },
          { 순번: 3, 행동: "사용자 응답에 따라 자격확인/서류작성/계획서작성 흐름으로 전환", 이유: "목적 확정 후 정밀 플랜으로 재진입" },
        ],
        품질기준: [
          "분류 실패를 사용자에게 노출하지 않고 가장 가까운 가이드로 안내(폴백 규칙)",
          "공고·사실 지어내기 0(각 tool 도메인 로직·고지 재사용)",
        ],
        요약생성: (s) => [
          "① 요청을 정확히 분류하기 어려워, 가장 가까운 '공고 찾기' 흐름으로 먼저 도와드립니다(목적을 1문장만 확인).",
          `② 승인하시면 ${s.지역 || s.업종.length ? "파악된 신호로 " : ""}공고 추천·검색을 병행해 결과부터 보여드립니다.`,
          "③ 꼭 필요한 확인:",
        ],
        프롬프트본문: (s) =>
          `[의도: 기타 — 폴백(가이드: 공고_빠른매칭에 준함)]\n` +
          `분류 근거: 요청에서 특정 의도 키워드가 뚜렷하지 않아 '공고 찾기'를 기본 흐름으로 택했다.\n` +
          `1) 사용자에게 목적을 1문장으로 확인하라(공고 찾기 / 자격 확인 / 서류·계획서 작성 중 무엇인지).\n` +
          `2) ${확장검색지시(s)}\n` +
          `3) 사용자 응답에 따라 자격확인·서류작성·계획서작성 흐름으로 전환하라(그때는 이 지시문 안에서 처리, upgrade_request 재호출 금지).`,
      };
  }
}

// ────────────────────────────────────────────────────────────
// 추가질문(모르는 슬롯만 1~2개, 우선순위 정렬)
// ────────────────────────────────────────────────────────────

/** 의도별로 결과 품질에 실질적 영향을 주는 슬롯 우선순위. */
const 질문우선순위: Record<Intent, Array<{ 슬롯: keyof ExtractedSignals; 질문: string }>> = {
  공고찾기: [
    { 슬롯: "단계", 질문: "창업 단계를 알려주세요(예비/초기 3년 이내/도약 7년 이내). 알려주시면 더 좁혀드립니다." },
    { 슬롯: "업종", 질문: "핵심 업종·분야가 무엇인가요?(예: AI·플랫폼·식품)" },
    { 슬롯: "지역", 질문: "사업장(예정) 지역은 어디인가요?" },
  ],
  자격확인: [
    { 슬롯: "grant_id", 질문: "어떤 공고의 자격을 볼까요? 공고를 아직 안 고르셨으면 먼저 찾아드릴게요." },
    { 슬롯: "단계", 질문: "현재 업력/창업 단계를 알려주세요(예비/초기/도약)." },
  ],
  서류작성: [
    { 슬롯: "grant_id", 질문: "어떤 공고 서식인가요? 공고를 안 고르셨으면 먼저 찾아드릴게요." },
    { 슬롯: "업종", 질문: "사업 아이템(업종)을 한 줄로 알려주세요." },
  ],
  계획서작성: [
    { 슬롯: "업종", 질문: "사업 아이템·업종을 한 줄로 알려주세요." },
    { 슬롯: "단계", 질문: "창업 단계를 알려주세요(예비/초기/도약)." },
  ],
  시장조사: [
    { 슬롯: "업종", 질문: "어떤 업종·아이템의 시장인가요?" },
    { 슬롯: "지역", 질문: "주 거점 지역이 있나요?(LAM 산정에 사용)" },
  ],
  로드맵: [
    { 슬롯: "업종", 질문: "어떤 사업의 로드맵인가요?(사업명·업종)" },
    { 슬롯: "지역", 질문: "최초 거점 지역은 어디인가요?" },
  ],
  복합: [
    { 슬롯: "업종", 질문: "사업 아이템·업종을 한 줄로 알려주세요." },
    { 슬롯: "단계", 질문: "창업 단계를 알려주세요(예비/초기/도약)." },
  ],
  기타: [
    { 슬롯: "업종", 질문: "무엇을 도와드릴지 한 문장으로 알려주세요(공고 찾기·자격 확인·서류/계획서 작성 등)." },
  ],
};

/** 아직 모르는(신호에 없는) 슬롯에 대한 질문만, 최대 2개. */
function buildQuestions(의도: Intent, s: ExtractedSignals): string[] {
  const cand = 질문우선순위[의도] ?? [];
  const out: string[] = [];
  for (const q of cand) {
    if (out.length >= 2) break;
    const v = s[q.슬롯];
    const 있음 = Array.isArray(v) ? v.length > 0 : v !== null && v !== false;
    if (!있음) out.push(q.질문);
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// 바로실행 판별(검토안 경계 규칙) — 결정적
// ────────────────────────────────────────────────────────────

/**
 * 요청이 이미 구체적이면 업그레이드 없이 바로 실행 권장.
 * 규칙(결정적):
 *  (a) tool명·grant_id 명시 → 즉시 실행,
 *  (b) 스킵 의사 표현 → 즉시 실행,
 *  (c) 지역·업종·단계 중 실질 신호 3개 이상(업종 다개면 1로 카운트) → 이미 조건 충분.
 */
function shouldSkipUpgrade(s: ExtractedSignals): boolean {
  if (s.tool명시 || s.grant_id) return true;
  if (s.스킵의사) return true;
  const 신호수 = (s.지역 ? 1 : 0) + (s.업종.length ? 1 : 0) + (s.단계 ? 1 : 0);
  return 신호수 >= 3;
}

// ────────────────────────────────────────────────────────────
// 메인 — upgradeRequest()
// ────────────────────────────────────────────────────────────

export interface UpgradeInput {
  /** 사용자의 원문 요청 그대로. */
  요청: string;
  /** 사용자가 준 자료 요약·상황(선택). */
  맥락?: string;
}

/**
 * 짧은 요청을 업그레이드된 작업 플랜/프롬프트로 증폭한다(결정적).
 * @returns UpgradeResult — 의도·요약·플랜·품질기준·질문·승인문구·실행프롬프트·신호·고지.
 */
export function upgradeRequest(input: UpgradeInput): UpgradeResult {
  const 요청 = (input?.요청 ?? "").trim();
  const 맥락 = input?.맥락;
  const s = extractSignals(요청, 맥락);
  const { 의도 } = classifyIntent(요청, 맥락);
  const tpl = 템플릿(의도);
  const 바로실행 = shouldSkipUpgrade(s);

  const 질문 = 바로실행 ? [] : buildQuestions(의도, s);

  // 업그레이드요약: 3단 고정 틀. 마지막 '③ 꼭 필요한 확인:' 뒤에 질문을 붙인다(없으면 안내).
  const 요약본문 = tpl.요약생성(s).slice(); // 방어적 복사
  const 요약: string[] = [];
  if (바로실행) {
    요약.push(
      `요청에 조건이 충분합니다(${[s.지역 && "지역", s.업종.length && "업종", s.단계 && "단계", s.grant_id && "공고", s.tool명시 && "도구지정", s.스킵의사 && "즉시요청"].filter(Boolean).join("·") || "명시된 조건"}).`,
      "업그레이드 없이 바로 진행을 권장합니다 — 아래 플랜대로 즉시 실행하면 됩니다."
    );
  } else {
    for (const line of 요약본문) {
      if (line.startsWith("③")) {
        if (질문.length) {
          요약.push(line);
          질문.forEach((q) => 요약.push(`  - ${q}`));
        } else {
          요약.push("③ 추가로 여쭐 것 없이 바로 시작할 수 있습니다.");
        }
      } else {
        요약.push(line);
      }
    }
  }
  // 5줄 이내 강제(고정 틀상 최대 요약3 + 질문2 = 6요소지만 '③' 라인과 질문을 묶어 5줄 이내 유지).
  const 업그레이드요약 = 요약.slice(0, 5);

  // 승인요청: 존댓말·양자택일형(질문이 있으면 '좁히기' 옵션 제시, 없으면 바로).
  const 승인요청 = 바로실행
    ? "요청이 이미 구체적입니다 — 이대로 바로 진행할까요?"
    : 질문.length
    ? "이대로 찾아/진행해 볼까요, 아니면 위 항목만 먼저 알려주시면 더 좁혀서 진행할까요?"
    : "이대로 진행할까요?";

  // 업그레이드프롬프트: 의도별 본문 + 채점 관련 의도면 루프 강조 + 공통 규율.
  const 프롬프트머리 =
    `아래는 승인된 실행 지시문이다. 번호 순서대로 그대로 실행하라.` +
    (맥락 ? `\n[사용자 제공 맥락]\n${맥락}\n` : "\n");
  const 업그레이드프롬프트 =
    `${프롬프트머리}\n${tpl.프롬프트본문(s)}\n\n${프롬프트공통규율}`;

  return {
    의도,
    바로실행,
    업그레이드요약,
    확장플랜: tpl.플랜,
    품질기준: tpl.품질기준,
    추가질문: 질문,
    승인요청,
    업그레이드프롬프트,
    신호: s,
    고지: 업그레이드고지,
    승인후_재호출불필요: true,
  };
}
