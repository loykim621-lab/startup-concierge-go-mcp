/**
 * 전체 사업계획서 합본 — assemblePlan()
 * PSST 4섹션 초안(P·S1·S2·T)과 도식(charts)을 "정부 양식 순서"로 한 편의
 * 마크다운 사업계획서로 합치고, 합쳐진 본문에 대해 체크리스트 점검·분량 진단을 수행한다.
 *
 * 출처(프레임워크): 정부지원 사업계획서 표준 지식베이스(knowledge.ts) — PSST 골격·요약줄(■)·도식.
 *
 * 결정성: Math.random 금지. 같은 입력 → 같은 출력.
 * 사실 무결성(최우선):
 * - 창업자가 제공하지 않은 사실(수치·실적·기관명)을 절대 지어내지 않는다.
 * - 섹션 텍스트가 비면 "[입력 필요: __ 섹션 작성]"으로 표시할 뿐, 임의로 채우지 않는다.
 * - charts는 "도식 자리 안내([도식: kind])"만 삽입하며, 없는 데이터로 도식을 만들지 않는다.
 */

import type { ChecklistResult, HwpLayoutResult, PsstKey } from "./types.js";
import { PSST_SECTIONS, CHART_CATALOG } from "./knowledge.js";
import { reviewChecklist } from "./psst.js";
import { buildHwpLayout } from "./hwp.js";
import { 작성고지 } from "../disclaimer.js";

// ── 타입(이 모듈 계약) ──────────────────────────────────────────────────────

/** 합본 입력으로 받는 차트(도식) 안내. svg는 선택(있으면 분량 추정에 글자수만 반영하지 않음). */
export interface AssembleChart {
  /** 도식 종류(예: "funnel", "gantt"). knowledge.ts CHART_CATALOG의 kind 문자열 권장. */
  kind: string;
  /** 렌더된 SVG(있으면). 합본 본문에는 자리 안내만 넣고 SVG 원문은 넣지 않는다. */
  svg?: string;
}

export interface AssembleInput {
  /** 선택 공고 id(표지/제목 맥락 표기에만 사용 — 사실을 지어내지 않음). */
  grant_id?: string;
  /** PSST 4섹션 본문(창업자 입력 또는 draft_section 결과 텍스트). 없으면 [입력 필요]. */
  sections: {
    P?: string;
    S1?: string;
    S2?: string;
    T?: string;
  };
  /** 목표 분량(페이지). 미입력 시 buildHwpLayout 기본값(10p) 사용. */
  목표페이지?: number;
  /** 합본에 배치할 도식 안내 목록. 종류에 맞는 섹션에 "[도식: kind]"로 삽입. */
  charts?: AssembleChart[];
}

export interface AssembleResult {
  /** 정부 양식 순서로 조립된 전체 사업계획서(마크다운). */
  문서: string;
  /** 합쳐진 본문 전체에 대한 절대 체크리스트 점검(0점답변·정성표현 등). */
  점검: ChecklistResult;
  /** 목표페이지 대비 분량 진단(초과/부족/적정 + 조정 제안). */
  분량: HwpLayoutResult;
  /** 본문에서 수집한 "[입력 필요: ...]" 항목 목록(사실 무결성 추적). */
  입력필요: string[];
  /** 작성 고지(이 산출물의 효력 한계). */
  고지: string;
}

// ── 양식 메타(정부 사업계획서 표준 순서) ────────────────────────────────────

/** PSST 키 → 합본에서의 (번호, 제목) — 정부 양식 본문 순서. */
const 섹션순서: { key: PsstKey; 번호: number; 제목: string }[] = [
  { key: "P", 번호: 1, 제목: "문제인식 (Problem)" },
  { key: "S1", 번호: 2, 제목: "실현가능성 (Solution)" },
  { key: "S2", 번호: 3, 제목: "성장전략 (Scale-up)" },
  { key: "T", 번호: 4, 제목: "팀 구성 (Team)" },
];

/** PsstKey → 한글명(knowledge.ts 스펙 우선, 없으면 양식 메타 제목). */
function 섹션한글명(key: PsstKey): string {
  const spec = PSST_SECTIONS.find((s) => s.key === key);
  if (spec) return spec.한글명;
  return 섹션순서.find((s) => s.key === key)?.제목 ?? String(key);
}

// ── 도식 배치(결정적) ────────────────────────────────────────────────────────

/**
 * 차트 kind를 PSST 섹션 키로 매핑한다(결정적).
 * 기준: knowledge.ts CHART_CATALOG의 '섹션' 문자열(예 "S1 실현가능성")의 첫 토큰.
 * - 여러 섹션에 걸치면(예 "P/S2") 첫 번째 섹션에 배치.
 * - 카탈로그에 없는 kind는 매핑 불가 → undefined(특정 섹션에 강제로 넣지 않음).
 */
function 차트섹션(kind: string): PsstKey | undefined {
  const cat = CHART_CATALOG.find((c) => c.kind === kind);
  if (!cat) return undefined;
  // "S1 실현가능성" 또는 "P/S2" → 첫 섹션 토큰만 사용
  const first = cat.섹션.split(/[\s/]/)[0]?.trim();
  if (first === "P" || first === "S1" || first === "S2" || first === "T") {
    return first as PsstKey;
  }
  return undefined;
}

/**
 * charts를 섹션별로 그룹핑한다(입력 순서 보존 → 결정적).
 * 카탈로그에 없어 매핑 불가한 kind는 '미배치'로 모은다(끝의 '도식 자료' 절에 안내).
 */
function 도식그룹핑(charts: AssembleChart[]): {
  섹션별: Record<PsstKey, AssembleChart[]>;
  미배치: AssembleChart[];
} {
  const 섹션별: Record<PsstKey, AssembleChart[]> = { P: [], S1: [], S2: [], T: [] };
  const 미배치: AssembleChart[] = [];
  for (const ch of charts) {
    const sec = 차트섹션(ch.kind);
    if (sec) 섹션별[sec].push(ch);
    else 미배치.push(ch);
  }
  return { 섹션별, 미배치 };
}

/** 도식 자리 안내 한 줄. svg 유무를 명시(사실 무결성 — 실제 렌더 여부를 숨기지 않음). */
function 도식안내(ch: AssembleChart): string {
  const 렌더 = ch.svg && ch.svg.trim() ? "(도식 렌더됨 — 제출본에 삽입)" : "(도식 미렌더 — 데이터 입력 후 삽입 필요)";
  return `[도식: ${ch.kind}] ${렌더}`;
}

// ── 요약(개요) 발췌 — 사실 미조작 ────────────────────────────────────────────

/**
 * 섹션 텍스트의 첫 2~3줄을 발췌해 개요(요약)로 쓴다.
 * - 빈 줄·도식 안내([도식:)·요약 기호(■)는 건너뛰고 의미 있는 문장만.
 * - 사실을 새로 만들지 않고 '입력 텍스트의 앞부분'만 그대로 가져온다.
 */
function 발췌요약(text: string | undefined, 최대줄: number): string[] {
  if (!text || !text.trim()) return [];
  const 줄 = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s■○●•\-*]+/, "").trim()) // 선두 불릿/요약기호 제거
    .filter((l) => l.length > 0 && !l.startsWith("[도식:") && !l.startsWith("[입력 필요"));
  return 줄.slice(0, 최대줄);
}

// ── 본문 조립 ────────────────────────────────────────────────────────────────

/**
 * 한 섹션 블록(제목 + 본문 + 도식 자리)을 마크다운으로 만든다.
 * 텍스트가 없으면 "[입력 필요: __ 섹션 작성]"을 본문으로 넣는다(지어내지 않음).
 */
function 섹션블록(
  번호: number,
  제목: string,
  key: PsstKey,
  text: string | undefined,
  charts: AssembleChart[]
): string {
  const 한글명 = 섹션한글명(key);
  const lines: string[] = [];
  lines.push(`## ${번호}. ${제목}`);
  lines.push("");

  if (text && text.trim()) {
    lines.push(text.trim());
  } else {
    // 사실 무결성: 비면 입력필요 표기만. (이 표기는 결과의 입력필요 배열로도 수집된다.)
    lines.push(`[입력 필요: ${한글명} 섹션 작성]`);
  }

  if (charts.length > 0) {
    lines.push("");
    lines.push("**도식**");
    for (const ch of charts) lines.push(`- ${도식안내(ch)}`);
  }

  return lines.join("\n");
}

/** 표지/일반현황 안내 블록(양식 첫 장 — 창업자 사실은 입력필요로). */
function 표지블록(grant_id?: string): string {
  const lines: string[] = [];
  lines.push("# 사업계획서");
  lines.push("");
  lines.push("## 0. 일반현황 (표지)");
  lines.push("");
  if (grant_id) {
    lines.push(`- 지원 공고: ${grant_id}`);
  } else {
    lines.push(`- 지원 공고: [입력 필요: 지원할 공고 선택/입력]`);
  }
  lines.push(`- 사업 아이템명: [입력 필요: "OO기술이 적용된 OO기능의 OO제품·서비스" 형식]`);
  lines.push(`- 대표자/기업명: [입력 필요: 대표자명·기업명(예비창업자는 예정)]`);
  lines.push(`- 신청 유형/업력: [입력 필요: 공고 자격요건에 맞는 신청 유형·업력]`);
  lines.push("");
  lines.push(
    "> 표지·일반현황의 인적사항은 공고 양식(HWP)의 표 칸에 직접 기입하세요. " +
      "본 합본은 본문(PSST) 조립과 점검을 돕습니다."
  );
  return lines.join("\n");
}

/** 개요(요약) 블록 — 각 섹션 첫 2~3줄 발췌. 발췌 불가 섹션은 입력필요로. */
function 개요블록(sections: AssembleInput["sections"]): string {
  const lines: string[] = [];
  lines.push("## 개요 (요약)");
  lines.push("");
  for (const { key, 번호, 제목 } of 섹션순서) {
    const 한글명 = 섹션한글명(key);
    const 요약 = 발췌요약(sections[key], 3);
    lines.push(`**${번호}. ${제목}**`);
    if (요약.length > 0) {
      for (const l of 요약) lines.push(`- ${l}`);
    } else {
      lines.push(`- [입력 필요: ${한글명} 요약(섹션 본문 작성 시 자동 발췌)]`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ── 입력필요 수집 ────────────────────────────────────────────────────────────

/**
 * 조립된 문서 전체에서 "[입력 필요: ...]" 패턴을 모두 수집한다(중복 제거·순서 보존).
 * 사실 무결성: 무엇이 비었는지 사용자가 한눈에 보도록.
 */
function 입력필요수집(문서: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // 대괄호 안 "입력 필요: ..." (닫는 대괄호 전까지). 한 줄 내로 가정.
  const re = /\[입력 필요:[^\]\n]*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(문서)) !== null) {
    const 항목 = m[0];
    if (!seen.has(항목)) {
      seen.add(항목);
      out.push(항목);
    }
  }
  return out;
}

// ── 본문 글자수(분량 진단용) ─────────────────────────────────────────────────

/**
 * 분량 진단에 쓸 '본문 글자수'를 센다.
 * - 마크다운 구조 문자(#, *, -, >, |)와 공백은 제외해 실제 서술 분량에 가깝게.
 * - 입력필요/도식 안내 줄은 제외(실제 작성된 내용이 아니므로 분량으로 치지 않음).
 *   → 입력필요만 가득한 빈 합본이 분량 충분으로 오판되지 않도록.
 */
function 본문글자수(sections: AssembleInput["sections"], _charts: AssembleChart[]): number {
  let total = 0;
  for (const { key } of 섹션순서) {
    const text = sections[key];
    if (!text) continue;
    const 유효 = text
      .split(/\r?\n/)
      .filter((l) => {
        const t = l.trim();
        return t.length > 0 && !t.startsWith("[도식:") && !t.startsWith("[입력 필요");
      })
      .join("");
    // 마크다운/공백 제거 후 글자수
    total += 유효.replace(/[#*\->|`■○●•\s]/g, "").length;
  }
  return total;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * PSST 섹션·도식을 정부 양식 순서로 합본하고, 점검·분량 진단·입력필요를 산출한다.
 *
 * 양식 순서:
 *   (표지/일반현황 안내) → 개요(요약) → 1.문제인식 → 2.실현가능성 → 3.성장전략 → 4.팀구성
 *   → (미배치 도식 안내, 있을 때만)
 */
export function assemblePlan(input: AssembleInput): AssembleResult {
  const sections = input.sections ?? {};
  const charts = input.charts ?? [];
  const { 섹션별: 도식섹션별, 미배치: 도식미배치 } = 도식그룹핑(charts);

  // ── 문서 조립 ──
  const blocks: string[] = [];
  blocks.push(표지블록(input.grant_id));
  blocks.push(개요블록(sections));

  for (const { key, 번호, 제목 } of 섹션순서) {
    blocks.push(섹션블록(번호, 제목, key, sections[key], 도식섹션별[key]));
  }

  // 카탈로그에 없어 섹션 매핑이 안 된 도식은 끝에 '추가 도식 자료'로 안내(누락 방지).
  if (도식미배치.length > 0) {
    const lines: string[] = [];
    lines.push("## 부록. 추가 도식 자료 (섹션 자동배치 불가)");
    lines.push("");
    for (const ch of 도식미배치) lines.push(`- ${도식안내(ch)}`);
    blocks.push(lines.join("\n"));
  }

  const 문서 = blocks.join("\n\n");

  // ── 점검(체크리스트) — 합쳐진 본문 전체에 대해 ──
  // 입력필요/도식 안내 줄까지 포함된 '문서'를 넘기되, 0점답변·정성표현은 작성된 본문에서만
  // 의미 있게 검출되므로 그대로 전달한다(reviewChecklist가 결정적으로 판정).
  const 점검 = reviewChecklist({ fullText: 문서 });

  // ── 분량 진단 — 목표페이지 대비 ──
  const 현재글자수 = 본문글자수(sections, charts);
  const 분량 = buildHwpLayout({
    목표페이지: input.목표페이지,
    현재글자수,
  });

  // ── 입력필요 수집(문서 전체에서) ──
  const 입력필요 = 입력필요수집(문서);

  return {
    문서,
    점검,
    분량,
    입력필요,
    고지: 작성고지,
  };
}
