/**
 * PSST 골격(plan_outline)·섹션 초안(draft_section)·체크리스트(plan_review) 엔진.
 * 강의 단일 진실원(knowledge.ts)을 결정적으로 가공한다. Math.random 금지.
 *
 * 사실 무결성 원칙(최우선):
 * - 창업자의 사실(수치·실적·기관명)을 절대 지어내지 않는다.
 * - 양식이 요구하나 입력에 없는 사실은 결과의 '입력필요'에 "[입력 필요: ___]"로 표시한다.
 * - 본문은 창업자가 넣은 입력만 PSST 규칙으로 재구성(사실 미조작)한다.
 */
import type {
  ChartKind,
  ChecklistItem,
  ChecklistResult,
  DraftSectionInput,
  DraftSectionResult,
  PlanOutlineResult,
  PsstKey,
  PsstSectionSpec,
} from "./types.js";
import {
  ABSOLUTE_CHECKLIST,
  PSST_SECTIONS,
  관통원칙,
  아이템명형식,
  detectZeroPoint,
  정성적표현_PATTERNS,
} from "./knowledge.js";
import { 작성고지 } from "../disclaimer.js";

// ── 공용 헬퍼 ──

/** PsstKey → 스펙 조회(결정적). 없으면 undefined. */
function 섹션스펙(key: PsstKey): PsstSectionSpec | undefined {
  return PSST_SECTIONS.find((s) => s.key === key);
}

/** "[입력 필요: ___]" 표준 표기 */
function 입력필요표기(무엇: string): string {
  return `[입력 필요: ${무엇}]`;
}

// ── plan_outline ──

/**
 * PSST 4섹션 골격 + 아이템명 형식 + 관통원칙 + 절대 체크리스트.
 * grantMeta/profile이 있으면 '이공고_유의'를 맞춤 생성(업력요건·마감일 역산·지방 우대).
 */
export function buildPlanOutline(opts: {
  grantMeta?: { 제목?: string; 마감일?: string; 업력요건?: string };
  profile?: any;
} = {}): PlanOutlineResult {
  const grantMeta = opts.grantMeta ?? {};
  const profile = opts.profile ?? {};

  const 섹션 = PSST_SECTIONS.map((spec) => ({
    key: spec.key,
    한글명: spec.한글명,
    핵심질문: spec.핵심질문,
    요구내용: [...spec.요구내용],
    필수도식: [...spec.필수도식],
    작성원칙: [...spec.작성원칙],
    이공고_유의: 이공고유의(spec.key, grantMeta, profile),
  }));

  return {
    아이템명형식,
    섹션,
    관통원칙: [...관통원칙],
    체크리스트: [...ABSOLUTE_CHECKLIST],
    고지: 작성고지,
  };
}

/**
 * 섹션별 공고·프로필 맞춤 유의점(결정적).
 * grantMeta/profile에 근거가 있을 때만 항목을 추가하고, 사실을 지어내지 않는다.
 */
function 이공고유의(
  key: PsstKey,
  grantMeta: { 제목?: string; 마감일?: string; 업력요건?: string },
  profile: any
): string[] {
  const out: string[] = [];

  // S1(실현가능성): 협약기간 내 개발계획은 마감일 역산이 핵심.
  if (key === "S1") {
    if (grantMeta.마감일) {
      out.push(
        `접수 마감일(${grantMeta.마감일}) 기준으로 협약기간 내 개발계획(간트)을 역산하라 — 마감 전 제출 가능한 일정으로 월별 행을 배치.`
      );
    }
    if (grantMeta.업력요건) {
      out.push(
        `공고 업력요건(${grantMeta.업력요건})에 맞춰 '사업화 사전준비(인력·MVP·DB)'를 이미 완료한 시점·수량으로 적어 적격성을 증명하라.`
      );
    }
  }

  // P(문제인식): 업종/거점 기반 PEST·시장현황 강조.
  if (key === "P") {
    if (profile?.업종) {
      out.push(
        `업종(${profile.업종}) 국내·해외 시장현황 그래프와 'must have' 필요성(닫힌 지갑 시장)을 수치로 제시하라.`
      );
    }
  }

  // S2(성장전략): 지방 소재면 LAM(거점) 우대·문체부 로컬 라인 반영.
  if (key === "S2") {
    if (지방소재(profile)) {
      out.push(
        `지방(${profile.지역}) 소재 — LAM(최초 거점) 시장을 명확히 하고, 지방 우대(자부담)·문체부 로컬크리에이터 등 유리 조건을 성장전략에 반영하라.`
      );
    }
  }

  // T(팀): 동종업계 경력·네트워크가 모든 강점의 뿌리.
  if (key === "T") {
    if (profile?.대표경력 || profile?.동종업계경력) {
      out.push(
        `대표자 동종업계 경력(${profile.대표경력 ?? profile.동종업계경력})을 '이 사람이라서 되겠다'의 핵심 증거로 전면에 배치하라.`
      );
    }
  }

  // 모든 섹션 공통: 공고 제목이 있으면 그 사업 맥락을 환기(사실 추가 아님).
  if (grantMeta.제목 && out.length === 0) {
    out.push(
      `'${grantMeta.제목}' 공고의 평가지표·요구내용에 이 섹션 서술을 정렬하라(공고 원문 우선).`
    );
  }

  return out;
}

/** 지방 소재 여부(서울/경기/인천=수도권 외이면 지방) — 결정적 휴리스틱. */
function 지방소재(profile: any): boolean {
  const 지역: string | undefined = profile?.지역;
  if (!지역) return false;
  const 수도권 = ["서울", "경기", "인천"];
  return !수도권.some((s) => 지역.includes(s));
}

// ── draft_section ──

/** 섹션별로 '요약 첫 줄에 들어가야 할 핵심 사실 키' 후보(있으면 요약에 사용). */
const 요약키후보: Record<PsstKey, string[]> = {
  P: ["문제", "필요성", "시장현황", "아이템소개", "핵심요약"],
  S1: ["사전준비", "MVP", "인력", "DB", "개발계획", "핵심요약"],
  S2: ["차별성", "비즈니스모델", "매출", "성장전략", "포지셔닝", "핵심요약"],
  T: ["대표경력", "조직역량", "팀구성", "네트워크", "핵심요약"],
};

/**
 * 창업자 inputs(사실)을 해당 PSST 섹션 규칙으로 구조화한다.
 * - 요약: 단락 상단 ■ 2~3줄(입력 기반, 없으면 입력필요)
 * - 본문: 요구내용 순서대로 입력을 재구성(사실 미조작), 없는 항목은 [입력 필요]
 * - 경고: detectZeroPoint(0점답변), 정성적 표현 감지
 * - 추천도식: 해당 섹션 필수도식
 */
export function draftSection(input: DraftSectionInput): DraftSectionResult {
  const spec = 섹션스펙(input.section);
  const inputs = input.inputs ?? {};
  // 입력 전체 텍스트(0점답변·정성적표현 스캔용)
  const 전체텍스트 = Object.values(inputs)
    .map((v) => String(v ?? ""))
    .join(" \n");

  if (!spec) {
    // 알 수 없는 섹션 키 — 사실 무결성: 단정하지 않고 입력필요로 안내.
    return {
      section: input.section,
      한글명: "(알 수 없는 섹션)",
      요약: [],
      본문: "",
      입력필요: [입력필요표기(`유효한 PSST 섹션 키(P·S1·S2·T) — 받은 값: ${input.section}`)],
      경고: [],
      추천도식: [],
      고지: 작성고지,
    };
  }

  const 입력필요: string[] = [];

  // ── 요약(■ 2~3줄) ──
  const 요약: string[] = [];
  const 키목록 = 요약키후보[input.section];
  for (const k of 키목록) {
    const 값 = 찾기(inputs, k);
    if (값) 요약.push(`■ ${한줄로(값)}`);
    if (요약.length >= 3) break;
  }
  if (요약.length === 0) {
    입력필요.push(
      입력필요표기(`${spec.한글명} 상단 핵심 요약 2~3줄(■) — 이 섹션의 결론을 한 문장으로`)
    );
  }

  // ── 본문(요구내용 순서대로 입력 재구성, 사실 미조작) ──
  const 본문줄: string[] = [];
  for (const 요구 of spec.요구내용) {
    // 요약줄 요구는 위에서 처리했으므로 본문에서는 건너뛴다(중복 방지).
    if (요약줄요구인가(요구)) continue;
    const 매칭 = 입력매칭(inputs, 요구);
    if (매칭) {
      본문줄.push(`○ ${요구}\n   ${한줄로(매칭)}`);
    } else {
      본문줄.push(`○ ${요구}\n   ${입력필요표기(요구)}`);
      입력필요.push(입력필요표기(요구));
    }
  }
  const 본문 = 본문줄.join("\n\n");

  // ── 경고: 0점답변 + 정성적 표현 ──
  const 경고: string[] = [];
  for (const 사유 of detectZeroPoint(전체텍스트)) {
    경고.push(`0점 답변 위험: ${사유}`);
  }
  if (정성적표현_PATTERNS.some((re) => re.test(전체텍스트))) {
    경고.push(
      "정성적(비수치) 표현 감지: '매우/뛰어난/우수' 등 형용사 대신 가격·DB수·전력량 같은 수치로 비교하라."
    );
  }

  return {
    section: input.section,
    한글명: spec.한글명,
    요약,
    본문,
    입력필요,
    경고,
    추천도식: [...spec.필수도식] as ChartKind[],
    고지: 작성고지,
  };
}

/** 요구내용 문자열이 '상단 요약 2~3줄' 요구인지 판정. */
function 요약줄요구인가(요구: string): boolean {
  return /요약\s*2~3줄|핵심\s*요약/.test(요구);
}

/** inputs에서 키워드 부분일치로 값 조회(결정적, 첫 매칭 우선). */
function 찾기(inputs: Record<string, string>, 키워드: string): string | undefined {
  // 정확 키 우선
  if (inputs[키워드] && String(inputs[키워드]).trim()) return String(inputs[키워드]).trim();
  // 부분일치(키 또는 키워드가 서로 포함)
  for (const [k, v] of Object.entries(inputs)) {
    const val = String(v ?? "").trim();
    if (!val) continue;
    if (k.includes(키워드) || 키워드.includes(k)) return val;
  }
  return undefined;
}

/**
 * 요구내용(예 "① 국내 시장현황 (그래프 삽입)")에 대응하는 입력값 찾기.
 * 요구 문구에서 핵심 명사 토큰을 뽑아 inputs 키와 부분일치시킨다(사실 미조작·미생성).
 */
function 입력매칭(inputs: Record<string, string>, 요구: string): string | undefined {
  const 토큰 = 핵심토큰(요구);
  for (const t of 토큰) {
    const v = 찾기(inputs, t);
    if (v) return v;
  }
  return undefined;
}

/** 요구 문구에서 매칭에 쓸 핵심 토큰(2자 이상 한글/영문 덩어리) 추출. */
function 핵심토큰(요구: string): string[] {
  const cleaned = 요구
    .replace(/[①②③④⑤⑥⑦⑧⑨]/g, " ")
    .replace(/\([^)]*\)/g, " ") // 괄호 부연 제거
    .replace(/[·,/]/g, " ");
  const raw = cleaned.match(/[가-힣A-Za-z]{2,}/g) ?? [];
  // 너무 일반적인 불용어 제거
  const 불용어 = new Set(["삽입", "현황", "분석", "구성", "표", "그래프", "각", "및", "등"]);
  const 토큰 = raw.filter((w) => !불용어.has(w));
  return 토큰.length ? 토큰 : raw;
}

/** 여러 줄 입력을 한 줄 요약으로(앞 120자, 줄바꿈 공백 치환). */
function 한줄로(s: string): string {
  const one = String(s).replace(/\s+/g, " ").trim();
  return one.length > 120 ? one.slice(0, 117) + "…" : one;
}

// ── plan_review (체크리스트) ──

/**
 * ABSOLUTE_CHECKLIST 각 항목을 자동 판정(가능한 것만), 나머지는 '확인필요'.
 * 자동 판정:
 *  - 0점 답변 검출 → 해당 항목 미통과 + 치명경고
 *  - 정성적 표현 → 경쟁비교 항목 미통과
 *  - 요약줄(■) 유무 → 요약 항목 판정
 * 점수 = 통과 항목 비율(확인필요는 분모 포함하지 않고 통과/판정 기준으로 산정).
 */
export function reviewChecklist(input: {
  sections?: Record<string, string>;
  fullText?: string;
}): ChecklistResult {
  const text = 합치기(input);
  const zero = detectZeroPoint(text);
  const has정성 = 정성적표현_PATTERNS.some((re) => re.test(text));
  const has요약줄 = /■/.test(text);
  const has수치 = /\d/.test(text);

  const 항목: ChecklistItem[] = ABSOLUTE_CHECKLIST.map((c) => 판정항목(c, {
    text,
    zero,
    has정성,
    has요약줄,
    has수치,
  }));

  const 치명경고: string[] = [];
  for (const 사유 of zero) 치명경고.push(`0점 답변 위험: ${사유}`);

  // 점수 = '자동 확인된 통과 항목 / 전체 체크리스트 항목'.
  // 확인필요(사람이 직접 봐야 하는 항목)는 분모에 포함해 통과로 치지 않는다 →
  // 부실한 한 줄 본문이 100점으로 오인되지 않도록(자동 점검 통과 항목 수일 뿐, 합격 가능성 아님).
  const 통과수 = 항목.filter((i) => i.통과 === true).length;
  const 확인필요수 = 항목.filter((i) => i.통과 === "확인필요").length;
  const 점수 = Math.round((통과수 / 항목.length) * 100);

  return {
    점수,
    항목,
    치명경고,
    고지:
      `이 점수는 '자동 확인 통과 ${통과수}/${항목.length}개' 일 뿐 합격 가능성이 아닙니다. ` +
      `확인필요 ${확인필요수}건은 사람이 직접 점검해야 합니다(자동 판정 불가). ` +
      작성고지,
  };
}

function 합치기(input: { sections?: Record<string, string>; fullText?: string }): string {
  const parts: string[] = [];
  if (input.sections) {
    for (const v of Object.values(input.sections)) parts.push(String(v ?? ""));
  }
  if (input.fullText) parts.push(String(input.fullText));
  return parts.join(" \n");
}

/** 체크리스트 항목 1개를 자동 판정(불가하면 확인필요). */
function 판정항목(
  c: string,
  ctx: { text: string; zero: string[]; has정성: boolean; has요약줄: boolean; has수치: boolean }
): ChecklistItem {
  const { text, zero, has정성, has요약줄, has수치 } = ctx;
  const 비었음 = text.replace(/\s+/g, "").length === 0;

  // 0점 답변 항목
  if (/0점\s*답변|해자/.test(c)) {
    if (비었음) return { 항목: c, 통과: "확인필요", 근거: "본문 미입력 → 자동 판정 불가." };
    if (zero.length > 0) {
      return {
        항목: c,
        통과: false,
        근거: `0점 답변 패턴 감지(${zero.length}건): ${zero.join(" / ")}`,
      };
    }
    return { 항목: c, 통과: true, 근거: "0점 답변 패턴 미검출 → 통과(해자 서술 여부는 사람 확인 권장)." };
  }

  // 경쟁 비교 정성/수치 항목
  if (/정성적|수치/.test(c)) {
    if (비었음) return { 항목: c, 통과: "확인필요", 근거: "본문 미입력 → 자동 판정 불가." };
    if (has정성 && !has수치) {
      return { 항목: c, 통과: false, 근거: "정성적 표현 감지·수치 부재 → 미통과(가격·DB수 등 수치로 비교)." };
    }
    if (has정성 && has수치) {
      return { 항목: c, 통과: "확인필요", 근거: "정성 표현과 수치 혼재 → 경쟁비교 칸이 수치 기반인지 사람 확인." };
    }
    return { 항목: c, 통과: true, 근거: "정성적 형용사 미검출 → 통과(수치 기반으로 판단)." };
  }

  // 요약 2~3줄(■) 항목
  if (/요약|■|단락\s*상단/.test(c)) {
    if (비었음) return { 항목: c, 통과: "확인필요", 근거: "본문 미입력 → 자동 판정 불가." };
    return has요약줄
      ? { 항목: c, 통과: true, 근거: "단락 상단 핵심 요약(■) 기호 검출 → 통과." }
      : { 항목: c, 통과: false, 근거: "단락 상단 요약(■ 2~3줄) 미검출 → 미통과." };
  }

  // 나머지(정성 평가가 필요한 항목)는 확인필요
  return {
    항목: c,
    통과: "확인필요",
    근거: "자동 판정 불가 — 사람(또는 모의심사 도구)의 정성 검토가 필요한 항목.",
  };
}
