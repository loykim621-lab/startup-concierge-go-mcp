/**
 * 도메인 타입 — 자격검토·모의심사·합격전략의 결정적 로직이 다루는 데이터 구조.
 * 출처: knowledge/도메인_규칙_자격_심사.md (시행령 제2조·통합관리지침 제14차).
 *
 * 설계 원칙(사실 무결성):
 * - 공고 요건(GrantRequirements)의 각 필드는 "공고에서 확인된 것"만 채운다.
 *   확인 불가한 요건은 undefined로 두고, 엔진은 이를 "확인필요"로 처리한다(추측 금지).
 */

/** 창업자/사업자 프로필 (개인정보 최소수집 — 세션 단위, 식별정보 없음) */
export interface Profile {
  /** 업력(개월). 신규 등록은 0. 개업일이 있으면 개업일을 우선 사용. */
  업력_개월?: number;
  /** 개업일/법인성립일 (YYYY-MM-DD). 업력 경계값 정확 판정에 사용. */
  개업일?: string;
  /** 사업장 소재 지역 (예: "광주", "전국") */
  지역?: string;
  /** 업종(자유 텍스트 또는 명칭) */
  업종?: string;
  /** 표준산업분류 세세분류 5자리 (동종/이종 창업 판정용) */
  ksic5?: string;
  /** 기존 사업자 보유 여부 (이종창업 판정의 핵심 입력) */
  기존사업자?: boolean;
  /** 기존 사업 업종 KSIC 5자리 */
  기존업종_ksic5?: string;
  /** 신규(이번 창업) 업종 KSIC 5자리 */
  신규업종_ksic5?: string;
  /** 기존 동종사업 폐업 여부 */
  폐업여부?: boolean;
  /** 폐업 후 경과 개월 (동종창업 3년=36개월 기준) */
  폐업경과_개월?: number;
  /** 신산업 27분야 해당 여부 (모르면 생략 → 키워드 분류로 보조) */
  신산업해당?: boolean;
  /** 외부 투자유치 이력 (투자형 공고 게이트) */
  투자유치이력?: boolean;
  /** 결격 상태 */
  결격상태?: 결격상태;
  /** 가점 후보 사유 (연구원창업·특구·기이전 등) */
  가점사유?: string[];
}

export interface 결격상태 {
  /** 금융기관 채무불이행/규제 상태 */
  채무불이행?: boolean;
  /** 채무조정 종류 ("새출발기금"|"프리워크아웃"|"개인워크아웃"|"개인회생"|"없음" 등) */
  채무조정?: string;
  /** 국세·지방세 체납 중 */
  체납?: boolean;
  /** 체납 강제징수 유예 또는 완납 증빙 */
  체납유예?: boolean;
  /** 신청 사업자 휴·폐업 중 */
  휴폐업?: boolean;
  /** 같은 해 중앙부처 창업사업화자금 동시수행 중 */
  동시수행_중앙부처창업사업화?: boolean;
  /** 기수혜/기선정 사업 목록 (재참여 제한 판정용) */
  기수혜?: string[];
  /** 환수금 미반환 */
  환수금미반환?: boolean;
  /** 임금체불 */
  임금체불?: boolean;
  /** 정부지원사업 참여제한 중 */
  참여제한?: boolean;
}

/** 공고별 요건 파라미터 (공통 규칙 × 공고 파라미터 분리) */
export interface GrantRequirements {
  /** 창업 여부를 게이트로 두는가 (예비/창업기업 대상이면 true). 기본 true. */
  창업확인?: boolean;
  /** 업력 요건 */
  업력?: {
    최대_개월?: number;
    최소_개월?: number;
    /** 기준일 (보통 공고마감일, YYYY-MM-DD) */
    기준일?: string;
  };
  /** 허용 지역. 비었거나 ["전국"]이면 지역 제한 없음. */
  지역?: string[];
  /** 신산업 27분야 해당 필수 */
  신산업_필수?: boolean;
  /** 투자형: 외부 투자유치 이력 필수 */
  투자유치_필수?: boolean;
  /** 트랙명 (예: "지역창업패키지","초기","도약") */
  트랙?: string;
  /** 결격 조항 */
  결격조항?: {
    채무불이행_결격?: boolean;
    /** 채무불이행이라도 예외 인정되는 채무조정 종류 */
    채무조정_예외?: string[];
    체납_결격?: boolean;
    휴폐업_결격?: boolean;
    동시수행_결격?: boolean;
    /** 재참여 제한 (지역창업패키지형=false) */
    재참여_제한?: boolean;
  };
  /** 가점 항목 */
  가점?: 가점항목[];
  /** 합격선(참고) */
  합격선?: number;
}

export interface 가점항목 {
  사유: string;
  점수: number;
  증빙: string;
  /** 프로필 가점사유와 매칭할 키워드 */
  매칭키워드?: string[];
}

export type 자격결과코드 = "적합" | "부적합" | "확인필요";

export interface EligibilityItem {
  요건: string;
  결과: 자격결과코드;
  근거: string;
  보완?: string;
}

export interface EligibilityResult {
  판정: 자격결과코드;
  항목별근거: EligibilityItem[];
  보완액션: string[];
  고지: string;
}

/** 평가지표(루브릭) 한 항목 */
export interface RubricItem {
  항목: string;
  배점: number;
  /** 항목 설명(무엇을 보는가) */
  평가설명?: string;
}

export type 등급 = "상" | "중" | "하";

export interface ScoreItem {
  항목: string;
  배점: number;
  점수: number;
  등급: 등급;
  감점사유: string;
  보완: string;
}

export interface ScoreResult {
  총점: number;
  만점: number;
  항목별: ScoreItem[];
  합격선대비: string;
  다음수정제안: string[];
  고지: string;
}

/** 사업계획 요약 (모의심사 입력) */
export interface PlanSummary {
  기술?: string;
  시장?: string;
  팀?: string;
  지역연계?: string;
  재무?: string;
  /** 테스트/명시 등급 주입용 (있으면 텍스트 휴리스틱 대신 사용) */
  등급?: Partial<Record<string, 등급>>;
}
