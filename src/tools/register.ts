/**
 * 10개 MCP tool 등록 — 기존 4종 + 사업계획서 작성 지원 6종.
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
} from "../lib/schemas.js";
import { getGrant, queryGrants, loadStore } from "../data/store.js";
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
      const shown = matched.slice(0, limit);
      const store = loadStore();
      const asOf = store.collected_at?.slice(0, 10) || "수집정보 없음";
      let text = renderGrantList(shown, matched.length, asOf, now);
      if (확장노트) text = `※ 확장 검색: ${확장노트}\n\n${text}`;
      return textResult(text, {
        확장검색: 확장노트,
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
}
