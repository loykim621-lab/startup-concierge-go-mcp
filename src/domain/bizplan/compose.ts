/**
 * 제출용 문서 조립 — composeApplication()
 * 공고/양식의 "칸(field)"들을 받아, 칸 유형별 작성 규칙(§9)으로 붙여넣기용 텍스트를 만든다.
 * assemble_plan(PSST 순서 재배열)과 달리, 이 모듈은 서식의 "원래 칸 순서"를 그대로 보존한다.
 *
 * 출처(프레임워크): 정부지원 사업계획서 표준 지식베이스(knowledge.ts) — 요약줄(■)·자금 단가×수량 분개·0점답변·정성표현.
 *
 * 결정성(최우선): Math.random 금지. 같은 입력 → 같은 출력.
 * 사실 무결성(최우선):
 * - 창업자가 제공하지 않은 사실(수치·실적·기관명)을 절대 지어내지 않는다.
 * - 답변이 없는 칸은 "[입력 필요: <칸이름>]"으로만 표시하고, 다음질문 배열에 그 칸 질문을 추가한다.
 * - 검증(0점답변·정성표현)은 새 판정 로직을 만들지 않고 knowledge.ts의 detectZeroPoint·isQualitative를 재사용한다.
 * - 자금표 합계는 자동 계산·검증하되, 숫자 파싱에 실패하면 지어내지 않고 "[확인 필요]"로 남긴다.
 */

import { detectZeroPoint, isQualitative } from "./knowledge.js";
import { 작성고지 } from "../disclaimer.js";

// ── 타입(이 모듈 계약) ──────────────────────────────────────────────────────

/** 칸(field) 유형 — 서식이 요구하는 작성 형태. 미지정 시 답변 유무로 서술 처리. */
export type 칸유형 = "표" | "서술" | "자금표" | "체크";

/** 입력 칸 1개 — 서식의 한 칸. 순서는 입력 배열 순서를 그대로 보존한다. */
export interface ComposeField {
  /** 서식에 표기된 칸 이름(예: "사업 아이템 개요", "자금 소요 및 조달계획"). */
  칸이름: string;
  /** 칸 유형(표/서술/자금표/체크). 없으면 서술로 처리. */
  유형?: 칸유형 | string;
  /** 이 칸이 매핑되는 PSST 키(참고용 메타 — 순서 재배열에는 쓰지 않는다). */
  psst매핑?: string;
  /** 창업자가 제공한 답변(사실). 없으면 [입력 필요]로 표시. */
  답변?: string;
}

export interface ComposeInput {
  /** 서식 칸 목록(원래 순서 보존). */
  fields: ComposeField[];
  /** 선택 공고 id(맥락 표기용 — 사실을 지어내지 않음). */
  grant_id?: string;
  /** 사업 아이템명(있으면 문서 상단 맥락에 표기). */
  사업아이템명?: string;
}

/** 조립된 문서 칸 1개의 결과. */
export interface ComposedField {
  칸이름: string;
  /** 작성 규칙으로 정돈된 내용(붙여넣기용). */
  내용: string;
  /** 상태: 완성(답변 정돈) / 입력필요(답변 없음) / 확인필요(파싱·검증 실패). */
  상태: "완성" | "입력필요" | "확인필요";
}

/** 자금표 검증 결과(자금표 칸이 하나라도 있을 때만 채워짐). */
export interface FundingVerification {
  /** 각 행 금액의 자동 합산(파싱 성공 행만). */
  합계: number;
  /** 답변에 표기된 합계(합계/총계 행에서 파싱된 값). 없으면 undefined. */
  표기합계?: number;
  /** 자동 합계와 표기 합계의 일치 여부. 표기합계가 없으면 undefined. */
  일치여부?: boolean;
}

export interface ComposeResult {
  /** 서식 순서를 보존한 칸별 결과. */
  문서칸: ComposedField[];
  /** 칸이름 헤더 + 내용을 이어붙인 전체 텍스트(붙여넣기용). */
  전체텍스트: string;
  /** 상태가 '입력필요'인 칸이름 목록. */
  미완성: string[];
  /** 0점답변·정성표현·파싱 실패 등 경고(재사용 판정 기반). */
  경고: string[];
  /** 답변 없는 칸에 대해 창업자에게 되물을 질문 목록. */
  다음질문: string[];
  /** 자금표 칸이 있을 때의 합계 검증(없으면 생략). */
  자금검증?: FundingVerification;
  /** 작성 고지(이 산출물의 효력 한계·사실 무결성). */
  고지: string;
}

// ── 헬퍼(결정적) ────────────────────────────────────────────────────────────

/** 답변이 실질 내용이 있는지(공백만이면 없음으로 간주). */
function hasAnswer(답변?: string): boolean {
  return !!답변 && 답변.trim().length > 0;
}

/** "[입력 필요: ___]" 표준 표기. */
function 입력필요표기(무엇: string): string {
  return `[입력 필요: ${무엇}]`;
}

/** 칸 유형 정규화(문자열 오타·미지정 방어). 미지정/미인식은 "서술". */
function 정규화유형(유형?: 칸유형 | string): 칸유형 {
  const t = (유형 ?? "").trim();
  if (t === "표" || t === "서술" || t === "자금표" || t === "체크") return t;
  return "서술";
}

/**
 * 숫자 파싱(결정적) — "600", "600만원", "1,200", "1.2억", "200만원" 등을 원 단위 정수로.
 * 파싱 불가 시 null(추측 금지). 단위 규칙:
 *  - "억" → ×100,000,000, "만" → ×10,000, "천" → ×1,000 (숫자 바로 뒤 단위만 반영)
 *  - 콤마·"원"·공백은 제거. 여러 숫자가 섞이면 첫 금액 토큰만 사용.
 */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const s = String(raw).replace(/,/g, "").trim();
  // 숫자(소수 허용) + 선택 단위(억/만/천) 패턴을 앞에서부터 하나 캡처.
  const m = s.match(/(\d+(?:\.\d+)?)\s*(억|만|천)?/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  if (!isFinite(base)) return null;
  const unit = m[2];
  let mult = 1;
  if (unit === "억") mult = 100_000_000;
  else if (unit === "만") mult = 10_000;
  else if (unit === "천") mult = 1_000;
  return Math.round(base * mult);
}

/** 금액 표기(원 단위 정수 → 읽기 쉬운 문자열). 결정적. */
function 금액표기(n: number): string {
  return `${n.toLocaleString("en-US")}원`;
}

// ── 칸 유형별 작성기(§9) ─────────────────────────────────────────────────────

/**
 * 서술 칸: 상단 ■ 요약 1~2줄 + 본문(답변 사실을 구조화 — draftSection 스타일).
 * 사실을 새로 만들지 않고, 답변 텍스트의 앞 문장을 요약으로, 나머지를 본문으로 재배치한다.
 */
function 작성_서술(답변: string): string {
  const 정돈 = 답변.replace(/\r\n/g, "\n").trim();
  // 문장 분리(마침표/줄바꿈 기준) — 앞 1~2문장을 ■ 요약으로.
  const 문장들 = 정돈
    .split(/\n+|(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (문장들.length === 0) return 정돈;

  const 요약수 = Math.min(2, 문장들.length);
  const 요약줄 = 문장들.slice(0, 요약수).map((s) => `■ ${s}`);
  const 본문문장 = 문장들.slice(요약수);

  const lines: string[] = [...요약줄];
  if (본문문장.length > 0) {
    lines.push(""); // 요약과 본문 사이 빈 줄
    for (const s of 본문문장) lines.push(s);
  }
  return lines.join("\n");
}

/**
 * 표 칸: 간결한 항목 값(답변 그대로 정돈). 여러 줄이면 항목별로 나눠 "- " 불릿으로.
 * 이미 "라벨: 값" 또는 "|" 구분 형태면 그 구조를 존중해 정돈만 한다.
 */
function 작성_표(답변: string): string {
  const 줄 = 답변
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (줄.length === 0) return 답변.trim();
  if (줄.length === 1) return 줄[0];
  return 줄.map((l) => (l.startsWith("-") ? l : `- ${l}`)).join("\n");
}

/**
 * 체크 칸: 자동으로 체크/서명할 수 없다 — 본인 확인이 필요한 항목임을 명시.
 * 답변이 있으면 그 값을 병기하되 항상 "[본인 확인 필요: 서명/체크]"를 남긴다.
 */
function 작성_체크(답변?: string): string {
  const 안내 = "[본인 확인 필요: 서명/체크]";
  if (hasAnswer(답변)) return `${답변!.trim()}\n${안내}`;
  return 안내;
}

/** 자금표 한 행의 파싱 결과. */
interface 자금행 {
  원문: string;
  비목?: string;
  산출근거?: string;
  금액?: number;
  /** 금액 파싱 실패 여부. */
  금액파싱실패: boolean;
  /** 합계/총계 표기 행 여부(자동 합산에서 제외). */
  합계행: boolean;
}

/** "합계"·"총계"·"소계" 등 합계 표기 행인지 판정. */
function is합계행(비목?: string): boolean {
  if (!비목) return false;
  return /합\s*계|총\s*계|소\s*계|합계|총계|total/i.test(비목);
}

/**
 * 자금표 답변을 행별로 파싱한다.
 * 각 행 형식: "비목|산출근거(단가×수량)|금액" (파이프 구분).
 * 파이프가 없으면 파싱 실패 행으로 표시(지어내지 않음).
 */
function parse자금표(답변: string): 자금행[] {
  const 줄 = 답변
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows: 자금행[] = [];
  for (const 원문 of 줄) {
    const parts = 원문.split("|").map((p) => p.trim());
    if (parts.length < 2) {
      // 파이프 구분이 없으면 이 행은 파싱 불가 — 확인 필요로 남긴다.
      rows.push({ 원문, 금액파싱실패: true, 합계행: false });
      continue;
    }
    const 비목 = parts[0];
    // 마지막 칸을 금액으로, 중간 칸(들)을 산출근거로 본다(비목|산출근거|금액 표준).
    const 금액원문 = parts[parts.length - 1];
    const 산출근거 = parts.slice(1, parts.length - 1).join(" | ") || undefined;
    const 금액 = parseAmount(금액원문);
    rows.push({
      원문,
      비목,
      산출근거,
      금액: 금액 ?? undefined,
      금액파싱실패: 금액 === null,
      합계행: is합계행(비목),
    });
  }
  return rows;
}

/**
 * 자금표 칸을 작성한다 — 행별 "비목 | 산출근거(단가×수량) | 금액" + 합계 자동 계산·검증.
 * 반환: { 내용, 상태, 검증 }.
 */
function 작성_자금표(답변: string): {
  내용: string;
  상태: ComposedField["상태"];
  검증: FundingVerification;
} {
  const rows = parse자금표(답변);
  const lines: string[] = [];

  let 자동합계 = 0;
  let 표기합계: number | undefined;
  let 파싱실패있음 = false;

  for (const r of rows) {
    if (r.금액파싱실패) 파싱실패있음 = true;

    if (r.합계행) {
      // 답변에 표기된 합계는 검증 대상으로만 쓰고 자동합계에는 더하지 않는다.
      if (r.금액 !== undefined) 표기합계 = r.금액;
      const 표시금액 = r.금액 !== undefined ? 금액표기(r.금액) : "[확인 필요: 합계 금액 파싱 실패]";
      lines.push(`${r.비목} | | ${표시금액}`);
      continue;
    }

    if (r.금액파싱실패 && !r.비목) {
      // 파이프 구분조차 없는 행 — 원문 보존 + 확인 필요 표시.
      lines.push(`${r.원문}  [확인 필요: '비목|산출근거|금액' 형식으로 입력]`);
      continue;
    }

    const 비목 = r.비목 ?? "[확인 필요: 비목]";
    const 산출근거 = r.산출근거 ?? "[확인 필요: 산출근거(단가×수량)]";
    if (r.금액 === undefined) {
      lines.push(`${비목} | ${산출근거} | [확인 필요: 금액 파싱 실패]`);
    } else {
      자동합계 += r.금액;
      lines.push(`${비목} | ${산출근거} | ${금액표기(r.금액)}`);
    }
  }

  // 합계 행 자동 추가(답변에 합계 행이 없을 때) — 자동 계산 결과를 명시.
  const 합계행존재 = rows.some((r) => r.합계행);
  if (!합계행존재) {
    lines.push(`합계(자동계산) | | ${금액표기(자동합계)}`);
  }

  const 검증: FundingVerification = { 합계: 자동합계 };
  if (표기합계 !== undefined) {
    검증.표기합계 = 표기합계;
    검증.일치여부 = 표기합계 === 자동합계;
  }

  // 상태: 파싱 실패가 있거나 표기합계 불일치면 확인필요, 아니면 완성.
  const 불일치 = 검증.일치여부 === false;
  const 상태: ComposedField["상태"] = 파싱실패있음 || 불일치 ? "확인필요" : "완성";

  return { 내용: lines.join("\n"), 상태, 검증 };
}

// ── 검증(재사용) ────────────────────────────────────────────────────────────

/**
 * 답변에 대한 경고를 knowledge.ts 판정 재사용으로 생성한다(새 판정 로직 금지).
 * - detectZeroPoint: 0점답변 패턴
 * - isQualitative: 정성적(비수치) 표현(값에 수치가 없고 형용사만)
 */
function 칸경고(칸이름: string, 답변: string): string[] {
  const out: string[] = [];
  for (const 사유 of detectZeroPoint(답변)) {
    out.push(`[${칸이름}] 0점 답변 위험: ${사유}`);
  }
  if (isQualitative(답변)) {
    out.push(
      `[${칸이름}] 정성적(비수치) 표현 감지: '매우/뛰어난/우수' 등 형용사 대신 가격·DB수·전력량 같은 수치로 쓰세요.`
    );
  }
  return out;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 서식 칸들을 유형별 작성 규칙으로 조립한다(원래 칸 순서 보존).
 *
 * 칸 유형(§9):
 *  - 표: 간결한 항목 값(답변 그대로 정돈).
 *  - 서술: 상단 ■ 요약 1~2줄 + 본문(사실 구조화).
 *  - 자금표: 행별 "비목|산출근거(단가×수량)|금액" 파싱 + 합계 자동 계산·검증.
 *  - 체크: "[본인 확인 필요: 서명/체크]".
 * 답변 없는 칸 → "[입력 필요: <칸이름>]" + 다음질문에 그 칸 질문 추가.
 */
export function composeApplication(input: ComposeInput): ComposeResult {
  const fields = input.fields ?? [];

  const 문서칸: ComposedField[] = [];
  const 미완성: string[] = [];
  const 경고: string[] = [];
  const 다음질문: string[] = [];
  let 자금검증: FundingVerification | undefined;

  for (const field of fields) {
    const 칸이름 = field.칸이름;
    const 유형 = 정규화유형(field.유형);
    const 답변 = field.답변;

    // ── 답변 없음 → 입력 필요 ──
    if (!hasAnswer(답변) && 유형 !== "체크") {
      문서칸.push({ 칸이름, 내용: 입력필요표기(칸이름), 상태: "입력필요" });
      미완성.push(칸이름);
      다음질문.push(`'${칸이름}' 칸에 들어갈 내용을 알려주세요.`);
      continue;
    }

    // ── 유형별 작성 ──
    if (유형 === "자금표") {
      const { 내용, 상태, 검증 } = 작성_자금표(답변!);
      문서칸.push({ 칸이름, 내용, 상태 });
      // 자금표가 여러 칸이면 마지막 자금표의 검증을 대표로 두되, 각 칸 상태는 개별 반영됨.
      자금검증 = 검증;
      경고.push(...칸경고(칸이름, 답변!));
      if (검증.일치여부 === false) {
        경고.push(
          `[${칸이름}] 자금 합계 불일치: 자동합계 ${금액표기(검증.합계)} ≠ 표기합계 ${금액표기(검증.표기합계 ?? 0)} — 단가×수량 분개와 합계를 다시 맞추세요.`
        );
      }
      continue;
    }

    if (유형 === "체크") {
      const 내용 = 작성_체크(답변);
      // 체크 칸은 자동 완성 불가 — 항상 '확인필요'.
      문서칸.push({ 칸이름, 내용, 상태: "확인필요" });
      continue;
    }

    if (유형 === "표") {
      const 내용 = 작성_표(답변!);
      문서칸.push({ 칸이름, 내용, 상태: "완성" });
      경고.push(...칸경고(칸이름, 답변!));
      continue;
    }

    // 기본: 서술
    const 내용 = 작성_서술(답변!);
    문서칸.push({ 칸이름, 내용, 상태: "완성" });
    경고.push(...칸경고(칸이름, 답변!));
  }

  // ── 전체 텍스트(칸이름 헤더 + 내용 이어붙임, 서식 순서 보존) ──
  const 전체텍스트 = 문서칸
    .map((c) => `## ${c.칸이름}\n${c.내용}`)
    .join("\n\n");

  const result: ComposeResult = {
    문서칸,
    전체텍스트,
    미완성,
    경고,
    다음질문,
    고지: 작성고지,
  };
  if (자금검증) result.자금검증 = 자금검증;
  return result;
}
