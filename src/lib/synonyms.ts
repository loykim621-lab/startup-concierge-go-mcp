/**
 * 검색 동의어 사전 — 결정적 확장(LLM 없음).
 * "AI"로 검색해도 본문에 "인공지능"이라고 쓴 공고를 찾도록, 토큰을 동의어 그룹으로 넓혀 매칭한다.
 * 원칙: 확실한 동치·표기 변형만 등록(과확장으로 엉뚱한 공고가 잡히면 신뢰 하락).
 */
export const SYNONYM_GROUPS: string[][] = [
  ["ai", "인공지능", "생성형", "머신러닝", "딥러닝", "llm", "에이아이", "생성ai"],
  ["sw", "소프트웨어", "software"],
  ["it", "ict", "정보통신"],
  ["앱", "어플", "애플리케이션", "모바일앱", "app"],
  ["플랫폼", "platform"],
  ["데이터", "빅데이터", "data"],
  ["재창업", "재도전", "재기"],
  ["소상공인", "자영업", "자영업자"],
  ["예비창업", "예비창업자"],
  ["바이오", "bio", "헬스케어", "의료"],
  ["로봇", "robot", "로보틱스"],
  ["콘텐츠", "컨텐츠", "contents"],
  ["관광", "여행", "트래블"],
  ["환경", "그린", "탄소중립", "기후"],
  ["글로벌", "해외", "수출", "해외진출"],
  ["투자", "vc", "엔젤", "투자유치"],
  ["제조", "스마트공장", "스마트제조"],
  ["푸드", "식품", "푸드테크", "외식"],
  ["핀테크", "fintech", "금융"],
  ["광주", "광주광역시"],
  ["부산", "부산광역시"],
  ["대구", "대구광역시"],
  ["대전", "대전광역시"],
  ["인천", "인천광역시"],
  ["울산", "울산광역시"],
  ["서울", "서울특별시"],
  ["세종", "세종특별자치시"],
];

/** 토큰(소문자 무관) → 매칭 후보 목록(자기 자신 + 속한 모든 그룹의 단어) */
export function expandToken(token: string): string[] {
  const t = token.trim().toLowerCase();
  const out = new Set([t]);
  for (const group of SYNONYM_GROUPS) {
    if (group.includes(t)) group.forEach((w) => out.add(w));
  }
  return [...out];
}

/**
 * haystack(소문자 텍스트)이 토큰(동의어 포함)과 매칭되는가.
 * 짧은 영문 토큰(ai·it·sw 등)은 영단어 속 철자 오매칭(ch"ai"n, susta"in"able)을 막기 위해
 * 단어 경계를 요구한다. 한글·긴 토큰은 부분 문자열 매칭.
 */
export function tokenMatches(haystackLower: string, token: string): boolean {
  return expandToken(token).some((w) => {
    if (/^[a-z0-9]{1,3}$/.test(w)) {
      // 앞뒤가 영숫자가 아니어야 함(한글·공백·기호·문두문미는 OK)
      const re = new RegExp(`(?<![a-z0-9])${w}(?![a-z0-9])`, "i");
      return re.test(haystackLower);
    }
    return haystackLower.includes(w);
  });
}

/** 광역 지역명(타지역 개최 판정용) */
export const REGION_NAMES = [
  "서울", "부산", "대구", "인천", "대전", "울산", "세종", "광주",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;

/**
 * 제목이 사용자 지역이 아닌 '다른 광역 지역'을 명시하는가.
 * (예: 사용자=광주, 제목="서울AI로봇쇼…" → "서울" 반환. 사용자 지역 언급은 무시)
 */
export function mentionsOtherRegion(title: string, userRegion: string): string | null {
  const t = title ?? "";
  for (const r of REGION_NAMES) {
    if (userRegion.includes(r) || r.includes(userRegion)) continue; // 내 지역은 제외
    if (t.includes(r)) return r;
  }
  return null;
}
