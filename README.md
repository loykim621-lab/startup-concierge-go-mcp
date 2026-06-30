# 창업지원 컨시어지GO — MCP 서버

정부 창업지원 공고를 **검색**하고, 내 **자격을 검토**하고, **모의 심사로 채점**하고, **합격 전략**을 짜고, **PSST 사업계획서 작성**(시장조사 도식·로드맵·HWP)까지 코칭하는 카카오톡 MCP 에이전트.

> 포지셔닝: "검색 도구"가 아니라 **"내 사업계획을 실제로 채점·반려하고 다시 쓰게 하는 에이전트 코치"**.

## Tool 10종

### A. 공고·자격·심사 (4종)
| tool | 설명 | 핵심 |
|---|---|---|
| `find_grants` | 공고 검색(키워드·지역·단계·분야·마감임박) | 수집된 **실제 공고**만, 출처·기준시점 표기 |
| `check_eligibility` | 자격 검토 | **결정적 규칙**(창업여부·업력·지역·신산업·결격·새출발기금 예외) |
| `score_application` | 모의 심사 채점 ★차별화 | **난수 없는 결정적 채점** + 감점사유·보완 |
| `win_strategy` | 합격 전략 | 트랙·가점·강조포인트·일정 역산·함정 체크 |

### B. 사업계획서 작성 지원 (6종 — 정부지원 사업계획서 표준 방법론 인코딩)
| tool | 설명 | 핵심 |
|---|---|---|
| `plan_outline` | PSST 4섹션 골격 | 섹션별 필수 도식·작성원칙·체크리스트, 공고 맞춤 유의 |
| `market_research` | 시장조사(PEST·TAM/SAM/SOM/LAM·경쟁) | **깔때기·레이더 SVG 도식** + 정성적→수치 경고 |
| `build_roadmap` | 마일스톤 4축 로드맵 | 자금 징검다리(예창패→초창패→TIPS)·인과사슬·로드맵 SVG |
| `draft_section` | PSST 섹션 초안 다듬기 | **0점답변(선점)·정성적 표현 차단**, 빠진 사실 `[입력 필요]` |
| `plan_review` | 절대 체크리스트 점검 | 0점답변 치명경고, 자동 확인 통과 N/10 |
| `hwp_layout` | HWP 분량·정렬 진단 | 페이지 수 맞춤 자간/줄간격 단축키, 가독성 원칙 |

> 사실 무결성: 작성 도구는 **창업자의 사실(수치·실적·기관명)을 지어내지 않는다.** 빠지면 `[입력 필요]`로 표시. 도식은 입력값을 그대로 시각화.

## 빠른 시작

```bash
npm install
npm run collect          # K-Startup 공식 API에서 실제 공고 수집 → data/grants.json
npm test                 # 도메인 골든 + 통합 E2E + 도식/작성 모듈 (205 tests)
npm run build            # dist/ 컴파일
```

### 로컬 실행 (stdio — MCP Inspector / Claude Desktop)

```bash
npm run build && npm start          # stdio transport
# 또는 개발 모드
npm run dev
```

MCP Inspector로 점검:
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### HTTP 실행 (배포용 — 카카오클라우드 / PlayMCP)

```bash
npm run build && npm run start:http   # POST /mcp, GET /health  (PORT 기본 8080)
```

## 데이터·사실 무결성

- 공고는 **K-Startup 공식 오픈 API**(`nidapi.k-startup.go.kr`, 인증키 불필요, robots 허용)에서 수집한 **실데이터**. 각 출력에 `출처·수집시점·원문URL` 표기.
- 자격·점수 **핵심 판정은 결정적 규칙**(LLM 환각 차단). 근거 없으면 **"확인 불가"**.
- 모든 자격·점수 출력에 **"참고용, 운영기관 최종확인"** 고지.
- 도메인 규칙 출처: `../knowledge/도메인_규칙_자격_심사.md` (시행령 제2조·통합관리지침 제14차).

## 구조

```
src/
  domain/        결정적 도메인 로직 (자격·채점·전략·창업여부·신산업·고지)
  data/          스토어(로컬 JSON) + 기본 루브릭/결격조항 + 타입
  collector/     K-Startup 실수집기(martgo-monitor 패턴 이식)
  lib/           zod 입력 스키마 + 출력 포매터
  tools/         4개 MCP tool 등록
  server.ts      McpServer 팩토리
  index.ts       transport 부트스트랩(stdio/http)
test/
  golden.test.ts       G1~G5 + 분기 (도메인 정확성)
  integration.test.ts  MCP 클라이언트↔서버 E2E + 적대적
data/grants.json       수집된 실공고 스토어
```

## 환경변수

`.env.example` 참고. 키·토큰은 절대 커밋 금지(.gitignore 포함).

## 🔴 배포·접수 게이트

카카오클라우드 공개배포 / PlayMCP 심사요청 / 전체공개 / 예선접수는 **보스 승인 게이트**.
절차: `../배포_가이드_카카오클라우드_PlayMCP.md`.
