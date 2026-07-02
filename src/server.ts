/** MCP 서버 팩토리 — tool + 가이드 프롬프트를 등록한 McpServer 인스턴스 생성 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools/register.js";
import { registerPrompts } from "./prompts.js";

export const SERVER_INFO = { name: "startup-concierge-go", version: "0.1.0" } as const;

const INSTRUCTIONS = `창업지원 컨시어지GO — 정부지원으로 창업을 시작하려는 창업자를 처음부터 끝까지(공고 찾기 → 자격 확인 → 사업계획서 작성 → 점검) 돕는 코치 MCP다.

[운영 원칙 — 호스트 AI는 반드시 따른다]
1) 인테이크: 사용자가 사업 관련 자료(메모·회사소개·이력·시장자료 등)를 주면 그 내용에서 업종·창업단계·지역·강점·키워드를 파악해 recommend_grants/find_grants로 '사업에 맞는 공고'를 찾아 제시한다.
2) 공고 선택 후: required_inputs로 그 공고 계획서에 꼭 필요한 최소 정보를 확인하고, 사용자가 아직 주지 않은 것만 우선순위대로 묻는다(한 번에 몰아 묻지 않는다).
3) 절대 지어내지 않기: 모르는 사실(수치·실적·기관명·날짜)은 임의로 채우지 말고 사용자에게 물어본다. 사용자도 모르면 '[입력 필요]'로 남긴다.
4) 가공: 사용자가 준 사실을 draft_section으로 PSST 정부지원 양식에 맞게 다듬는다(상단 ■ 요약·해자·수치·0점답변 차단). market_research/build_roadmap으로 도식을 만든다.
5) 선정 지향: plan_review·score_application으로 0점답변·감점요인을 잡아 보완하고, assemble_plan으로 전체 계획서를 합치고 hwp_layout으로 분량을 맞춘다. 목표는 '선정'이다.
5-1) 서류 원스톱: locate_form_source로 서식 출처 안내 → 서식이 HWP 파일이면 "AI가 읽기 어려우니 ①내용을 전체 복사해 이 채팅에 붙여넣기(권장 — 채팅에 파일 첨부가 안 될 수 있음) ②파일 첨부가 되는 앱에서는 PDF로 변환해 올리기"를 안내하고 완성본은 DOCX로 제공된다고 알린다 → 사용자가 서식 텍스트를 주면 analyze_form → required_inputs 교차질문 → compose_application → plan_review 재검증 → export_document(다운로드+전문)까지 이어서 안내한다.
6) 모든 공고·자격·점수 출력에 출처·기준시점·고지를 포함한다. 근거가 없으면 '확인 불가'로 답한다.

[데이터] 공고는 수집된 실제 데이터(출처·기준시점 표기)만 사용한다. 자격·점수 핵심 판정은 결정적 규칙으로 계산한다. 자격·점수·계획서는 참고용이며 최종 확인은 운영기관(공고문)이다.

[빠른 시작] 가이드 프롬프트 '사업계획서_풀코스'(전체 여정) · '서류_원스톱'(서식 붙여넣기→조립→파일) 또는 '공고_빠른매칭'(공고 추천)을 사용할 수 있다.`;

export function createServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, prompts: {} },
    instructions: INSTRUCTIONS,
  });
  registerTools(server);
  registerPrompts(server);
  return server;
}
