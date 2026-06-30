/**
 * F. 모의심사 채점 엔진 — scoreApplication() (★ 차별화 코어)
 * 점수는 루브릭(배점) × 등급 계수의 결정적 계산. 난수 절대 금지.
 * 같은 입력 → 항상 같은 출력. 등급은 명시값 우선, 없으면 텍스트 휴리스틱.
 */
import type { PlanSummary, RubricItem, ScoreItem, ScoreResult, 등급 } from "./types.js";
import { 점수고지 } from "./disclaimer.js";

/** 등급 → 배점 대비 점수 계수 (상>중>하, 결정적) */
const 계수: Record<등급, number> = { 상: 0.9, 중: 0.65, 하: 0.4 };

/** 루브릭 항목명 → plan_summary 필드 매핑 키워드 */
const 항목매핑: Record<string, (keyof PlanSummary)[]> = {
  기술: ["기술"],
  문제인식: ["시장", "기술"],
  실현가능성: ["기술", "재무"],
  시장: ["시장"],
  시장수요: ["시장"],
  성장: ["시장", "재무"],
  성장전략: ["시장", "재무"],
  성장예측: ["시장", "재무"],
  팀: ["팀"],
  팀구성: ["팀"],
  팀역량: ["팀"],
  지역: ["지역연계"],
  지역연계: ["지역연계"],
  지역안착: ["지역연계"],
  재무: ["재무"],
};

const 구체성신호 = [
  /\d/, // 숫자
  /%/, // 비율
  /(만원|억원|억|매출|투자)/,
  /(특허|지식재산|상표|ip)/i,
  /(계약|mou|loi|발주|수주)/i,
  /(검증|poc|파일럿|베타|실증|시제품|프로토타입)/i,
];

/** 텍스트에서 등급을 결정적으로 도출 (난수 없음) */
function 등급도출(text: string | undefined): 등급 {
  const t = (text ?? "").trim();
  if (t.length < 10) return "하";
  const 신호 = 구체성신호.reduce((n, re) => (re.test(t) ? n + 1 : n), 0);
  if (신호 >= 2 && t.length >= 40) return "상";
  if (신호 === 0 && t.length < 30) return "하";
  return "중";
}

function 항목텍스트(항목: string, plan: PlanSummary): string {
  const fields = 항목매핑[항목] ?? (["기술", "시장", "팀", "지역연계", "재무"] as (keyof PlanSummary)[]);
  return fields
    .map((f) => (typeof plan[f] === "string" ? (plan[f] as string) : ""))
    .filter(Boolean)
    .join(" ");
}

function 감점과보완(항목: string, 등급v: 등급, 배점: number, 점수: number): { 감점사유: string; 보완: string } {
  const 감점 = +(배점 - 점수).toFixed(2);
  if (등급v === "상") {
    return {
      감점사유: `핵심 근거 충실(상). 감점 ${감점}점은 만점 대비 통상적 여유분.`,
      보완: `${항목}: 정량 지표(수치·증빙)를 1~2개 더 보강하면 만점권 도달.`,
    };
  }
  if (등급v === "중") {
    return {
      감점사유: `근거 일부 부족(중). 정량성·구체성 미흡으로 ${감점}점 감점.`,
      보완: `${항목}: 막연한 서술 대신 수치·고객검증·증빙(특허/계약/PoC)을 추가하세요.`,
    };
  }
  return {
    감점사유: `핵심 근거 미흡(하). 구체적 설명·증빙 부재로 ${감점}점 감점.`,
    보완: `${항목}: 가장 큰 실점 항목. 무엇을·누구에게·어떻게를 수치와 함께 구체화하는 것이 최우선.`,
  };
}

export function scoreApplication(
  rubric: RubricItem[],
  plan: PlanSummary,
  opts: { 합격선?: number } = {}
): ScoreResult {
  const 항목별: ScoreItem[] = rubric.map((r) => {
    const 명시 = plan.등급?.[r.항목];
    const 등급v: 등급 = 명시 ?? 등급도출(항목텍스트(r.항목, plan));
    const 점수 = +(r.배점 * 계수[등급v]).toFixed(2);
    const { 감점사유, 보완 } = 감점과보완(r.항목, 등급v, r.배점, 점수);
    return { 항목: r.항목, 배점: r.배점, 점수, 등급: 등급v, 감점사유, 보완 };
  });

  const 총점 = +항목별.reduce((s, i) => s + i.점수, 0).toFixed(2);
  const 만점 = 항목별.reduce((s, i) => s + i.배점, 0);

  let 합격선대비: string;
  if (opts.합격선 !== undefined) {
    const diff = +(총점 - opts.합격선).toFixed(2);
    합격선대비 =
      diff >= 0
        ? `예상 합격선 ${opts.합격선}점 대비 +${diff}점 (통과권). 단 동점 타이브레이커·정성평가로 달라질 수 있음.`
        : `예상 합격선 ${opts.합격선}점 대비 ${diff}점 (미달). 아래 보완으로 ${Math.abs(diff)}점 이상 끌어올리세요.`;
  } else {
    합격선대비 = "공고별 합격선 정보 없음 → 확인 불가. 항목별 보완으로 총점을 높이는 데 집중하세요.";
  }

  // 다음수정제안: 감점이 큰 항목 우선
  const 다음수정제안 = [...항목별]
    .sort((a, b) => b.배점 - b.점수 - (a.배점 - a.점수))
    .slice(0, 3)
    .map((i) => i.보완);

  return { 총점, 만점, 항목별, 합격선대비, 다음수정제안, 고지: 점수고지 };
}
