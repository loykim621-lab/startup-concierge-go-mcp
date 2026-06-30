/**
 * 출력 포매터 — 카카오톡 자연어 응답에 맞춘 한국어 텍스트 렌더링.
 * 모든 공고·자격·점수 출력에 출처·기준시점·고지를 일관 표기(사실 무결성).
 */
import type { GrantRecord } from "../data/types.js";
import type { EligibilityResult, ScoreResult } from "../domain/types.js";
import type { WinStrategy } from "../domain/strategy.js";
import { 출처표기 } from "../domain/disclaimer.js";

export function dday(deadline: string | undefined, now: Date): string {
  if (!deadline) return "마감일 미상";
  const [y, m, d] = deadline.split("-").map((s) => parseInt(s, 10));
  const dl = Date.UTC(y, m - 1, d);
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((dl - t) / 86_400_000);
  if (days < 0) return "마감";
  if (days === 0) return "D-DAY";
  return `D-${days}`;
}

export function renderGrantList(grants: GrantRecord[], total: number, asOf: string, now: Date): string {
  if (grants.length === 0) {
    return `검색 결과 0건. (기준시점 ${asOf}) 조건을 넓혀보세요. 근거 없는 공고는 만들지 않습니다.`;
  }
  const lines = grants.map((g, i) => {
    const 지원금 = g.지원내용 ? truncate(g.지원내용, 40) : "지원내용 원문 확인";
    return [
      `${i + 1}. ${g.제목}  [${dday(g.마감일, now)}]`,
      `   · 주관: ${g.주관기관} · 분야: ${g.분야 ?? "확인 불가"} · 지역: ${g.지역 ?? "확인 불가"} · 업력요건: ${g.업력요건 ?? "확인 불가"}`,
      `   · 지원내용: ${지원금}`,
      `   · id: ${g.id} · 마감: ${g.마감일 ?? "미상"} · 원문: ${g.원문URL}`,
    ].join("\n");
  });
  return [
    `검색 결과 ${grants.length}건 (전체 매칭 ${total}건 중) · 기준시점 ${asOf}`,
    "",
    ...lines,
    "",
    "다음 단계: 관심 공고 id로 check_eligibility(자격검토) → score_application(모의심사) → win_strategy(합격전략).",
  ].join("\n");
}

export function renderEligibility(g: GrantRecord, r: EligibilityResult): string {
  const mark = (s: string) => (s === "적합" ? "✅" : s === "부적합" ? "❌" : "⚠️");
  const items = r.항목별근거.map((i) => `  ${mark(i.결과)} ${i.요건}: ${i.결과}\n     └ 근거: ${i.근거}${i.보완 ? `\n     └ 보완: ${i.보완}` : ""}`);
  return [
    `[자격검토] ${g.제목}`,
    `판정: ${mark(r.판정)} ${r.판정}`,
    "",
    "항목별 근거:",
    ...items,
    "",
    r.보완액션.length ? `보완 액션:\n${r.보완액션.map((a) => `  - ${a}`).join("\n")}` : "보완 액션: 없음",
    "",
    출처표기(g.source, g.collected_at?.slice(0, 10), g.원문URL),
    `고지: ${r.고지}`,
  ].join("\n");
}

export function renderScore(g: GrantRecord, r: ScoreResult): string {
  const bar = (점수: number, 배점: number) => {
    const n = 배점 > 0 ? Math.round((점수 / 배점) * 10) : 0;
    return "█".repeat(n) + "░".repeat(10 - n);
  };
  const items = r.항목별.map(
    (i) => `  · ${i.항목} (${i.등급}) ${i.점수}/${i.배점}  ${bar(i.점수, i.배점)}\n     └ ${i.감점사유}\n     └ 보완: ${i.보완}`
  );
  return [
    `[모의심사] ${g.제목}`,
    `총점: ${r.총점} / ${r.만점}`,
    `합격선대비: ${r.합격선대비}`,
    "",
    "항목별 채점:",
    ...items,
    "",
    `다음 수정 제안(우선순위):\n${r.다음수정제안.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`,
    "",
    출처표기(g.source, g.collected_at?.slice(0, 10), g.원문URL),
    `고지: ${r.고지}`,
  ].join("\n");
}

export function renderStrategy(g: GrantRecord, s: WinStrategy): string {
  const 가점 = s.가점확보안.length
    ? s.가점확보안.map((x) => `  · [${x.상태}] ${x.사유} (+${x.점수}) — 증빙: ${x.증빙}`).join("\n")
    : "  공고 가점 항목 정보 없음 → 확인 불가(공고 원문 확인).";
  const 일정 = s.제출일정.map((x) => `  · ${x.시점}: ${x.할일}`).join("\n");
  return [
    `[합격전략] ${g.제목}`,
    `추천 트랙: ${s.추천트랙}`,
    "",
    `가점 확보안:\n${가점}`,
    "",
    `강조 포인트:\n${s.강조포인트.map((x) => `  · ${x}`).join("\n")}`,
    "",
    `제출 일정(역산):\n${일정}`,
    "",
    `함정 체크리스트:\n${s.함정체크리스트.map((x) => `  ☐ ${x}`).join("\n")}`,
    "",
    출처표기(g.source, g.collected_at?.slice(0, 10), g.원문URL),
    `고지: ${s.고지}`,
  ].join("\n");
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n) + "…" : clean;
}
