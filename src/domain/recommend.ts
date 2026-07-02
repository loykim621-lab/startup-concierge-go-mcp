/**
 * 공고 추천 엔진 -- recommendGrants()
 * 창업자 프로필(키워드.지역.단계.업종.마감임박)을 기준으로
 * 스토어 공고를 적합도 0~100 점수로 랭킹해 추천 목록을 반환한다.
 *
 * 불변 원칙:
 *  - 결정성: Math.random 금지. 같은 입력 -> 같은 출력.
 *    동점 시 id 사전순(stable) 정렬.
 *  - 사실 무결성: 공고 데이터를 지어내지 않는다.
 *    공고 필드가 없으면 해당 가점은 0.
 *  - 마감된 공고(now 이전)는 항상 제외.
 *  - 마감일 없는 공고는 deadline_within_days 필터가 있을 때만 제외.
 */
import { loadStore, daysUntil } from "../data/store.js";
import type { GrantRecord } from "../data/types.js";
import { 추천고지 } from "./disclaimer.js";
import { tokenMatches, mentionsOtherRegion } from "../lib/synonyms.js";

// -- 타입(이 파일에서 완결 정의) --

/** 단계 값(schemas.ts와 동기) */
export type RecommendStage = "예비" | "초기" | "도약";

/** recommendGrants() 입력 */
export interface RecommendInput {
  /** 검색 키워드 목록(AND 교집합 아님 -- 하나라도 매치 시 가점). */
  키워드?: string[];
  /** 사업장 소재 지역 (예: "광주"). */
  지역?: string;
  /** 창업 단계. */
  단계?: RecommendStage;
  /** 업종.분야 키워드 (예: "AI", "플랫폼"). */
  업종?: string;
  /** 마감 N일 이내 공고만 포함(미입력 시 마감 미도래 전체). */
  deadline_within_days?: number;
  /** 반환 최대 건수(기본 10, 최대 50). */
  limit?: number;
}

/** 추천 항목 1건 */
export interface RecommendItem {
  id: string;
  제목: string;
  주관기관: string;
  지역?: string;
  업력요건?: string;
  마감일?: string;
  원문URL: string;
  /** 적합도 0~100(결정적 산출). */
  적합도: number;
  /** 적합도 산출 근거(사실 기반 -- 지어내지 않음). */
  매칭이유: string[];
}

/** recommendGrants() 반환 */
export interface RecommendResult {
  추천: RecommendItem[];
  기준시점: string;
  출처: string;
  /** 추천 정밀도를 높이려면 더 제공해야 할 정보(입력이 부족할 때). */
  입력필요?: string[];
  /** 참고 고지 */
  고지: string;
}

// -- 단계->키워드 매핑(결정적 상수) --

const STAGE_WORDS: Record<RecommendStage, string[]> = {
  예비: ["예비", "예비창업", "예비창업자"],
  초기: ["초기", "창업초기", "3년", "초기기업"],
  도약: ["도약", "7년", "스케일업", "scale"],
};

// -- 적합도 계산(결정적) --

/**
 * 단일 공고에 대해 입력 조건과의 적합도(0~100)와 매칭이유를 산출한다.
 *
 * 배점 기준(합계 100):
 *  - 키워드 일치(하나라도): 35점
 *  - 지역 일치: 30점
 *  - 단계 일치: 20점
 *  - 업종 일치: 15점
 *  - 마감임박 보너스(<=7일): +5(100 초과 cap)
 *
 * 아무 조건도 없을 때(빈 입력): 마감임박 보너스만 가능 -> 폴백 정렬.
 */
function 적합도산출(
  grant: GrantRecord,
  input: RecommendInput,
  now: Date
): { 점수: number; 이유: string[] } {
  let 점수 = 0;
  const 이유: string[] = [];

  const haystack = [
    grant.제목,
    grant.분야,
    grant.지원대상,
    grant.지원내용,
    grant.업력요건,
    grant.지역,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // 키워드 가점(35점) -- 하나라도 매치 (동의어 확장: AI↔인공지능 등)
  if (input.키워드 && input.키워드.length > 0) {
    const 매칭키워드 = input.키워드.filter((kw) => kw && tokenMatches(haystack, kw));
    if (매칭키워드.length > 0) {
      점수 += 35;
      이유.push("키워드 일치(동의어 포함): " + 매칭키워드.join(", "));
    }
  }

  // 지역 가점(30점) — 제목에 타지역(서울 등)이 명시된 전국 공고는 가점 없이 주의 표기
  if (input.지역) {
    const 지역low = input.지역.toLowerCase();
    const 공고지역 = (grant.지역 ?? "").toLowerCase();
    const 타지역 = mentionsOtherRegion(grant.제목 ?? "", input.지역);
    if (공고지역.includes(지역low) || (공고지역 && 지역low.includes(공고지역))) {
      점수 += 30;
      이유.push("지역 일치: " + (grant.지역 ?? ""));
    } else if (공고지역 === "전국" || 공고지역.includes("전국")) {
      if (타지역) {
        이유.push(`제목에 타지역(${타지역}) 명시 — 개최지 확인 필요(지역 가점 없음)`);
      } else {
        점수 += 15;
        이유.push("전국 공고 (해당 지역에서 지원 가능)");
      }
    }
  }

  // 단계 가점(20점)
  if (input.단계) {
    const 단계단어들 = STAGE_WORDS[input.단계];
    const 매치 = 단계단어들.some((w) => haystack.includes(w.toLowerCase()));
    if (매치) {
      점수 += 20;
      이유.push("단계 일치: " + input.단계);
    }
  }

  // 업종 가점(15점)
  if (input.업종) {
    const 업종low = input.업종.toLowerCase();
    if (haystack.includes(업종low)) {
      점수 += 15;
      이유.push("업종 일치: " + input.업종);
    }
  }

  // 마감임박 보너스(+5, cap 100)
  const 남은일 = daysUntil(grant.마감일, now);
  if (남은일 !== null && 남은일 >= 0 && 남은일 <= 7) {
    점수 = Math.min(100, 점수 + 5);
    이유.push("마감임박: " + String(남은일) + "일 남음");
  }

  return { 점수, 이유 };
}

// -- 필터 --

/** 마감된 공고(now 이전)를 제거한다. 마감일 없는 공고는 통과. */
function 마감필터(grant: GrantRecord, now: Date): boolean {
  if (!grant.마감일) return true;
  const 남은 = daysUntil(grant.마감일, now);
  return 남은 !== null && 남은 >= 0;
}

/** deadline_within_days 필터. 설정 시 마감일 없는 공고는 제외. */
function 임박필터(grant: GrantRecord, days: number | undefined, now: Date): boolean {
  if (days === undefined) return true;
  if (!grant.마감일) return false;
  const 남은 = daysUntil(grant.마감일, now);
  return 남은 !== null && 남은 >= 0 && 남은 <= days;
}

// -- 입력필요 안내(결정적 상수) --

const 입력필요항목: string[] = [
  "업종 또는 분야 (예: AI.플랫폼.식품)를 입력하면 관련 공고를 우선 추천합니다.",
  "단계 (예비.초기.도약)를 입력하면 업력 조건에 맞는 공고를 필터링합니다.",
  "지역 (예: 광주.서울)을 입력하면 지역 특화 공고를 우선 추천합니다.",
  "키워드를 입력하면 공고 분야.내용을 매칭합니다.",
];

/** 입력이 완전히 비었을 때 제공해야 할 힌트 목록 */
function 입력필요판정(input: RecommendInput): string[] | undefined {
  const 비어있음 =
    !input.키워드?.length &&
    !input.지역 &&
    !input.단계 &&
    !input.업종;
  return 비어있음 ? [...입력필요항목] : undefined;
}

// -- 공개 API --

/**
 * 창업자 프로필을 기반으로 정부 창업지원 공고를 추천한다.
 *
 * @param input 검색 조건(키워드.지역.단계.업종.마감임박.limit)
 * @param now 기준 시점(결정성 보장 -- 테스트에서 고정값 주입 가능)
 */
export function recommendGrants(
  input: RecommendInput,
  now: Date = new Date()
): RecommendResult {
  const store = loadStore();
  const limit = Math.min(input.limit ?? 10, 50);

  // 마감된 공고 제거 + deadline_within_days 필터
  const 활성공고 = store.grants.filter(
    (g) => 마감필터(g, now) && 임박필터(g, input.deadline_within_days, now)
  );

  // 적합도 산출
  const 랭킹 = 활성공고
    .map((g) => {
      const { 점수, 이유 } = 적합도산출(g, input, now);
      return { g, 점수, 이유 };
    })
    // 내림차순 정렬 -- 동점 시 id 사전순(결정성 보장)
    .sort((a, b) => {
      if (b.점수 !== a.점수) return b.점수 - a.점수;
      return a.g.id.localeCompare(b.g.id);
    })
    .slice(0, limit);

  const 추천: RecommendItem[] = 랭킹.map(({ g, 점수, 이유 }) => ({
    id: g.id,
    제목: g.제목,
    주관기관: g.주관기관,
    지역: g.지역,
    업력요건: g.업력요건,
    마감일: g.마감일,
    원문URL: g.원문URL,
    적합도: 점수,
    매칭이유: 이유,
  }));

  const 기준시점 =
    (store.collected_at || "").slice(0, 10) || now.toISOString().slice(0, 10);

  return {
    추천,
    기준시점,
    출처: store.source,
    입력필요: 입력필요판정(input),
    고지: 추천고지,
  };
}