/**
 * 최소 필요 정보 질문 목록 — requiredInputs()
 * 출처: 정부지원 사업계획서 표준 프레임워크(knowledge.ts PSST_SECTIONS.요구내용) + 공고 스토어(store.ts).
 *
 * 역할:
 *  - 사업계획서를 쓰기 위해 창업자에게 "꼭 받아야 하는 사실 항목"을 PSST 섹션별 질문으로 변환한다.
 *  - 선택한 공고(grant_id)가 있으면 공고별 유의 질문(업력요건 적격성·마감일 역산)을 덧붙인다.
 *  - 사용자가 이미 준 정보(provided)에 해당 키워드가 있으면 상태를 '제공됨'으로 표시한다.
 *
 * 불변 원칙:
 *  - 사실 무결성: 이 엔진은 "질문만" 만든다. 창업자의 답(수치·실적·기관명)을 절대 지어내지 않는다.
 *  - 결정성: Math.random 금지. 같은 입력 → 같은 출력(질문 순서·우선질문 동일).
 */
import type { PsstKey } from "./types.js";
import { PSST_SECTIONS } from "./knowledge.js";
import { getGrant } from "../../data/store.js";
import { 작성고지 } from "../disclaimer.js";

// ── 타입(이 파일 안에서 정의) ──

/** 질문 상태: 사용자가 이미 줬으면 '제공됨', 아직이면 '필요'. */
export type 질문상태 = "필요" | "제공됨";

/** 질문 1개 — 어느 섹션의 어떤 사실을 왜 묻는가 + 현재 상태. */
export interface RequiredQuestion {
  /** PSST 섹션 키(P·S1·S2·T) — 공고별 유의 질문도 가장 관련 깊은 섹션에 귀속. */
  섹션: PsstKey;
  /** 창업자에게 던지는 질문(사실을 요구; 답을 지어내지 않음). */
  질문: string;
  /** 왜 이 질문이 필요한가(강의 원칙·평가 관점). */
  이유: string;
  /** provided 매칭 결과: '제공됨' 또는 '필요'. */
  상태: 질문상태;
}

export interface RequiredInputsResult {
  /** 조회된 공고 id(있을 때만). */
  grant_id?: string;
  /** 섹션별 질문 목록(P→S1→S2→T 순, 공고별 유의 질문은 해당 섹션 뒤에 추가). */
  질문목록: RequiredQuestion[];
  /** 가장 먼저 받아야 할 핵심 질문(미제공 우선, 5개 내외). */
  우선질문: string[];
  /** 작성 고지(참고용·사실무결성). */
  고지: string;
}

export interface RequiredInputsInput {
  /** 선택한 공고 id(없어도 동작 — 표준 PSST 질문만 생성). */
  grant_id?: string;
  /** 사용자가 이미 제공한 정보(키:값). 키 또는 값에 키워드가 있으면 '제공됨'으로 판정. */
  provided?: Record<string, string>;
}

// ── 질문 카탈로그(섹션별, 강의 요구내용에서 도출한 '필수 사실') ──

/**
 * 각 PSST 섹션에서 '사업계획서에 꼭 들어가야 하는 사실 항목'을 질문으로 인코딩.
 * 강의 PSST_SECTIONS.요구내용을 사람이 답할 수 있는 형태로 변환한 결과(결정적 상수).
 * matchKeywords: provided의 키/값에서 이 사실이 이미 제공됐는지 판정할 부분일치 키워드.
 * priority: 우선질문 후보(낮을수록 먼저). undefined면 우선질문에서 제외.
 */
interface QuestionSpec {
  섹션: PsstKey;
  질문: string;
  이유: string;
  matchKeywords: string[];
  priority?: number;
}

/**
 * 강의 PSST_SECTIONS가 정의한 4섹션(P·S1·S2·T) 키 집합.
 * 질문카탈로그가 이 4섹션을 모두 덮는지 검증해, '강의 요구내용에서 도출'을 사실로 보장한다.
 */
const PSST_KEYS: PsstKey[] = PSST_SECTIONS.map((s) => s.key);

const 질문카탈로그: QuestionSpec[] = [
  // ── P 문제인식 ──
  {
    섹션: "P",
    질문: "어떤 문제(고객의 불편·결핍)를 해결하나요? 누가, 얼마나 자주 겪는지 수치로 알려주세요.",
    이유: "문제인식에서 '아~~~' 공감을 끌어내려면 문제의 깊은 이해를 수치·근거로 보여야 한다(0점 답변 금지).",
    matchKeywords: ["문제", "불편", "필요성", "페인", "pain"],
    priority: 1,
  },
  {
    섹션: "P",
    질문: "국내·해외 시장현황 수치(시장규모·성장률·이용자 수 등)와 그 출처는 무엇인가요?",
    이유: "P섹션은 국내/해외 시장현황 그래프가 필수다. 수치와 출처가 있어야 막대그래프로 시각화할 수 있다.",
    matchKeywords: ["시장현황", "시장규모", "성장률", "시장", "통계", "출처"],
    priority: 2,
  },
  {
    섹션: "P",
    질문: "해결하려는 아이템(제품·서비스)을 한 줄로 소개하면? '기술+기능+혜택'이 드러나게요.",
    이유: "아이템명은 'OO기술이 적용된 OO기능의 OO제품·서비스' 형식으로 한 줄에 담아야 한다.",
    matchKeywords: ["아이템", "제품", "서비스", "아이템소개", "솔루션"],
  },
  // ── S1 실현가능성 ──
  {
    섹션: "S1",
    질문: "지금까지의 사업화 사전준비(인력·외주 확보, MVP 제작, DB 확보)를 시점·수량으로 알려주세요.",
    이유: "사전준비를 '시점·수량'으로 구체화해야 '이 사람이라서 되겠다'가 증명된다(예시의 '예정'을 '완료'로).",
    matchKeywords: ["사전준비", "MVP", "인력", "외주", "DB", "데이터확보"],
    priority: 3,
  },
  {
    섹션: "S1",
    질문: "협약기간 내 개발계획을 월별로 알려주세요(직접개발/신규채용/외주용역 행으로 나눠서).",
    이유: "S1은 월별 간트형 일정표가 필수다. 협약기간 내 무엇을 어떻게 할지가 실현가능성의 핵심.",
    matchKeywords: ["개발계획", "일정", "간트", "협약기간", "로드맵월별"],
  },
  {
    섹션: "S1",
    질문: "경쟁사를 가격·DB수·전력량 등 '수치'로 비교하면? (정성적 표현 말고 숫자로)",
    이유: "경쟁 비교는 '매우/뛰어난' 같은 정성적 표현이 아니라 수치여야 한다(레이더 차트 입력).",
    matchKeywords: ["경쟁사", "경쟁", "비교", "경쟁우위", "차별성"],
    priority: 4,
  },
  {
    섹션: "S1",
    질문: "자금집행계획을 '비목/산출근거/금액'으로 알려주세요. 각 항목은 단가×수량으로요.",
    이유: "자금은 단가×수량으로 분개하고 합계(SUM)가 정확히 맞아야 한다(정부지원 사업계획서 작성 표준).",
    matchKeywords: ["자금", "예산", "사업비", "단가", "수량", "집행"],
    priority: 5,
  },
  // ── S2 성장전략 ──
  {
    섹션: "S2",
    질문: "비즈니스 모델(누가→무엇을 주고받고→돈이 어디로)을 등장인물 3~4개로 설명하면?",
    이유: "S2는 BMC보다 흐름도가 강력하다. 등장인물 3~4개, 가치·돈 2종류 화살표로 단순하게.",
    matchKeywords: ["비즈니스모델", "BM", "수익모델", "흐름도", "수익구조"],
  },
  {
    섹션: "S2",
    질문: "시장진입전략과 Phase별 매출 계획(목표 매출·시점)을 알려주세요.",
    이유: "매출은 퍼널(노출→유입→가입→활동→결제) 근거로, Phase별 매출 로드맵 그래프로 제시한다.",
    matchKeywords: ["매출", "시장진입", "성장전략", "phase", "매출계획", "진입전략"],
  },
  {
    섹션: "S2",
    질문: "포지셔닝(2개 축 기준 경쟁사 위치와 자사의 현재→목표 이동)을 어떻게 설명하나요?",
    이유: "포지셔닝 맵(축 2개 + 경쟁사 점 + 이동 화살표)으로 경쟁우위를 시각화한다.",
    matchKeywords: ["포지셔닝", "경쟁우위", "차별화", "positioning"],
  },
  // ── T 팀 구성 ──
  {
    섹션: "T",
    질문: "대표자의 동종업계 경력(전공·전문분야·재직 이력)을 구체적으로 알려주세요.",
    이유: "모든 강점의 뿌리는 '조직(동종업계 경력+사전준비)'이다. '이 사람이라서 되겠다'의 핵심 증거.",
    matchKeywords: ["대표경력", "동종업계", "대표", "경력", "전공", "전문분야"],
    priority: 6,
  },
  {
    섹션: "T",
    질문: "팀 구성(인력별 전공·전문분야·경력)과 이미 가진 협력기관·네트워크(컨택포인트)는?",
    이유: "조직 역량과 복제 불가한 네트워크(공급자 선점·신뢰)는 해자(moat)의 증거다.",
    matchKeywords: ["팀구성", "조직", "인력", "협력기관", "네트워크", "파트너"],
  },
];

// ── 헬퍼(결정적) ──

/**
 * provided(키:값)에 키워드 중 하나라도 의미 있는 값으로 들어있으면 '제공됨'.
 * 키 또는 값에 키워드가 부분일치하고, 그 값이 공백이 아니어야 '제공됨'으로 본다.
 * (빈 값/공백만 있는 항목은 '필요'로 둬서 사실을 지어내지 않는다.)
 */
function isProvided(
  provided: Record<string, string> | undefined,
  keywords: string[]
): boolean {
  if (!provided) return false;
  for (const [k, v] of Object.entries(provided)) {
    const val = String(v ?? "").trim();
    if (!val) continue; // 값이 비면 제공으로 보지 않음
    const keyLower = String(k).toLowerCase();
    const valLower = val.toLowerCase();
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      // 키가 키워드를 포함(예: provided["대표경력"]) 또는 키워드가 키를 포함,
      // 또는 값 텍스트에 키워드가 등장하면 제공된 것으로 판정.
      if (
        keyLower.includes(kwLower) ||
        kwLower.includes(keyLower) ||
        valLower.includes(kwLower)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * "10년미만" 같은 업력요건 원문에서 가장 관대한(가장 큰) 허용 연수를 뽑는다.
 * 결정적 파서 — 매칭 실패 시 null(추측 금지).
 */
function 최대허용연수(업력요건?: string): number | null {
  if (!업력요건) return null;
  const matches = [...업력요건.matchAll(/(\d+)\s*년/g)].map((m) => parseInt(m[1], 10));
  if (matches.length === 0) return null;
  return Math.max(...matches);
}

/**
 * grant_id로 공고를 조회해 공고별 유의 질문을 생성(없으면 빈 배열).
 * 사실 무결성: 공고에 실제로 있는 값(업력요건·마감일)만 근거로 질문을 만든다.
 */
function 공고별질문(
  grant_id: string | undefined
): { grantId?: string; questions: QuestionSpec[] } {
  if (!grant_id) return { questions: [] };
  const grant = getGrant(grant_id);
  if (!grant) {
    // 사실 무결성: 없는 공고를 지어내지 않는다 — 조회 실패를 질문으로 안내.
    return {
      questions: [
        {
          섹션: "S1",
          질문: `선택한 공고(id=${grant_id})를 스토어에서 찾지 못했습니다. 공고명·마감일·업력요건을 직접 알려주시면 맞춤 질문을 드립니다.`,
          이유: "공고를 확인할 수 없어 공고별 유의사항(업력 적격성·마감일 역산)을 자동 생성할 수 없습니다.",
          matchKeywords: ["공고", "공고명", "마감일", "업력요건"],
        },
      ],
    };
  }

  const questions: QuestionSpec[] = [];

  // 업력요건 → 적격성 확인 질문(S1: 사전준비 적격성과 직결)
  if (grant.업력요건) {
    const 연수 = 최대허용연수(grant.업력요건);
    const 범위문구 = 연수 !== null ? `(공고 허용 최대 약 ${연수}년)` : "";
    questions.push({
      섹션: "S1",
      질문: `이 공고 업력요건은 '${grant.업력요건}'${범위문구}입니다. 개업일(또는 예비창업 여부)을 알려주시면 적격 여부를 확인합니다.`,
      이유: "업력요건은 1차 자격 게이트입니다. 개업일이 있어야 적격성을 정확히 판정할 수 있습니다(추측 금지).",
      matchKeywords: ["개업일", "업력", "예비창업", "법인성립일", "개업"],
    });
  }

  // 마감일 → 역산 일정 질문(S1: 협약기간 내 개발계획 역산)
  if (grant.마감일) {
    questions.push({
      섹션: "S1",
      질문: `이 공고 마감일은 ${grant.마감일}입니다. 마감 전 제출 가능하도록 협약기간 내 개발계획(간트)을 역산해 월별로 정리해 주세요.`,
      이유: "마감일 기준으로 일정을 역산해야 실현가능성(협약기간 내 수행)이 설득력을 가집니다.",
      matchKeywords: ["일정", "마감", "간트", "개발계획", "협약기간"],
    });
  }

  return { grantId: grant.id, questions };
}

// ── 메인 ──

/**
 * 최소 필요 정보 질문 목록을 생성한다.
 * - 표준 PSST 질문(질문카탈로그) + 공고별 유의 질문을 섹션 순서(P→S1→S2→T)로 정렬.
 * - provided에 키워드가 있으면 상태='제공됨', 없으면 '필요'.
 * - 우선질문: priority가 부여된 핵심 질문 중 '필요' 상태를 우선, 부족하면 '제공됨'으로 채워 최대 5개.
 */
export function requiredInputs(input: RequiredInputsInput = {}): RequiredInputsResult {
  const provided = input.provided;

  // 1) 공고별 질문 먼저 만들어 grantId 확정(조회 실패해도 동작).
  const { grantId, questions: grantSpecs } = 공고별질문(input.grant_id);

  // 2) 표준 + 공고별 질문 스펙을 합치되, priority를 보존하기 위해 표준 우선.
  const allSpecs: QuestionSpec[] = [...질문카탈로그, ...grantSpecs];

  // 3) 섹션 순서(P→S1→S2→T) + 같은 섹션 내 원래 등록 순서를 유지하며 정렬.
  const 섹션순서: Record<PsstKey, number> = { P: 0, S1: 1, S2: 2, T: 3 };
  const indexed = allSpecs.map((spec, i) => ({ spec, i }));
  indexed.sort((a, b) => {
    const so = 섹션순서[a.spec.섹션] - 섹션순서[b.spec.섹션];
    if (so !== 0) return so;
    return a.i - b.i; // 안정 정렬(등록 순서 유지) — 결정성 보장
  });

  // 4) 각 스펙을 상태 평가해 질문 객체로 변환.
  const 질문목록: RequiredQuestion[] = indexed.map(({ spec }) => ({
    섹션: spec.섹션,
    질문: spec.질문,
    이유: spec.이유,
    상태: isProvided(provided, spec.matchKeywords) ? "제공됨" : "필요",
  }));

  // 4-1) 강의 충실성 보장: 질문카탈로그가 PSST_SECTIONS의 4섹션을 모두 덮는지 확인(결정적).
  // 누락된 섹션이 있으면 '확인 불가' 안내 질문을 추가해, 사실을 누락한 채 끝내지 않는다.
  const 덮인섹션 = new Set<PsstKey>(질문카탈로그.map((s) => s.섹션));
  for (const key of PSST_KEYS) {
    if (!덮인섹션.has(key)) {
      const spec = PSST_SECTIONS.find((s) => s.key === key);
      질문목록.push({
        섹션: key,
        질문: `${spec?.한글명 ?? key} 섹션의 필수 정보가 질문 카탈로그에서 확인되지 않습니다 — 운영기관 양식을 확인하세요.`,
        이유: "표준 PSST 4섹션 중 이 섹션 질문이 누락되어 자동 생성하지 못함(확인 불가).",
        상태: "필요",
      });
    }
  }

  // 5) 우선질문: priority 오름차순. '필요' 상태를 먼저, 그래도 5개 미만이면 '제공됨'으로 보충.
  const 우선후보 = allSpecs
    .filter((s) => s.priority !== undefined)
    .map((s) => ({
      질문: s.질문,
      priority: s.priority as number,
      제공됨: isProvided(provided, s.matchKeywords),
    }))
    .sort((a, b) => a.priority - b.priority); // 결정적

  const 미제공 = 우선후보.filter((q) => !q.제공됨).map((q) => q.질문);
  const 제공됨목록 = 우선후보.filter((q) => q.제공됨).map((q) => q.질문);
  const 우선질문 = [...미제공, ...제공됨목록].slice(0, 5);

  const result: RequiredInputsResult = {
    질문목록,
    우선질문,
    고지: 작성고지,
  };
  if (grantId) result.grant_id = grantId;
  return result;
}
