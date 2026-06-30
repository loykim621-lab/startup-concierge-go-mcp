/** 데이터 계층 타입 — 수집·저장·서빙 공통 */
import type { GrantRequirements, RubricItem } from "../domain/types.js";

export interface GrantRecord {
  id: string;
  제목: string;
  주관기관: string;
  분야?: string;
  지역?: string;
  /** 업력요건 원문 (예: "10년미만") */
  업력요건?: string;
  지원대상?: string;
  지원내용?: string;
  /** 마감일 YYYY-MM-DD */
  마감일?: string;
  접수시작?: string;
  원문URL: string;
  source: string;
  /** 수집 시점 ISO8601 */
  collected_at: string;
  /** 공고에서 확정 가능한 요건 파라미터(없으면 확인필요로 처리) */
  requirements?: GrantRequirements;
  /** 공고별 평가지표(없으면 표준 루브릭 사용) */
  rubric?: RubricItem[];
}

export interface GrantStoreFile {
  /** 스토어 메타 */
  collected_at: string;
  source: string;
  count: number;
  grants: GrantRecord[];
}
