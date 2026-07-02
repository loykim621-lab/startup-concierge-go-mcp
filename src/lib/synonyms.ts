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

/** haystack(소문자 텍스트)이 토큰(동의어 포함)과 매칭되는가 */
export function tokenMatches(haystackLower: string, token: string): boolean {
  return expandToken(token).some((w) => haystackLower.includes(w));
}
