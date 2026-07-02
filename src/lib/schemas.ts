/**
 * zod 입력 스키마 — registerTool의 inputSchema(ZodRawShape)로 사용.
 * 모든 tool 입력은 여기서 검증된다(DoD: zod 입력검증 누락 0).
 */
import { z } from "zod";
import { isValidISODate } from "./date.js";

export const 결격상태Schema = z
  .object({
    채무불이행: z.boolean().optional().describe("금융기관 채무불이행/규제 중"),
    채무조정: z.string().optional().describe("채무조정 종류(새출발기금/프리워크아웃/개인워크아웃/개인회생/없음 등)"),
    체납: z.boolean().optional(),
    체납유예: z.boolean().optional().describe("강제징수 유예 또는 완납 증빙"),
    휴폐업: z.boolean().optional(),
    동시수행_중앙부처창업사업화: z.boolean().optional(),
    기수혜: z.array(z.string()).optional().describe("기선정/기수혜 사업 목록"),
    환수금미반환: z.boolean().optional(),
    임금체불: z.boolean().optional(),
    참여제한: z.boolean().optional(),
  })
  .strict();

export const profileSchema = z
  .object({
    업력_개월: z.number().int().min(0).optional().describe("업력(개월). 신규=0. 개업일 있으면 그쪽 우선"),
    개업일: z
      .string()
      .refine(isValidISODate, { message: "유효한 달력 날짜(YYYY-MM-DD)가 아닙니다 (예: 2026-13-45 불가)" })
      .optional()
      .describe("개업일/법인성립일 YYYY-MM-DD"),
    지역: z.string().optional().describe("사업장 소재 지역 (예: 광주)"),
    업종: z.string().optional(),
    ksic5: z.string().optional().describe("표준산업분류 세세분류 5자리"),
    기존사업자: z.boolean().optional().describe("기존 사업자 보유 여부(이종창업 판정)"),
    기존업종_ksic5: z.string().optional(),
    신규업종_ksic5: z.string().optional(),
    폐업여부: z.boolean().optional(),
    폐업경과_개월: z.number().int().min(0).optional(),
    신산업해당: z.boolean().optional().describe("신산업 27분야 해당 여부"),
    투자유치이력: z.boolean().optional().describe("외부 투자유치 이력(투자형 게이트)"),
    결격상태: 결격상태Schema.optional(),
    가점사유: z.array(z.string()).optional(),
  })
  .strict();

export const planSummarySchema = z
  .object({
    기술: z.string().optional(),
    시장: z.string().optional(),
    팀: z.string().optional(),
    지역연계: z.string().optional(),
    재무: z.string().optional(),
    등급: z
      .record(z.enum(["상", "중", "하"]))
      .optional()
      .describe("루브릭 항목별 등급 명시(테스트/고급 사용). 없으면 텍스트로 자동 도출"),
  })
  .strict();

// ── 각 tool의 inputSchema (ZodRawShape) ──

export const findGrantsShape = {
  keywords: z.string().optional().describe("검색어(공백 구분 AND). 예: 'AI 광주'"),
  region: z.string().optional().describe("지역 필터. 예: 광주"),
  stage: z.enum(["예비", "초기", "도약"]).optional().describe("창업 단계"),
  industry: z.string().optional().describe("업종/분야 키워드"),
  deadline_within_days: z.number().int().min(1).max(365).optional().describe("마감 N일 이내"),
  limit: z.number().int().min(1).max(50).optional().describe("최대 결과 수(기본 10)"),
};

export const checkEligibilityShape = {
  grant_id: z.string().describe("find_grants로 얻은 공고 id (예: kstartup:178198)"),
  profile: profileSchema,
};

export const scoreApplicationShape = {
  grant_id: z.string().describe("공고 id"),
  plan_summary: planSummarySchema.describe("사업계획 요약(기술/시장/팀/지역연계/재무)"),
  합격선: z.number().optional().describe("예상 합격선(선택)"),
};

export const winStrategyShape = {
  grant_id: z.string().describe("공고 id"),
  profile: profileSchema.optional(),
  plan_summary: planSummarySchema.optional(),
};

// ── 사업계획서 작성 지원 6종 tool의 inputSchema (ZodRawShape) ──

/** plan_outline — PSST 4섹션 골격 생성. grant_id가 있으면 공고 grantMeta 주입. */
export const planOutlineShape = {
  grant_id: z.string().optional().describe("공고 id(find_grants로 얻은 값). 있으면 공고 제목·마감일·업력요건을 골격에 반영."),
  업종: z.string().optional().describe("창업자 업종 (예: AI·플랫폼·식품)"),
  지역: z.string().optional().describe("사업장 소재 지역 (예: 광주)"),
  대표경력: z.string().optional().describe("대표자 동종업계 경력 (예: 플랫폼 개발 8년)"),
};

/** market_research — PEST·시장규모(TAM/SAM/SOM/LAM)·경쟁비교 + 도식. */
const pestInputShape = z.object({
  정치: z.string().optional().describe("P — 법·제도·정책·규제·예산이 '왜 지금'을 뒷받침하는지"),
  경제: z.string().optional().describe("E — 소득·지출 변화, must-have 근거"),
  사회: z.string().optional().describe("S — 1인가구·AI 등 사회 변화와 수요 연결"),
  기술: z.string().optional().describe("T — 도입·준비 중인 기술이 솔루션을 가능케 하는 고리"),
}).optional();

const marketSizeInputShape = z.object({
  tam: z.object({ value: z.number().optional(), unit: z.string().optional(), 근거: z.string().optional(), 출처: z.string().optional() }).optional(),
  sam: z.object({ value: z.number().optional(), unit: z.string().optional(), 근거: z.string().optional(), 출처: z.string().optional() }).optional(),
  som: z.object({ value: z.number().optional(), unit: z.string().optional(), 근거: z.string().optional(), 출처: z.string().optional() }).optional(),
  lam: z.object({ value: z.number().optional(), unit: z.string().optional(), 근거: z.string().optional(), 출처: z.string().optional() }).optional(),
}).optional();

const competitorInputShape = z.object({
  name: z.string().describe("경쟁사 또는 자사 이름"),
  metrics: z.record(z.string()).describe("비교 지표→값 (수치 권장; 정성 표현은 경고 발생)"),
  self: z.boolean().optional().describe("자사 여부(true면 highlight 행)"),
});

export const marketResearchShape = {
  업종: z.string().optional().describe("업종/아이템 (예: 음식점 가격비교 앱)"),
  지역: z.string().optional().describe("주 거점 지역 (예: 광주)"),
  pest: pestInputShape.describe("PEST 4항목 (거시환경 분석). 비워두면 '[입력 필요]' 안내."),
  marketSize: marketSizeInputShape.describe("TAM·SAM·SOM·LAM 시장규모. 수치+근거+출처 필요."),
  competitors: z.array(competitorInputShape).optional().describe("경쟁사 목록(자사 포함). self:true인 행이 highlight."),
  비교축: z.array(z.string()).optional().describe("경쟁 비교 축 (예: ['가격','정확도','DB수']). 3개 이상+전수치면 레이더 자동 생성."),
};

/** build_roadmap — 마일스톤 4축 타임라인·자금 징검다리·시장변화 서술 + 로드맵 도식. */
const milestoneShape = z.object({
  시점: z.string().describe("시점 표기 (예: 2026-Q3, 2027-03, 2028)"),
  축: z.enum(["아이템", "자금", "마케팅", "운영"]).describe("마일스톤 4축"),
  내용: z.string().describe("마일스톤 내용"),
  상태: z.enum(["완료", "진행중", "예정"]).optional(),
  인과: z.string().optional().describe("'무엇이 되어야 이 단계가 가능한가' — 시간 나열 금지"),
});

export const buildRoadmapShape = {
  사업명: z.string().optional().describe("사업/아이템명 (로드맵 제목에 사용)"),
  거점: z.string().optional().describe("최초 거점 지역(LAM) (예: 광주)"),
  과거준비: z.array(
    z.object({ 시점: z.string().optional(), 내용: z.string() })
  ).optional().describe("이미 완료한 준비사항(시장조사·강의수료·MVP 등). '완료' 상태로 드러내 '이 사람이라서 되겠다'를 증명."),
  미래계획: z.array(milestoneShape).optional().describe("미래 마일스톤(축·시점·인과 포함 권장)."),
  자금계획: z.array(z.string()).optional().describe("자금 징검다리 표기 (예: ['예창패', '초창패', 'TIPS'])"),
};

/** draft_section — 특정 PSST 섹션 초안(창업자 입력을 규칙으로 구조화). */
export const draftSectionShape = {
  section: z.enum(["P", "S1", "S2", "T"]).describe("PSST 섹션 키. P=문제인식 / S1=실현가능성 / S2=성장전략 / T=팀구성"),
  inputs: z.record(z.string()).describe(
    "창업자가 제공하는 사실(수치·실적·기관명). 키는 내용 종류(예: {문제:'...', 시장현황:'...', MVP:'...'}). " +
    "빠진 항목은 '[입력 필요]'로 표시하고 임의로 채우지 않습니다."
  ),
};

/** plan_review — 사업계획서 전체·섹션별 체크리스트 점검. */
export const planReviewShape = {
  sections: z.record(z.string()).optional().describe("섹션별 텍스트 (예: {P:'...문제인식 본문...', S1:'...', S2:'...', T:'...'})"),
  fullText: z.string().optional().describe("전체 본문(sections 대신 전체 텍스트를 넣어도 됩니다)"),
};

/** hwp_layout — HWP 분량 진단·단축키·가독성 원칙. */
export const hwpLayoutShape = {
  목표페이지: z.number().int().min(1).max(100).optional().describe("목표 페이지 수 (기본 10 — 예창패 표준)"),
  현재글자수: z.number().int().min(0).optional().describe("현재 작성 글자수(한글에서 확인 가능). 없으면 진단불가 안내."),
  섹션별글자수: z.record(z.number().int().min(0)).optional().describe("섹션별 글자수 (예: {P:1200, S1:2000, S2:1800, T:1000})"),
};

// ── 신규 3종 tool의 inputSchema (ZodRawShape) ──

/** recommend_grants — 창업자 프로필 기반 공고 적합도 랭킹 추천. */
export const recommendGrantsShape = {
  키워드: z.array(z.string()).optional().describe("검색 키워드 목록 (예: [\"AI\", \"플랫폼\"]). 하나라도 매치하면 가점."),
  지역: z.string().optional().describe("사업장 소재 지역 (예: 광주). 지역 특화 공고를 우선 추천."),
  단계: z.enum(["예비", "초기", "도약"]).optional().describe("창업 단계. 예비=예비창업자 / 초기=3년 이내 / 도약=7년 이내."),
  업종: z.string().optional().describe("업종·분야 키워드 (예: AI, 플랫폼, 식품). 공고 분야·내용과 매칭."),
  deadline_within_days: z.number().int().min(1).max(365).optional().describe("마감 N일 이내 공고만 포함. 미입력 시 마감 미도래 전체."),
  limit: z.number().int().min(1).max(50).optional().describe("최대 결과 수 (기본 10)."),
};

/** required_inputs — 사업계획서 작성에 필요한 창업자 최소 정보 질문 목록. */
export const requiredInputsShape = {
  grant_id: z.string().optional().describe("선택한 공고 id (find_grants로 얻은 값). 있으면 공고별 유의 질문(업력요건·마감일 역산)을 추가."),
  provided: z.record(z.string()).optional().describe("이미 제공한 정보 (키:값). 매칭 키워드가 있으면 해당 질문을 '제공됨'으로 표시."),
};

/** assemble_plan — PSST 섹션·도식을 정부 양식 순서로 전체 사업계획서로 합본. */
export const assemblePlanShape = {
  grant_id: z.string().optional().describe("선택한 공고 id (표지/제목 맥락 표기에만 사용 — 사실을 지어내지 않음)."),
  sections: z.object({
    P: z.string().optional().describe("문제인식(P) 섹션 본문. 없으면 [입력 필요]."),
    S1: z.string().optional().describe("실현가능성(S1) 섹션 본문. 없으면 [입력 필요]."),
    S2: z.string().optional().describe("성장전략(S2) 섹션 본문. 없으면 [입력 필요]."),
    T: z.string().optional().describe("팀구성(T) 섹션 본문. 없으면 [입력 필요]."),
  }).describe("PSST 4섹션 본문. draft_section 결과 텍스트를 그대로 전달하면 됩니다."),
  목표페이지: z.number().int().min(1).max(100).optional().describe("목표 분량(페이지). 기본 10페이지(예창패 표준)."),
  charts: z.array(
    z.object({
      kind: z.string().describe("도식 종류 문자열 (예: funnel, gantt, radar). knowledge.ts CHART_CATALOG의 kind 권장."),
      svg: z.string().optional().describe("렌더된 SVG 문자열(있으면). 합본 본문에는 자리 안내만 삽입."),
    })
  ).optional().describe("합본에 배치할 도식 목록. 섹션 매핑 불가한 kind는 부록으로 처리."),
};

// ── 서류 원스톱(서식 붙여넣기→조립→내보내기) 4종 tool의 inputSchema (ZodRawShape) ──

/** locate_form_source — 공고 원문/사업안내 URL 안내(파일 자동 다운로드는 하지 않음). */
export const locateFormSourceShape = {
  grant_id: z.string().describe("find_grants/recommend_grants로 얻은 공고 id (예: kstartup:178198)"),
};

/** analyze_form — 붙여넣은 서식 텍스트를 분석해 칸·질문 목록으로 변환. */
export const analyzeFormShape = {
  form_text: z.string().min(1).describe("창업자가 공고 서식(hwp/hwpx 등)에서 복사해 붙여넣은 전체 텍스트."),
  grant_id: z.string().optional().describe("선택 공고 id(있으면 결과에 그대로 표기 — 사실을 지어내지 않음)."),
};

/** compose_application — 서식 칸별 답변을 유형별 작성 규칙으로 조립(서식 원래 순서 보존). */
const composeFieldShape = z.object({
  칸이름: z.string().describe("서식에 표기된 칸 이름(analyze_form의 필드목록[].칸이름을 그대로 사용 권장)."),
  유형: z.enum(["표", "서술", "자금표", "체크", "기타"]).optional().describe("칸 유형(analyze_form 출력 5종 그대로 수용). 없거나 '기타'면 서술로 처리."),
  psst매핑: z.enum(["P", "S1", "S2", "T"]).optional().describe("참고용 메타(순서 재배열에는 쓰이지 않음)."),
  답변: z.string().optional().describe("창업자가 제공한 사실(답). 없으면 '[입력 필요]'로 표시됨."),
});

export const composeApplicationShape = {
  fields: z.array(composeFieldShape).describe("서식 칸 목록(원래 등장 순서 그대로 전달 — PSST 순서로 재배열하지 않음)."),
  grant_id: z.string().optional().describe("선택 공고 id(맥락 표기용 — 사실을 지어내지 않음)."),
  사업아이템명: z.string().optional().describe("있으면 문서 상단 맥락에 표기."),
};

// ── 요청 업그레이드 오케스트레이터 tool의 inputSchema (ZodRawShape) ──

/** upgrade_request — 짧은 요청을 업그레이드된 작업 플랜/프롬프트로 증폭(결정적, LLM 없음). */
export const upgradeRequestShape = {
  요청: z.string().min(1).describe("사용자의 원문 요청 그대로(예: '인천 AI 창업 공고 찾아줘')."),
  맥락: z.string().optional().describe("사용자가 준 자료 요약·상황(선택). 서식 텍스트나 사업 소개 등."),
};

/** export_document — 합본/조립 결과를 다운로드 가능한 문서(docx/txt)로 변환. */
export const exportDocumentShape = {
  제목: z.string().min(1).describe("문서 제목(파일명에도 사용됨)."),
  sections: z.array(
    z.object({
      칸이름: z.string().describe("섹션/칸 이름(문서 내 소제목)."),
      내용: z.string().describe("섹션 본문 텍스트."),
    })
  ).describe("문서를 구성할 섹션 목록(순서 그대로 반영)."),
  format: z.enum(["docx", "txt"]).default("docx").describe("출력 형식. 기본 docx(한글에서 열람 가능), txt는 전체텍스트 그대로."),
};
