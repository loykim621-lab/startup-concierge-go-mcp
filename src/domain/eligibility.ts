/**
 * 자격검토 엔진 — checkEligibility()
 * knowledge/도메인_규칙_자격_심사.md A~D를 결정적 규칙으로 인코딩.
 *
 * 사실 무결성 원칙:
 * - 공고 요건이 확인 불가(undefined)한 항목은 "확인필요"로 처리하고 단정하지 않는다.
 * - 모든 게이트(투자/업력/결격/지역/창업)는 하나라도 부적합이면 전체 부적합.
 */
import type {
  EligibilityItem,
  EligibilityResult,
  GrantRequirements,
  Profile,
} from "./types.js";
import { 자격고지 } from "./disclaimer.js";
import { evaluateStartupStatus } from "./startup-status.js";
import { isValidISODate } from "../lib/date.js";

/** YYYY-MM-DD 에서 months 개월 뺀 날짜(UTC). 월말 day 오버플로는 말일로 클램프. */
function subtractMonths(iso: string, months: number): Date {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  const target = new Date(Date.UTC(y, m - 1 - months, d));
  if (target.getUTCDate() !== d) target.setUTCDate(0); // 말일 클램프
  return target;
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

function 개월차(개업일: string, 기준일: string): number {
  const a = parseISO(개업일);
  const b = parseISO(기준일);
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth()) +
    (b.getUTCDate() >= a.getUTCDate() ? 0 : -1)
  );
}

/** 전체 판정: 부적합 1개라도 있으면 부적합, 없고 확인필요 있으면 확인필요, 모두 적합이면 적합 */
function aggregate(items: EligibilityItem[]): "적합" | "부적합" | "확인필요" {
  if (items.some((i) => i.결과 === "부적합")) return "부적합";
  if (items.some((i) => i.결과 === "확인필요")) return "확인필요";
  return "적합";
}

export function checkEligibility(
  req: GrantRequirements,
  profile: Profile
): EligibilityResult {
  const items: EligibilityItem[] = [];

  // ── 1. 창업 여부 (req.창업확인 !== false 일 때 게이트) ──
  if (req.창업확인 !== false) {
    const s = evaluateStartupStatus(profile);
    items.push({
      요건: "창업 여부",
      결과: s.창업 ? "적합" : "부적합",
      근거: s.근거,
      보완: s.창업 ? undefined : "이종창업(다른 업종) 또는 폐업 3년 경과 요건 충족 여부를 업종코드와 함께 재확인하세요.",
    });
  }

  // ── 2. 투자유치 (투자형 게이트) ──
  if (req.투자유치_필수) {
    const ok = profile.투자유치이력 === true;
    items.push({
      요건: "외부 투자유치 이력(투자형)",
      결과: ok ? "적합" : "부적합",
      근거: ok
        ? "외부 투자유치 이력 보유 → 투자형 신청 요건 충족."
        : "투자형 공고는 외부 투자유치 이력이 신청 게이트인데 이력이 없음 → 부적합.",
      보완: ok ? undefined : "투자형이 아닌 일반·예비 트랙 공고를 검토하거나, 투자유치(TIPS·엔젤 등) 후 재신청을 고려하세요.",
    });
  }

  // ── 3. 업력 ──
  if (req.업력?.최대_개월 !== undefined) {
    const 최대 = req.업력.최대_개월;
    const 기준일 = req.업력.기준일;
    let 결과: EligibilityItem["결과"];
    let 근거: string;
    if (profile.개업일 && !isValidISODate(profile.개업일)) {
      // 사실 무결성: 잘못된 날짜를 조용히 정규화해 '적합'으로 오판하지 않는다.
      결과 = "확인필요";
      근거 = `개업일(${profile.개업일})이 유효한 달력 날짜(YYYY-MM-DD)가 아니어서 업력 판정 불가 → 확인필요. 정확한 개업일을 입력하세요.`;
    } else if (기준일 && !isValidISODate(기준일)) {
      결과 = "확인필요";
      근거 = `공고 기준일(${기준일})이 유효한 날짜가 아니어서 업력 판정 불가 → 확인필요(운영기관 확인).`;
    } else if (profile.개업일 && 기준일) {
      const cutoff = subtractMonths(기준일, 최대);
      const 개업 = parseISO(profile.개업일);
      const 업력 = 개월차(profile.개업일, 기준일);
      const 초과 = 개업.getTime() < cutoff.getTime();
      결과 = 초과 ? "부적합" : "적합";
      근거 = 초과
        ? `개업일(${profile.개업일})이 기준일(${기준일}) 기준 최대 업력 ${최대}개월 한도(컷오프 ${cutoff.toISOString().slice(0, 10)})를 초과 → 부적합. 산정 업력 약 ${업력}개월.`
        : `개업일(${profile.개업일}) 업력 약 ${업력}개월 ≤ 허용 ${최대}개월 → 적합.`;
    } else if (profile.업력_개월 !== undefined) {
      const 초과 = profile.업력_개월 > 최대;
      결과 = 초과 ? "부적합" : "적합";
      근거 = `업력 ${profile.업력_개월}개월 ${초과 ? ">" : "≤"} 허용 ${최대}개월 → ${초과 ? "부적합" : "적합"}.`;
    } else {
      결과 = "확인필요";
      근거 = "업력(개업일 또는 업력_개월) 정보가 없어 판정 불가 → 확인필요.";
    }
    items.push({ 요건: "업력 요건", 결과, 근거 });
  }

  // ── 4. 지역 ──
  if (req.지역 && req.지역.length > 0 && !req.지역.includes("전국")) {
    if (!profile.지역) {
      items.push({
        요건: "사업장 소재 지역",
        결과: "확인필요",
        근거: `허용 지역(${req.지역.join(", ")})이나 프로필 지역 정보 없음 → 확인필요.`,
      });
    } else {
      const ok = req.지역.some((r) => profile.지역!.includes(r) || r.includes(profile.지역!));
      items.push({
        요건: "사업장 소재 지역",
        결과: ok ? "적합" : "부적합",
        근거: ok
          ? `사업장 지역(${profile.지역})이 허용 지역(${req.지역.join(", ")})에 해당 → 적합.`
          : `사업장 지역(${profile.지역})이 허용 지역(${req.지역.join(", ")})에 미해당 → 부적합.`,
        보완: ok ? undefined : "해당 지역 소재(사업장 이전/지점) 또는 다른 지역 공고를 검토하세요.",
      });
    }
  }

  // ── 5. 신산업 필수 ──
  if (req.신산업_필수) {
    if (profile.신산업해당 === undefined) {
      items.push({
        요건: "신산업 27분야 해당",
        결과: "확인필요",
        근거: "신산업 해당 여부 미입력 → 확인필요(업종·기술 키워드로 신산업 분류 도구 사용 권장).",
      });
    } else {
      items.push({
        요건: "신산업 27분야 해당",
        결과: profile.신산업해당 ? "적합" : "부적합",
        근거: profile.신산업해당
          ? "신산업 27분야 해당 → 적합(서비스플랫폼 등은 넓게 인정, 최종은 운영기관 확인)."
          : "신산업 27분야 미해당 → 부적합.",
      });
    }
  }

  // ── 6. 결격사유 ──
  items.push(...checkDisqualifications(req, profile));

  // ── 보완액션 집계 ──
  const 보완액션 = items.filter((i) => i.보완).map((i) => i.보완!) as string[];

  return {
    판정: aggregate(items),
    항목별근거: items,
    보완액션: Array.from(new Set(보완액션)),
    고지: 자격고지,
  };
}

function checkDisqualifications(
  req: GrantRequirements,
  profile: Profile
): EligibilityItem[] {
  const out: EligibilityItem[] = [];
  const dq = profile.결격상태 ?? {};
  const rule = req.결격조항 ?? {};

  // 채무불이행 + 새출발기금 등 채무조정 예외 (B표, G3)
  if (rule.채무불이행_결격 && (dq.채무불이행 || dq.채무조정)) {
    const 예외목록 = rule.채무조정_예외 ?? [];
    const 조정 = dq.채무조정 ?? "";
    const 예외적용 = 조정 !== "" && 조정 !== "없음" && 예외목록.includes(조정);
    if (예외적용) {
      out.push({
        요건: "결격-채무불이행",
        결과: "적합",
        근거: `채무불이행이나 '${조정}' 채무조정 합의 체결자는 공고상 예외(결격 아님). 증빙(채무조정 합의서 사본) 필요.`,
        보완: "채무조정 합의서 사본을 증빙으로 준비하세요.",
      });
    } else if (dq.채무불이행) {
      out.push({
        요건: "결격-채무불이행",
        결과: "부적합",
        근거: `금융기관 채무불이행 규제 중이며 공고가 인정하는 채무조정 예외(${예외목록.join(", ") || "없음"})에 해당하지 않음 → 결격.`,
        보완: "새출발기금·프리워크아웃 등 채무조정 합의 후 예외 적용 가능 여부를 공고로 확인하세요.",
      });
    }
  }

  // 체납
  if (rule.체납_결격 && dq.체납) {
    const 유예 = dq.체납유예 === true;
    out.push({
      요건: "결격-국세·지방세 체납",
      결과: 유예 ? "적합" : "부적합",
      근거: 유예
        ? "체납이나 강제징수 유예/완납 증빙 → 결격 예외."
        : "국세·지방세 체납 중 → 결격.",
      보완: 유예 ? undefined : "완납 또는 강제징수 유예 증빙을 확보하세요.",
    });
  }

  // 휴·폐업 (신청 사업자)
  if (rule.휴폐업_결격 && dq.휴폐업) {
    out.push({
      요건: "결격-휴·폐업",
      결과: "부적합",
      근거: "신청 사업자가 휴·폐업 중 → 결격(신규 등록·정상영업 시 해당 없음).",
      보완: "정상 영업 중인 사업자 또는 신규 등록으로 신청하세요.",
    });
  }

  // 동시수행
  if (rule.동시수행_결격 && dq.동시수행_중앙부처창업사업화) {
    out.push({
      요건: "결격-동시수행",
      결과: "부적합",
      근거: "같은 해 중앙부처 창업사업화자금 동시수행 중 → 결격(전년도·지방정부 사업은 무관).",
      보완: "동시수행 사업 종료 후 신청하거나 동시수행 제한이 없는 공고를 검토하세요.",
    });
  }

  // 재참여 제한
  if (rule.재참여_제한 && (dq.기수혜?.length ?? 0) > 0) {
    out.push({
      요건: "결격-재참여 제한",
      결과: "부적합",
      근거: `동일계열 기선정 이력(${dq.기수혜!.join(", ")}) + 재참여 제한 트랙 → 결격. (지역창업패키지형은 재참여 제한 없음)`,
      보완: "재참여 제한이 없는 지역창업패키지형 등을 검토하세요.",
    });
  }

  // 환수금·임금체불·참여제한
  if (dq.환수금미반환) {
    out.push({ 요건: "결격-환수금 미반환", 결과: "부적합", 근거: "환수금 미반환 → 결격(완납 시 해소).", 보완: "환수금 완납 후 신청하세요." });
  }
  if (dq.임금체불) {
    out.push({ 요건: "결격-임금체불", 결과: "부적합", 근거: "임금체불 → 결격(해소 시 가능).", 보완: "임금체불 해소 증빙을 확보하세요." });
  }
  if (dq.참여제한) {
    out.push({ 요건: "결격-참여제한", 결과: "부적합", 근거: "정부지원사업 참여제한 중 → 결격.", 보완: "참여제한 해제 후 신청하세요." });
  }

  return out;
}
