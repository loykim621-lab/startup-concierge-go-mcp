/**
 * 18개 MCP tool 등록 — 검색·자격·채점·전략 4종 + 사업계획서 지원 6종 + 추천·질문·합본 3종 + 서류 원스톱 4종 + 요청 업그레이드 1종.
 * 핵심 판정은 도메인 결정적 로직에 위임. 이 계층은 입력검증·조회·포매팅·고지만 담당.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  findGrantsShape,
  checkEligibilityShape,
  scoreApplicationShape,
  winStrategyShape,
  planOutlineShape,
  marketResearchShape,
  buildRoadmapShape,
  draftSectionShape,
  planReviewShape,
  hwpLayoutShape,
  recommendGrantsShape,
  requiredInputsShape,
  assemblePlanShape,
  locateFormSourceShape,
  analyzeFormShape,
  composeApplicationShape,
  exportDocumentShape,
  upgradeRequestShape,
} from "../lib/schemas.js";
import { getGrant, queryGrants, loadStore, partitionByRegion } from "../data/store.js";
import { 표준루브릭, 기본결격조항 } from "../data/defaults.js";
import { checkEligibility } from "../domain/eligibility.js";
import { scoreApplication } from "../domain/scoring.js";
import { buildWinStrategy } from "../domain/strategy.js";
import type { GrantRequirements } from "../domain/types.js";
import {
  renderGrantList,
  renderEligibility,
  renderScore,
  renderStrategy,
} from "../lib/format.js";
import { buildPlanOutline, draftSection, reviewChecklist } from "../domain/bizplan/psst.js";
import { buildMarketResearch } from "../domain/bizplan/market.js";
import { buildRoadmap } from "../domain/bizplan/roadmap.js";
import { buildHwpLayout } from "../domain/bizplan/hwp.js";
import { renderAll } from "../viz/svg.js";
import type { MarketResearchInput, RoadmapInput, DraftSectionInput, HwpLayoutInput, PsstKey } from "../domain/bizplan/types.js";
import { recommendGrants } from "../domain/recommend.js";
import type { RecommendInput } from "../domain/recommend.js";
import { requiredInputs } from "../domain/bizplan/required.js";
import { assemblePlan } from "../domain/bizplan/assemble.js";
import type { AssembleInput, AssembleChart } from "../domain/bizplan/assemble.js";
import { analyzeFormText } from "../domain/bizplan/form.js";
import type { FormAnalysisInput } from "../domain/bizplan/form.js";
import { composeApplication } from "../domain/bizplan/compose.js";
import type { ComposeInput, ComposeField } from "../domain/bizplan/compose.js";
import { buildDocx } from "../lib/docxgen.js";
import { putFile, buildDownloadUrl } from "../lib/filestore.js";
import { 작성고지 } from "../domain/disclaimer.js";
import { upgradeRequest } from "../domain/upgrade.js";
import type { UpgradeInput } from "../domain/upgrade.js";

function textResult(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  const res: CallToolResult = { content: [{ type: "text", text }] };
  if (structuredContent) res.structuredContent = structuredContent;
  return res;
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function grantNotFound(id: string): CallToolResult {
  const store = loadStore();
  return errorResult(
    `공고 id '${id}'를 스토어에서 찾지 못했습니다(확인 불가). 먼저 find_grants로 유효한 id를 확인하세요. ` +
      `현재 스토어 ${store.count}건 (수집시점 ${store.collected_at || "없음"}).`
  );
}

/** 공고 요건 보정: 저장된 requirements + 표준 결격조항 폴백 */
function resolveRequirements(reqs: GrantRequirements | undefined): GrantRequirements {
  const base = reqs ?? { 창업확인: true };
  return { ...base, 결격조항: base.결격조항 ?? { ...기본결격조항 } };
}

/** 파일명 안전화: 제목을 파일명으로 쓸 수 있게 위험 문자 제거·길이 제한. 결정적(난수 없음). */
function sanitizeFilename(제목: string): string {
  const cleaned = (제목 || "문서")
    .trim()
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
    .replace(/\.{2,}/g, "_") // '..' 경로조작 토큰 제거(단일 마침표는 허용)
    .replace(/\s+/g, "_")
    .slice(0, 60);
  return cleaned || "문서";
}

export function registerTools(server: McpServer): void {
  // ① find_grants
  server.registerTool(
    "find_grants",
    {
      title: "정부 창업지원 공고 검색",
      description:
        "정부 창업지원 공고를 키워드·지역·단계·분야·마감임박으로 검색합니다. 수집된 실제 공고(출처·수집시점 표기)만 반환하며, 근거 없는 공고는 만들지 않습니다.",
      inputSchema: findGrantsShape,
    },
    async (args): Promise<CallToolResult> => {
      const now = new Date();
      const limit = args.limit ?? 10;
      const base = {
        keywords: args.keywords,
        region: args.region,
        stage: args.stage,
        industry: args.industry,
        deadline_within_days: args.deadline_within_days,
      };
      let matched = queryGrants(base, now);
      let 확장노트: string | null = null;
      // 확장 1: 다중 키워드 전부일치(AND) 0건 → 일부일치(OR)로 완화
      const 토큰수 = (args.keywords ?? "").trim().split(/\s+/).filter(Boolean).length;
      if (matched.length === 0 && 토큰수 > 1) {
        matched = queryGrants({ ...base, matchMode: "or" }, now);
        if (matched.length > 0)
          확장노트 =
            "모든 키워드가 일치하는 공고는 0건이라, 키워드 중 일부만 일치하는 공고로 넓혀 찾았습니다.";
      }
      // 확장 2: 그래도 0건 → 키워드를 빼고 나머지 조건으로(빈손 대신 대안 제시, 정직 표기)
      if (matched.length === 0 && args.keywords) {
        matched = queryGrants({ ...base, keywords: undefined }, now);
        if (matched.length > 0)
          확장노트 = `'${args.keywords}' 일치 공고는 0건입니다. 대신 나머지 조건으로 지원 가능한 공고를 보여드립니다(키워드 제외 확장).`;
      }
      // 지역 우선순위: 지역밀착 공고 최우선 → 순수 전국 공고.
      // 접수는 전국이라도 제목에 타지역(서울 등)이 명시된 공고는 기본 제외(정직 표기).
      let 타지역제외 = 0;
      if (args.region) {
        const p = partitionByRegion(matched, args.region);
        타지역제외 = p.타지역개최.length;
        matched = [...p.지역밀착, ...p.전국일반];
      }
      const shown = matched.slice(0, limit);
      const store = loadStore();
      const asOf = store.collected_at?.slice(0, 10) || "수집정보 없음";
      let text = renderGrantList(shown, matched.length, asOf, now);
      if (확장노트) text = `※ 확장 검색: ${확장노트}\n\n${text}`;
      if (타지역제외 > 0)
        text += `\n\n※ 접수는 '전국'이지만 제목에 타지역(서울 등)이 명시된 공고 ${타지역제외}건은 제외했습니다. 보시려면 지역 조건 없이 검색하세요.`;
      return textResult(text, {
        확장검색: 확장노트,
        타지역제외,
        기준시점: asOf,
        출처: store.source,
        전체매칭: matched.length,
        결과: shown.map((g) => ({
          id: g.id,
          제목: g.제목,
          주관기관: g.주관기관,
          지역: g.지역 ?? null,
          업력요건: g.업력요건 ?? null,
          마감일: g.마감일 ?? null,
          원문URL: g.원문URL,
        })),
      });
    }
  );

  // ② check_eligibility
  server.registerTool(
    "check_eligibility",
    {
      title: "자격 검토",
      description:
        "특정 공고(grant_id)에 대해 내 프로필의 자격을 결정적 규칙으로 검토합니다(창업여부·업력·지역·신산업·결격·새출발기금 예외 등). 적합/확인필요/부적합 + 항목별 공고문구 근거 + 보완액션. 자격을 보증하지 않으며 운영기관 최종확인 고지를 포함합니다.",
      inputSchema: checkEligibilityShape,
    },
    async (args): Promise<CallToolResult> => {
      const g = getGrant(args.grant_id);
      if (!g) return grantNotFound(args.grant_id);
      const req = resolveRequirements(g.requirements);
      const result = checkEligibility(req, args.profile);
      return textResult(renderEligibility(g, result), {
        grant_id: g.id,
        판정: result.판정,
        항목별근거: result.항목별근거,
        보완액션: result.보완액션,
        출처: g.source,
        수집시점: g.collected_at?.slice(0, 10) ?? null,
        원문URL: g.원문URL,
        고지: result.고지,
      });
    }
  );

  // ③ score_application
  server.registerTool(
    "score_application",
    {
      title: "모의 심사(채점)",
      description:
        "사업계획 요약을 공고 평가지표(루브릭)에 매핑해 결정적으로 채점합니다(난수 없음). 총점·항목별 점수·감점사유·보완 포인트·다음 수정 제안을 돌려줘 '다시 쓰게' 만듭니다. 참고용이며 운영기관 최종평가와 다를 수 있습니다.",
      inputSchema: scoreApplicationShape,
    },
    async (args): Promise<CallToolResult> => {
      const g = getGrant(args.grant_id);
      if (!g) return grantNotFound(args.grant_id);
      const rubric = g.rubric ?? 표준루브릭;
      const result = scoreApplication(rubric, args.plan_summary, { 합격선: args.합격선 });
      return textResult(renderScore(g, result), {
        grant_id: g.id,
        총점: result.총점,
        만점: result.만점,
        항목별: result.항목별,
        다음수정제안: result.다음수정제안,
        출처: g.source,
        수집시점: g.collected_at?.slice(0, 10) ?? null,
        고지: result.고지,
      });
    }
  );

  // ④ win_strategy
  server.registerTool(
    "win_strategy",
    {
      title: "합격 전략",
      description:
        "공고·프로필 기반으로 추천 트랙·가점 확보안·강조 포인트·제출 일정 역산·함정 체크리스트를 제시합니다. 참고용 제안이며 가점·트랙·일정은 공고 원문으로 최종 확인하세요.",
      inputSchema: winStrategyShape,
    },
    async (args): Promise<CallToolResult> => {
      const g = getGrant(args.grant_id);
      if (!g) return grantNotFound(args.grant_id);
      const req = resolveRequirements(g.requirements);
      const rubric = g.rubric ?? 표준루브릭;
      const strategy = buildWinStrategy(
        req,
        args.profile ?? {},
        args.plan_summary ?? {},
        rubric,
        { 마감일: g.마감일, 제목: g.제목 }
      );
      return textResult(renderStrategy(g, strategy), {
        grant_id: g.id,
        추천트랙: strategy.추천트랙,
        가점확보안: strategy.가점확보안,
        강조포인트: strategy.강조포인트,
        제출일정: strategy.제출일정,
        함정체크리스트: strategy.함정체크리스트,
        출처: g.source,
        수집시점: g.collected_at?.slice(0, 10) ?? null,
        고지: strategy.고지,
      });
    }
  );

  // ⑤ plan_outline — PSST 4섹션 골격
  server.registerTool(
    "plan_outline",
    {
      title: "사업계획서 PSST 골격 생성",
      description:
        "정부지원 사업계획서 표준(PSST) 프레임워크에 따른 사업계획서 4섹션 골격(문제인식·실현가능성·성장전략·팀구성)을 " +
        "생성합니다. grant_id가 있으면 해당 공고의 마감일·업력요건을 반영한 맞춤 유의점을 추가합니다. " +
        "필수 도식 종류·작성 원칙·절대 체크리스트를 포함하며, 창업자 사실은 지어내지 않습니다.",
      inputSchema: planOutlineShape,
    },
    async (args): Promise<CallToolResult> => {
      // grant_id가 있으면 공고 메타 조회 → grantMeta 주입
      let grantMeta: { 제목?: string; 마감일?: string; 업력요건?: string } | undefined;
      if (args.grant_id) {
        const g = getGrant(args.grant_id);
        if (g) {
          grantMeta = { 제목: g.제목, 마감일: g.마감일, 업력요건: g.업력요건 };
        }
        // 공고 없어도 진행(골격 자체는 항상 제공)
      }

      const profile = {
        ...(args.업종 ? { 업종: args.업종 } : {}),
        ...(args.지역 ? { 지역: args.지역 } : {}),
        ...(args.대표경력 ? { 대표경력: args.대표경력 } : {}),
      };

      const result = buildPlanOutline({ grantMeta, profile });

      // 사람이 읽는 한국어 요약 텍스트 구성
      const lines: string[] = [
        "[사업계획서 PSST 골격]",
        `아이템명 형식: ${result.아이템명형식}`,
        "",
        "■ PSST 4섹션",
      ];
      for (const s of result.섹션) {
        lines.push(`\n[${s.key}] ${s.한글명}`);
        lines.push(`핵심질문: ${s.핵심질문}`);
        lines.push(`요구내용: ${s.요구내용.join(" / ")}`);
        lines.push(`필수도식: ${s.필수도식.join(", ")}`);
        if (s.이공고_유의.length > 0) {
          lines.push(`이 공고 유의: ${s.이공고_유의.join(" | ")}`);
        }
      }
      lines.push("\n■ 관통원칙");
      result.관통원칙.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
      lines.push("\n■ 절대 체크리스트");
      result.체크리스트.forEach((c, i) => lines.push(`☐ ${i + 1}. ${c}`));
      lines.push(`\n고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        아이템명형식: result.아이템명형식,
        섹션: result.섹션,
        관통원칙: result.관통원칙,
        체크리스트: result.체크리스트,
        grant_id: args.grant_id ?? null,
        고지: result.고지,
      });
    }
  );

  // ⑥ market_research — PEST·시장규모·경쟁비교 + 도식 SVG
  server.registerTool(
    "market_research",
    {
      title: "시장조사 분석 (PEST·TAM/SAM/SOM/LAM·경쟁비교)",
      description:
        "PEST 거시환경 분석, TAM·SAM·SOM·LAM 시장규모 추정(깔때기+막대 도식), " +
        "경쟁사 수치 비교표(정성적 표현 경고)와 레이더 차트(3축 이상+전수치 시 자동 생성)를 제공합니다. " +
        "모든 시장 수치는 창업자 입력 기반이며 누락 항목은 '[입력 필요]'로 표시합니다. " +
        "수치를 임의로 지어내지 않으며, 출처는 창업자가 직접 확인·기입해야 합니다.",
      inputSchema: marketResearchShape,
    },
    async (args): Promise<CallToolResult> => {
      // 타입 변환: zod 파싱된 args → MarketResearchInput
      const input: MarketResearchInput = {
        업종: args.업종,
        지역: args.지역,
        pest: args.pest as MarketResearchInput["pest"],
        marketSize: args.marketSize as MarketResearchInput["marketSize"],
        competitors: args.competitors as MarketResearchInput["competitors"],
        비교축: args.비교축,
      };

      const result = buildMarketResearch(input);

      // 차트 SVG 렌더(tool 계층 책임 — 도메인은 spec만 반환)
      const renderedCharts = renderAll(result.charts);

      // 사람이 읽는 한국어 요약
      const lines: string[] = ["[시장조사 분석]"];

      lines.push("\n■ PEST 거시환경");
      result.pest.forEach((p) => lines.push(`[${p.항목}] ${p.내용}\n  → 시사점: ${p.시사점}`));

      lines.push("\n■ 시장규모 (TAM→SAM→SOM→LAM)");
      result.시장규모.forEach((m) =>
        lines.push(`${m.단계}: ${m.값}\n  근거: ${m.근거} | 출처: ${m.출처}`)
      );

      lines.push("\n■ 경쟁비교");
      if (result.경쟁비교.정성적경고.length > 0) {
        lines.push("⚠️ 정성적 표현 경고:");
        result.경쟁비교.정성적경고.forEach((w) => lines.push(`  • ${w}`));
      }
      lines.push(`경쟁비교표: ${result.경쟁비교.표.headers.join(" | ")}`);
      result.경쟁비교.표.rows.forEach((r) => lines.push(`  ${r.join(" | ")}`));

      if (result.입력필요.length > 0) {
        lines.push("\n■ 입력 필요");
        result.입력필요.forEach((n) => lines.push(`  ${n}`));
      }

      lines.push("\n■ 평가포인트");
      result.평가포인트.forEach((p) => lines.push(`  • ${p}`));

      lines.push(`\n도식: ${renderedCharts.length}개 생성 (SVG 포함 structuredContent 참조)`);
      lines.push(`고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        pest: result.pest,
        시장규모: result.시장규모,
        경쟁비교표: result.경쟁비교.표,
        정성적경고: result.경쟁비교.정성적경고,
        charts: renderedCharts.map((c) => ({ kind: c.spec.kind, svg: c.svg ?? "", 입력필요: c.입력필요 })),
        입력필요: result.입력필요,
        평가포인트: result.평가포인트,
        고지: result.고지,
      });
    }
  );

  // ⑦ build_roadmap — 마일스톤 4축 타임라인·자금 징검다리·로드맵 도식
  server.registerTool(
    "build_roadmap",
    {
      title: "성장 로드맵 생성 (4축 타임라인·자금 징검다리·시장변화)",
      description:
        "마일스톤 4축(아이템·자금·마케팅·운영)을 시간 순서가 아닌 인과 사슬로 엮은 로드맵을 생성합니다. " +
        "과거준비(완료 상태)와 미래계획을 하나의 타임라인으로 통합하고, 자금 징검다리(예창패→초창패→TIPS)를 " +
        "지식베이스와 매칭합니다. 1·3·5·7년 시장변화 서술 골격과 로드맵 도식(SVG)을 포함합니다. " +
        "매출 수치는 임의로 채우지 않으며, 창업자가 제공해야 합니다.",
      inputSchema: buildRoadmapShape,
    },
    async (args): Promise<CallToolResult> => {
      const input: RoadmapInput = {
        사업명: args.사업명,
        거점: args.거점,
        과거준비: args.과거준비,
        미래계획: args.미래계획 as RoadmapInput["미래계획"],
        자금계획: args.자금계획,
      };

      const result = buildRoadmap(input);

      // 로드맵 차트 SVG 렌더(svg가 "" 이면 렌더 수행)
      const chartSvg = result.chart.svg
        ? result.chart.svg
        : (renderAll([result.chart])[0]?.svg ?? "");

      // 사람이 읽는 한국어 요약
      const lines: string[] = ["[성장 로드맵]"];

      lines.push("\n■ 타임라인 (시점 오름차순)");
      result.타임라인.forEach((t) =>
        lines.push(`[${t.시점}] [${t.축}] ${t.내용} (${t.상태})\n  인과: ${t.인과}`)
      );

      lines.push("\n■ 자금 징검다리");
      result.자금징검다리.forEach((f) =>
        lines.push(`[${f.시점}] ${f.프로그램} (${f.종류})${f.비고 ? " — " + f.비고 : ""}`)
      );

      lines.push("\n■ 시장변화 서술 (1·3·5·7년)");
      result.시장변화서술.forEach((s) => lines.push(`  ${s}`));

      if (result.입력필요.length > 0) {
        lines.push("\n■ 입력 필요");
        result.입력필요.forEach((n) => lines.push(`  ${n}`));
      }

      lines.push("\n■ 평가포인트");
      result.평가포인트.forEach((p) => lines.push(`  • ${p}`));

      lines.push(`\n도식: 로드맵 SVG ${chartSvg ? "생성됨" : "생성실패"} (structuredContent 참조)`);
      lines.push(`고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        타임라인: result.타임라인,
        자금징검다리: result.자금징검다리,
        시장변화서술: result.시장변화서술,
        chart: { kind: result.chart.spec.kind, svg: chartSvg, 입력필요: result.chart.입력필요 },
        입력필요: result.입력필요,
        평가포인트: result.평가포인트,
        고지: result.고지,
      });
    }
  );

  // ⑧ draft_section — 특정 PSST 섹션 초안(창업자 입력을 규칙으로 구조화)
  server.registerTool(
    "draft_section",
    {
      title: "PSST 섹션 초안 작성",
      description:
        "창업자가 제공한 사실(수치·실적·기관명)을 해당 PSST 섹션 규칙으로 구조화해 초안을 생성합니다. " +
        "섹션 선택: P=문제인식 / S1=실현가능성 / S2=성장전략 / T=팀구성. " +
        "단락 상단 핵심 요약(■ 2~3줄), 본문 구조화, 0점 답변 경고, 추천 도식 종류를 반환합니다. " +
        "빠진 사실은 '[입력 필요]'로 표시하고 임의로 채우지 않습니다.",
      inputSchema: draftSectionShape,
    },
    async (args): Promise<CallToolResult> => {
      const input: DraftSectionInput = {
        section: args.section as PsstKey,
        inputs: args.inputs,
      };

      const result = draftSection(input);

      // 사람이 읽는 한국어 요약
      const lines: string[] = [`[PSST 섹션 초안] ${result.section} — ${result.한글명}`];

      if (result.요약.length > 0) {
        lines.push("\n상단 핵심 요약 (■ 2~3줄):");
        result.요약.forEach((s) => lines.push(s));
      }

      lines.push("\n본문 구조화:");
      lines.push(result.본문 || "(본문 없음 — inputs를 채워주세요)");

      if (result.경고.length > 0) {
        lines.push("\n⚠️ 경고:");
        result.경고.forEach((w) => lines.push(`  • ${w}`));
      }

      if (result.입력필요.length > 0) {
        lines.push("\n입력 필요:");
        result.입력필요.forEach((n) => lines.push(`  ${n}`));
      }

      lines.push(`\n추천 도식: ${result.추천도식.join(", ")}`);
      lines.push(`고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        section: result.section,
        한글명: result.한글명,
        요약: result.요약,
        본문: result.본문,
        입력필요: result.입력필요,
        경고: result.경고,
        추천도식: result.추천도식,
        고지: result.고지,
      });
    }
  );

  // ⑨ plan_review — 사업계획서 전체 체크리스트 점검
  server.registerTool(
    "plan_review",
    {
      title: "사업계획서 체크리스트 점검",
      description:
        "정부지원 사업계획서 절대 규칙 체크리스트 10항목으로 사업계획서를 점검합니다. " +
        "0점 답변 패턴(아직 없다/최초/선점/지원해주면), 정성적 경쟁비교 표현, 단락 요약(■) 유무를 " +
        "자동 판정하고, 나머지는 '확인필요'로 안내합니다. 치명경고·점수(참고용)를 포함합니다.",
      inputSchema: planReviewShape,
    },
    async (args): Promise<CallToolResult> => {
      // sections 또는 fullText 중 하나라도 있어야 의미 있는 판정 가능
      if (!args.sections && !args.fullText) {
        return errorResult(
          "sections(섹션별 텍스트) 또는 fullText(전체 본문) 중 하나는 입력해야 합니다. " +
          "예: plan_review({sections: {P: '문제인식 내용...', S1: '...'}}) 또는 plan_review({fullText: '전체 본문...'})"
        );
      }

      const result = reviewChecklist({
        sections: args.sections,
        fullText: args.fullText,
      });

      // 사람이 읽는 한국어 요약
      const lines: string[] = [
        "[사업계획서 체크리스트 점검]",
        `점수(참고): ${result.점수}점 (자동 판정 항목 기준 — 확인필요 항목 제외)`,
      ];

      if (result.치명경고.length > 0) {
        lines.push("\n🚨 치명 경고:");
        result.치명경고.forEach((w) => lines.push(`  • ${w}`));
      }

      lines.push("\n■ 항목별 결과:");
      result.항목.forEach((item) => {
        const mark = item.통과 === true ? "✅" : item.통과 === false ? "❌" : "⚠️";
        lines.push(`${mark} ${item.항목}\n   └ ${item.근거}`);
      });

      lines.push(`\n고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        점수: result.점수,
        항목: result.항목,
        치명경고: result.치명경고,
        고지: result.고지,
      });
    }
  );

  // ⑩ hwp_layout — HWP 분량 진단·단축키표·가독성 원칙
  server.registerTool(
    "hwp_layout",
    {
      title: "HWP 레이아웃 가이드 (분량 진단·단축키·가독성)",
      description:
        "한글(HWP) 사업계획서의 분량(페이지 수)을 진단하고 초과/부족별 조정 제안, " +
        "단축키표(자간·줄간격·표 조작), 가독성 원칙을 제공합니다. " +
        "현재글자수가 없으면 진단 불가 안내와 함께 단축키표·원칙만 반환합니다. " +
        "페이지 추정은 한글 A4 본문 기준 가정값(1100~1600자/페이지)이며, 실제와 다를 수 있습니다.",
      inputSchema: hwpLayoutShape,
    },
    async (args): Promise<CallToolResult> => {
      const input: HwpLayoutInput = {
        목표페이지: args.목표페이지,
        현재글자수: args.현재글자수,
        섹션별글자수: args.섹션별글자수,
      };

      const result = buildHwpLayout(input);

      // 사람이 읽는 한국어 요약
      const lines: string[] = [
        "[HWP 레이아웃 가이드]",
        `진단: ${result.진단}`,
        `페이지 추정: ${result.페이지추정}`,
        "",
        "■ 조정 제안:",
      ];
      result.조정제안.forEach((p) => {
        lines.push(`  문제: ${p.문제}`);
        lines.push(`  조치: ${p.조치}${p.단축키 ? ` (단축키: ${p.단축키})` : ""}`);
        lines.push("");
      });

      lines.push("■ 단축키표:");
      result.단축키표.forEach((k) => lines.push(`  ${k.기능}: ${k.단축키}`));

      lines.push("\n■ 가독성 원칙:");
      result.가독성원칙.forEach((p) => lines.push(`  • ${p}`));

      lines.push(`\n고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        진단: result.진단,
        조정제안: result.조정제안,
        단축키표: result.단축키표,
        가독성원칙: result.가독성원칙,
        페이지추정: result.페이지추정,
        고지: result.고지,
      });
    }
  );

  // ⑪ recommend_grants — 창업자 프로필 기반 공고 적합도 랭킹 추천
  server.registerTool(
    "recommend_grants",
    {
      title: "공고 적합도 추천 (키워드·지역·단계·업종 기반 랭킹)",
      description:
        "창업자 프로필(키워드·지역·단계·업종·마감임박)을 입력하면 스토어 공고를 " +
        "적합도(0~100) 순으로 랭킹해 추천합니다. " +
        "마감된 공고는 자동 제외하며, 빈 입력 시 폴백 목록과 입력필요 안내를 반환합니다. " +
        "추천은 수집된 공고(출처·기준시점 표기) 기반이며, 적합도는 참고용입니다. " +
        "창업자 사실은 지어내지 않으며, 누락 항목은 '[입력 필요]'로 안내합니다.",
      inputSchema: recommendGrantsShape,
    },
    async (args): Promise<CallToolResult> => {
      const input: RecommendInput = {
        키워드: args.키워드,
        지역: args.지역,
        단계: args.단계 as RecommendInput["단계"],
        업종: args.업종,
        deadline_within_days: args.deadline_within_days,
        limit: args.limit,
      };

      const now = new Date();
      const result = recommendGrants(input, now);

      // 사람이 읽는 한국어 추천 목록 텍스트
      const lines: string[] = [
        "[공고 적합도 추천]",
        `기준시점: ${result.기준시점} (출처: ${result.출처})`,
        `추천 ${result.추천.length}건`,
      ];

      if (result.입력필요 && result.입력필요.length > 0) {
        lines.push("\n■ 더 정밀한 추천을 위해 입력해 주세요:");
        result.입력필요.forEach((h) => lines.push(`  • ${h}`));
      }

      if (result.추천.length === 0) {
        lines.push("\n조건에 맞는 공고가 없습니다. 키워드·지역·단계 조건을 완화하거나 find_grants를 이용해보세요.");
      } else {
        lines.push("");
        result.추천.forEach((item, i) => {
          lines.push(`[${i + 1}] 적합도 ${item.적합도}/100 — ${item.제목}`);
          lines.push(`    주관: ${item.주관기관}${item.지역 ? ` | 지역: ${item.지역}` : ""}${item.업력요건 ? ` | 업력: ${item.업력요건}` : ""}`);
          if (item.마감일) lines.push(`    마감: ${item.마감일}`);
          if (item.매칭이유.length > 0) lines.push(`    매칭이유: ${item.매칭이유.join(", ")}`);
          lines.push(`    id: ${item.id} | ${item.원문URL}`);
        });
      }

      lines.push(`\n고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        기준시점: result.기준시점,
        출처: result.출처,
        추천: result.추천,
        입력필요: result.입력필요 ?? null,
        고지: result.고지,
      });
    }
  );

  // ⑫ required_inputs — 사업계획서 최소 필요 정보 질문 목록
  server.registerTool(
    "required_inputs",
    {
      title: "사업계획서 최소 필요 정보 질문 목록 (PSST 섹션별)",
      description:
        "사업계획서 작성에 앞서 창업자에게 반드시 받아야 할 사실 항목(수치·실적·기관명)을 " +
        "PSST 섹션별(P·S1·S2·T) 질문으로 안내합니다. " +
        "grant_id가 있으면 해당 공고의 업력요건·마감일 기준 유의 질문을 추가합니다. " +
        "provided에 이미 제공한 정보를 넣으면 해당 질문을 '제공됨'으로 표시합니다. " +
        "창업자의 사실을 지어내지 않으며, 질문만 생성합니다.",
      inputSchema: requiredInputsShape,
    },
    async (args): Promise<CallToolResult> => {
      const result = requiredInputs({
        grant_id: args.grant_id,
        provided: args.provided,
      });

      // 사람이 읽는 한국어 요약 텍스트
      const lines: string[] = [
        "[사업계획서 최소 필요 정보 질문 목록]",
        result.grant_id ? `공고: ${result.grant_id}` : "공고 미선택(표준 PSST 질문)",
      ];

      if (result.우선질문.length > 0) {
        lines.push("\n■ 우선 확인 질문 (미제공 항목 우선):");
        result.우선질문.forEach((q, i) => lines.push(`  ${i + 1}. ${q}`));
      }

      // 섹션별 질문 그룹화
      const 섹션그룹: Record<string, typeof result.질문목록> = {};
      for (const q of result.질문목록) {
        if (!섹션그룹[q.섹션]) 섹션그룹[q.섹션] = [];
        섹션그룹[q.섹션].push(q);
      }
      for (const [섹션, 목록] of Object.entries(섹션그룹)) {
        lines.push(`\n■ [${섹션}] 섹션 질문:`);
        목록.forEach((q) => {
          const 상태표시 = q.상태 === "제공됨" ? "[제공됨]" : "[필요]";
          lines.push(`  ${상태표시} ${q.질문}`);
          lines.push(`        이유: ${q.이유}`);
        });
      }

      lines.push(`\n고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        grant_id: result.grant_id ?? null,
        우선질문: result.우선질문,
        질문목록: result.질문목록,
        고지: result.고지,
      });
    }
  );

  // ⑬ assemble_plan — PSST 섹션·도식을 정부 양식 순서로 전체 사업계획서 합본
  server.registerTool(
    "assemble_plan",
    {
      title: "사업계획서 전체 합본 (PSST 섹션·도식 → 정부 양식 순서)",
      description:
        "PSST 4섹션(P·S1·S2·T) 본문과 도식(charts)을 정부 양식 순서로 조립해 " +
        "전체 사업계획서 마크다운을 생성합니다. " +
        "합쳐진 본문에 대해 정부지원 사업계획서 절대 체크리스트(0점답변·정성표현 등)를 자동 점검하고, " +
        "목표페이지 대비 분량(초과/부족/적정)을 진단합니다. " +
        "비어있는 섹션은 '[입력 필요]'로 표시하며 임의로 채우지 않습니다. " +
        "도식 카탈로그(knowledge.ts)에 없는 kind는 부록으로 처리합니다.",
      inputSchema: assemblePlanShape,
    },
    async (args): Promise<CallToolResult> => {
      // args.charts는 zod 검증 후 { kind, svg? }[] 형태
      const charts: AssembleChart[] = (args.charts ?? []).map((c) => ({
        kind: c.kind,
        svg: c.svg,
      }));

      const input: AssembleInput = {
        grant_id: args.grant_id,
        sections: {
          P: args.sections.P,
          S1: args.sections.S1,
          S2: args.sections.S2,
          T: args.sections.T,
        },
        목표페이지: args.목표페이지,
        charts,
      };

      const result = assemblePlan(input);

      // 사람이 읽는 한국어 요약 텍스트 (문서 전문은 structuredContent에)
      const lines: string[] = [
        "[사업계획서 합본 결과]",
        `분량 진단: ${result.분량.진단} (페이지 추정: ${result.분량.페이지추정})`,
        `체크리스트 점수(참고): ${result.점검.점수}점`,
      ];

      if (result.점검.치명경고.length > 0) {
        lines.push("\n치명 경고:");
        result.점검.치명경고.forEach((w) => lines.push(`  • ${w}`));
      }

      if (result.분량.조정제안.length > 0) {
        lines.push("\n■ 분량 조정 제안:");
        result.분량.조정제안.forEach((p) => {
          lines.push(`  문제: ${p.문제}`);
          lines.push(`  조치: ${p.조치}${p.단축키 ? ` (단축키: ${p.단축키})` : ""}`);
        });
      }

      if (result.입력필요.length > 0) {
        lines.push(`\n■ 입력 필요 항목 ${result.입력필요.length}건 (아래 채우면 합본 재실행):`);
        result.입력필요.forEach((n) => lines.push(`  ${n}`));
      }

      lines.push("\n■ 합본 문서 (마크다운 전문은 structuredContent.문서 참조)");
      // 앞 500자만 미리보기로 표시
      const 미리보기 = result.문서.slice(0, 500) + (result.문서.length > 500 ? "\n...(이하 생략 — structuredContent.문서에서 전체 확인)" : "");
      lines.push(미리보기);

      lines.push(`\n고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        문서: result.문서,
        점검: result.점검,
        분량: {
          진단: result.분량.진단,
          페이지추정: result.분량.페이지추정,
          조정제안: result.분량.조정제안,
        },
        입력필요: result.입력필요,
        고지: result.고지,
      });
    }
  );

  // ⑭ locate_form_source — 공고 서식 출처 안내(파일을 대신 받아오지 않음)
  server.registerTool(
    "locate_form_source",
    {
      title: "공고 서식 출처 안내 (원문 URL 안내 — 자동 다운로드 없음)",
      description:
        "선택한 공고(grant_id)의 원문 공고 URL과 서식(HWP) 입수·전달 방법을 안내합니다. " +
        "이 도구는 파일을 대신 내려받지 않습니다. HWP 파일은 AI가 직접 읽기 어려우므로 " +
        "①첨부 지원 채팅에서는 PDF로 변환해 올리기(가장 잘 인식) ②첨부가 안 되는 채팅에서는 내용 전체 복사해 붙여넣기 " +
        "를 사용자에게 안내하세요. 완성본은 DOCX 파일로 제공됩니다.",
      inputSchema: locateFormSourceShape,
    },
    async (args): Promise<CallToolResult> => {
      const g = getGrant(args.grant_id);
      if (!g) return grantNotFound(args.grant_id);

      const lines: string[] = [
        "[공고 서식 출처 안내]",
        `공고: ${g.제목} (${g.주관기관})`,
        `원문URL: ${g.원문URL}`,
        "",
        "※ 이 도구는 파일을 대신 받아오지 않습니다. 위 원문URL에서 사업계획서 서식(보통 HWP 파일)을 내려받으세요.",
        "",
        "HWP 파일은 AI가 직접 읽기 어렵습니다. 편한 방법으로 서식을 전달해 주세요:",
        "  ① 이 채팅이 파일 첨부를 지원하면 — 한글에서 [파일 > PDF로 저장] 후 그 PDF를 올려주세요(가장 잘 인식).",
        "  ② 첨부가 안 되는 채팅이면 — 한글(또는 무료 한컴오피스 뷰어)에서 전체 선택(Ctrl+A)·복사(Ctrl+C)해",
        "     내용을 그대로 붙여넣어 주세요. 어느 쪽이든 동일하게 분석됩니다.",
        "전달해 주시면 칸을 분석해 내용을 만들어 드리고, 완성본은 DOCX 파일로 제공됩니다",
        "(한글에서 열어 HWP로 저장하거나, 원본 양식에 붙여넣어 마무리하시면 됩니다).",
      ];

      return textResult(lines.join("\n"), {
        grant_id: g.id,
        제목: g.제목,
        주관기관: g.주관기관,
        원문URL: g.원문URL,
        안내: "파일을 대신 받아오지 않습니다. HWP는 ①첨부 지원 채팅에선 PDF 변환 업로드(가장 잘 인식) ②아니면 내용 전체복사→붙여넣기. 완성본은 DOCX로 제공.",
        출처: g.source,
        수집시점: g.collected_at?.slice(0, 10) ?? null,
      });
    }
  );

  // ⑮ analyze_form — 붙여넣은 서식 텍스트를 필드·질문 목록으로 분석
  server.registerTool(
    "analyze_form",
    {
      title: "서식 분석 (붙여넣은 서식 텍스트 → 칸·질문 목록)",
      description:
        "창업자가 공고 서식(hwp/hwpx 등)에서 복사해 붙여넣은 텍스트를 분석해, " +
        "서식의 각 칸(필드)이 무엇을 요구하는지 원래 등장 순서 그대로 구조화합니다. " +
        "표·서술·자금표·체크 유형을 판정하고 PSST 섹션 매핑, 각 칸에 필요한 사실을 묻는 질문을 함께 반환합니다. " +
        "서식으로 보이지 않는 텍스트는 정중히 재요청하며, 창업자의 답을 지어내지 않습니다.",
      inputSchema: analyzeFormShape,
    },
    async (args): Promise<CallToolResult> => {
      const input: FormAnalysisInput = {
        form_text: args.form_text,
        grant_id: args.grant_id,
      };
      const result = analyzeFormText(input);

      if (result.오류) {
        // 서식 인식 실패 — isError로 취급하지 않고 정중한 재요청 텍스트를 그대로 노출.
        return textResult(`[서식 분석] ${result.오류}`, {
          grant_id: result.grant_id ?? null,
          오류: result.오류,
          필드목록: [],
          감지요약: result.감지요약,
          입력필요: [],
          고지: result.고지,
        });
      }

      const lines: string[] = [
        "[서식 분석 결과]",
        result.감지요약,
        "",
        "■ 칸 목록 (서식 등장 순서):",
      ];
      result.필드목록.forEach((f) => {
        lines.push(`${f.순번}. [${f.유형}] ${f.칸이름}${f.psst매핑 ? ` (PSST ${f.psst매핑})` : ""}`);
        if (f.안내문구) lines.push(`   안내: ${f.안내문구}`);
        lines.push(`   질문: ${f.질문}`);
      });
      lines.push(`\n고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        grant_id: result.grant_id ?? null,
        필드목록: result.필드목록,
        감지요약: result.감지요약,
        입력필요: result.입력필요,
        고지: result.고지,
      });
    }
  );

  // ⑯ compose_application — 서식 칸별 답변을 유형별 규칙으로 조립(서식 순서 보존)
  server.registerTool(
    "compose_application",
    {
      title: "제출용 문서 조립 (서식 칸별 답변 → 붙여넣기용 본문, 원래 순서 보존)",
      description:
        "analyze_form이 찾아낸 서식 칸에 창업자의 답변을 채워, 칸 유형별 작성 규칙(표/서술/자금표/체크)으로 " +
        "정돈된 붙여넣기용 문서를 조립합니다. 서식의 원래 칸 순서를 그대로 보존합니다(PSST 순서 재배열 없음). " +
        "0점답변·정성적 표현 경고, 자금표 합계 자동검증, 답변 없는 칸의 다음 질문을 함께 반환합니다. " +
        "체크(서명) 칸은 자동 완성할 수 없어 항상 확인필요로 표시합니다.",
      inputSchema: composeApplicationShape,
    },
    async (args): Promise<CallToolResult> => {
      const fields: ComposeField[] = args.fields.map((f) => ({
        칸이름: f.칸이름,
        유형: f.유형,
        psst매핑: f.psst매핑,
        답변: f.답변,
      }));
      const input: ComposeInput = {
        fields,
        grant_id: args.grant_id,
        사업아이템명: args.사업아이템명,
      };
      const result = composeApplication(input);

      const lines: string[] = ["[제출용 문서 조립 결과]"];
      if (args.사업아이템명) lines.push(`아이템명: ${args.사업아이템명}`);

      lines.push("\n■ 칸별 결과:");
      result.문서칸.forEach((c) => {
        const mark = c.상태 === "완성" ? "✅" : c.상태 === "입력필요" ? "☐" : "⚠️";
        lines.push(`${mark} [${c.상태}] ${c.칸이름}`);
      });

      if (result.경고.length > 0) {
        lines.push("\n⚠️ 경고:");
        result.경고.forEach((w) => lines.push(`  • ${w}`));
      }

      if (result.미완성.length > 0) {
        lines.push(`\n■ 입력 필요 칸 (${result.미완성.length}개):`);
        result.미완성.forEach((n) => lines.push(`  - ${n}`));
      }

      if (result.다음질문.length > 0) {
        lines.push("\n■ 다음 질문:");
        result.다음질문.forEach((q, i) => lines.push(`  ${i + 1}. ${q}`));
      }

      if (result.자금검증) {
        const fv = result.자금검증;
        lines.push("\n■ 자금 검증:");
        lines.push(`  자동합계: ${fv.합계.toLocaleString("en-US")}원`);
        if (fv.표기합계 !== undefined) {
          lines.push(`  표기합계: ${fv.표기합계.toLocaleString("en-US")}원 — 일치여부: ${fv.일치여부 ? "일치" : "불일치"}`);
        }
      }

      lines.push("\n■ 전체 문서 (structuredContent.전체텍스트 참조)");
      const 미리보기 = result.전체텍스트.slice(0, 500) + (result.전체텍스트.length > 500 ? "\n...(이하 생략)" : "");
      lines.push(미리보기);

      lines.push(`\n고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        문서칸: result.문서칸,
        전체텍스트: result.전체텍스트,
        미완성: result.미완성,
        경고: result.경고,
        다음질문: result.다음질문,
        자금검증: result.자금검증 ?? null,
        고지: result.고지,
      });
    }
  );

  // ⑰ export_document — 문서를 다운로드 가능한 파일(docx/txt)로 변환
  server.registerTool(
    "export_document",
    {
      title: "문서 내보내기 (docx/txt 다운로드 링크 + 전문 폴백)",
      description:
        "제목과 섹션(칸이름·내용) 목록을 받아 다운로드 가능한 문서 파일(docx 기본, txt 선택)로 변환합니다. " +
        "응답에는 항상 (a) 가능하면 다운로드 URL(30분 후 만료), (b) 전체 문서 텍스트 전문, " +
        "(c) 링크가 안 열릴 때를 위한 전문 복사 안내가 함께 포함됩니다. " +
        "HTTP(웹) 배포 환경이 아니면(로컬/stdio) 다운로드 URL 없이 전문만 제공됩니다.",
      inputSchema: exportDocumentShape,
    },
    async (args): Promise<CallToolResult> => {
      const format = args.format ?? "docx";
      const 제목 = args.제목;
      const sections = args.sections;

      const 전체텍스트 = sections.map((s) => `## ${s.칸이름}\n${s.내용}`).join("\n\n");
      const 파일명base = sanitizeFilename(제목);

      let token: string;
      let expiresAt: number;
      let mime: string;
      let 파일명: string;

      try {
        if (format === "txt") {
          const buf = Buffer.from(`${제목}\n\n${전체텍스트}`, "utf-8");
          mime = "text/plain; charset=utf-8";
          파일명 = `${파일명base}.txt`;
          ({ token, expiresAt } = putFile(파일명, buf, mime));
        } else {
          const buf = await buildDocx(제목, sections);
          mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          파일명 = `${파일명base}.docx`;
          ({ token, expiresAt } = putFile(파일명, buf, mime));
        }
      } catch (err) {
        return errorResult(
          `문서 생성에 실패했습니다: ${err instanceof Error ? err.message : String(err)}. ` +
          "sections 내용을 확인하고 다시 시도하세요. 급하면 format을 'txt'로 바꿔보세요."
        );
      }

      const url = buildDownloadUrl(token);
      const 만료분 = Math.round((expiresAt - Date.now()) / 60000);

      const lines: string[] = [
        "[문서 내보내기 결과]",
        `파일명: ${파일명} (형식: ${format})`,
      ];
      if (url) {
        lines.push(`다운로드 URL: ${url} (약 ${만료분}분 후 만료)`);
      } else {
        lines.push("다운로드 URL: 로컬 모드 — 아래 전문 사용 (HTTP 배포 환경이 아니면 링크가 제공되지 않습니다)");
      }
      lines.push("※ 링크가 안 열리면 이 전문을 복사해 쓰세요 · 30분 후 만료");
      lines.push("\n■ 전체 문서 전문:");
      lines.push(전체텍스트);

      return textResult(lines.join("\n"), {
        파일명,
        format,
        다운로드URL: url,
        만료시각: new Date(expiresAt).toISOString(),
        전체텍스트,
        안내: "링크가 안 열리면 이 전문을 복사해 쓰세요 · 30분 후 만료",
        고지: 작성고지,
      });
    }
  );

  // ⑱ upgrade_request — 요청 업그레이드 오케스트레이터
  server.registerTool(
    "upgrade_request",
    {
      title: "요청 업그레이드 (짧은 요청 → 확장 플랜 제안)",
      description:
        "사용자의 짧은 요청(예: '인천 AI 창업 공고 찾아줘')을 결정적 규칙으로 분석해, " +
        "의도(공고찾기/자격확인/서류작성/계획서작성/시장조사/로드맵/복합/기타)를 분류하고 " +
        "지역·업종·단계 신호를 추출해 기존 17개 tool을 잇는 확장 실행 플랜으로 증폭합니다. " +
        "가능하면 공고 검색 결과를 미리 붙여 보여주고, 꼭 필요한 것만 1~2개 확인 질문을 함께 냅니다. " +
        "요청이 이미 구체적이면(공고 id·도구명 지정·조건 3개 이상) '바로실행'으로 표시하고 업그레이드 없이 즉시 진행을 권장합니다. " +
        "사용자 사실은 추정해 채우지 않으며, 합격선(기본 70)은 참고값이고 실제 합격선은 공고 원문으로 확인해야 합니다.",
      inputSchema: upgradeRequestShape,
    },
    async (args): Promise<CallToolResult> => {
      const input: UpgradeInput = { 요청: args.요청, 맥락: args.맥락 };
      const result = upgradeRequest(input);

      // 프리뷰 병행 실행: '공고찾기'류 의도에서만, 사용자 사실 없이도 안전하게 미리 보여줄 수 있는
      // find_grants/recommend_grants 결과를 최대 3건 첨부한다(upgrade.ts는 순수 계획만 담당 — 실호출은 여기서).
      let 미리보기: Array<{ id: string; 제목: string; 주관기관: string; 마감일: string | null }> = [];
      let 미리보기건수 = 0;
      const 프리뷰가능 = ["공고찾기", "복합", "기타"].includes(result.의도);
      if (프리뷰가능 && !result.바로실행) {
        try {
          const now = new Date();
          const s = result.신호;
          const 추천 = recommendGrants(
            {
              키워드: s.업종.length ? s.업종 : undefined,
              지역: s.지역 ?? undefined,
              단계: s.단계 ?? undefined,
              limit: 3,
            },
            now
          );
          미리보기건수 = 추천.추천.length;
          미리보기 = 추천.추천.slice(0, 3).map((g) => ({
            id: g.id,
            제목: g.제목,
            주관기관: g.주관기관,
            마감일: g.마감일 ?? null,
          }));
        } catch {
          // 프리뷰 실패는 치명 아님 — 플랜 자체는 그대로 반환(조용히 죽지 않기, 부분응답)
          미리보기 = [];
          미리보기건수 = 0;
        }
      }

      const lines: string[] = [`[요청 업그레이드] 의도: ${result.의도}${result.바로실행 ? " (바로실행 권장)" : ""}`];
      result.업그레이드요약.forEach((l) => lines.push(l));
      if (미리보기.length > 0) {
        lines.push(`\n■ 지금 바로 ${미리보기건수}건이 매칭됩니다(미리보기 ${미리보기.length}건):`);
        미리보기.forEach((g, i) => {
          lines.push(`  [${i + 1}] ${g.제목} — ${g.주관기관}${g.마감일 ? ` (마감 ${g.마감일})` : ""} | id: ${g.id}`);
        });
      }
      lines.push(`\n■ 확장 플랜:`);
      result.확장플랜.forEach((p) => {
        lines.push(`  ${p.순번}) ${p.행동}${p.도구 ? ` [${p.도구}]` : ""} — ${p.이유}`);
      });
      lines.push(`\n■ 품질기준:`);
      result.품질기준.forEach((q) => lines.push(`  • ${q}`));
      if (result.추가질문.length > 0) {
        lines.push(`\n■ 추가 확인:`);
        result.추가질문.forEach((q) => lines.push(`  - ${q}`));
      }
      lines.push(`\n${result.승인요청}`);
      lines.push(`\n고지: ${result.고지}`);

      return textResult(lines.join("\n"), {
        의도: result.의도,
        바로실행: result.바로실행,
        업그레이드요약: result.업그레이드요약,
        확장플랜: result.확장플랜,
        품질기준: result.품질기준,
        추가질문: result.추가질문,
        승인요청: result.승인요청,
        업그레이드프롬프트: result.업그레이드프롬프트,
        신호: result.신호,
        미리보기: 미리보기,
        미리보기건수,
        고지: result.고지,
        승인후_재호출불필요: result.승인후_재호출불필요,
      });
    }
  );
}
