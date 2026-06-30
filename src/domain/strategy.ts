/**
 * G. 합격전략 엔진 — buildWinStrategy()
 * 가점 최적화 + 트랙 선택 + 강조 포인트(배점 큰 항목) + 제출 일정 역산 + 함정 체크리스트.
 */
import type { GrantRequirements, PlanSummary, Profile, RubricItem } from "./types.js";
import { 전략고지 } from "./disclaimer.js";

export interface WinStrategy {
  추천트랙: string;
  가점확보안: { 사유: string; 점수: number; 상태: "확보가능" | "잠재"; 증빙: string }[];
  강조포인트: string[];
  제출일정: { 시점: string; 할일: string }[];
  함정체크리스트: string[];
  고지: string;
}

function 일정역산(마감일?: string): { 시점: string; 할일: string }[] {
  const steps = [
    { offset: 0, 할일: "접수 마감 — 온라인 제출 완료(마감 당일 트래픽 폭주 주의, 1일 전 제출 권장)" },
    { offset: -3, 할일: "최종 검토 — 사업계획서·증빙 정합성, 대표자 계정/1개 신청 확인" },
    { offset: -7, 할일: "증빙 수합 — 사업자등록·재무·가점 증빙(채무조정 합의서 등) 준비" },
    { offset: -14, 할일: "사업계획서 초안 완성 — 모의심사(score_application)로 자가채점·보완" },
  ];
  if (!마감일) {
    return steps.map((s) => ({ 시점: `마감 ${s.offset}일`, 할일: s.할일 }));
  }
  const [y, m, d] = 마감일.split("-").map((s) => parseInt(s, 10));
  return steps.map((s) => {
    const dt = new Date(Date.UTC(y, m - 1, d + s.offset));
    return { 시점: `${dt.toISOString().slice(0, 10)} (마감 ${s.offset}일)`, 할일: s.할일 };
  });
}

export function buildWinStrategy(
  req: GrantRequirements,
  profile: Profile,
  _plan: PlanSummary,
  rubric: RubricItem[],
  grantMeta: { 마감일?: string; 제목?: string } = {}
): WinStrategy {
  // 추천 트랙
  let 추천트랙: string;
  if (req.트랙) {
    추천트랙 = `공고 지정 트랙: ${req.트랙}`;
  } else if (profile.신산업해당) {
    추천트랙 = "신산업 트랙 — 신산업 27분야 해당 시 업력 한도(최대 10년)·가점에서 유리. 일반 트랙과 자격 비교 후 택1.";
  } else if (profile.투자유치이력) {
    추천트랙 = "투자형 트랙 검토 가능 — 투자유치 이력 보유. 단 동시수행 제한 확인.";
  } else {
    추천트랙 = "일반/예비 트랙 — 신산업·투자유치 요건이 약하면 일반 트랙이 안전.";
  }

  // 가점 확보안
  const 가점확보안 = (req.가점 ?? []).map((g) => {
    const matched = (profile.가점사유 ?? []).some(
      (r) => g.매칭키워드?.some((k) => r.includes(k)) || r.includes(g.사유)
    );
    return {
      사유: g.사유,
      점수: g.점수,
      상태: matched ? ("확보가능" as const) : ("잠재" as const),
      증빙: g.증빙,
    };
  });

  // 강조 포인트 — 배점 큰 항목 상위 2개
  const 강조포인트 = [...rubric]
    .sort((a, b) => b.배점 - a.배점)
    .slice(0, 2)
    .map((r) => `'${r.항목}'(배점 ${r.배점}) — 배점이 가장 크므로 가장 공들여 정량 근거로 채우세요.`);
  if (강조포인트.length === 0) {
    강조포인트.push("공고 평가지표(배점) 확인 후 배점 큰 항목에 집중하세요. (루브릭 정보 없음 → 확인 필요)");
  }

  // 함정 체크리스트
  const 함정체크리스트 = [
    "사업계획서 교차신청 불가 여부 확인(동일 계획서로 복수 사업 신청 제한이 흔함).",
    "1개 지역/도시만 신청 가능한지 확인(지역형).",
    "대표자 본인 계정·공동인증서로 신청해야 하는지 확인.",
  ];
  if (req.투자유치_필수) 함정체크리스트.push("투자형: 투자계약·확약 증빙 시점·금액 요건 확인.");
  if (req.결격조항?.재참여_제한) 함정체크리스트.push("동일계열 기선정 시 재참여 불가 — 이력 점검.");

  return {
    추천트랙,
    가점확보안,
    강조포인트,
    제출일정: 일정역산(grantMeta.마감일),
    함정체크리스트,
    고지: 전략고지,
  };
}
