/**
 * K-Startup 공식 오픈 API 수집기 (martgo-monitor parsers/kstartup.py 패턴 이식).
 *
 * robots 정책 준수: HTML 목록은 Disallow 대상이나, 공식 API 호스트
 * nidapi.k-startup.go.kr 는 robots 전체 허용이며 인증키 불필요.
 * 정중한 수집: 1회 1요청, User-Agent 명시, 타임아웃.
 */
import type { GrantRecord } from "../data/types.js";
import type { GrantRequirements } from "../domain/types.js";
import { 기본결격조항, parse업력최대개월, 표준루브릭 } from "../data/defaults.js";

const API_URL =
  "https://nidapi.k-startup.go.kr/api/kisedKstartupService/v1/getAnnouncementInformation";
const SOURCE = "K-Startup";
const USER_AGENT = "startup-concierge-go/0.1 (+government grant concierge MCP)";
const TIMEOUT_MS = 25_000;

interface KstartupRow {
  pbanc_sn?: string | number;
  id?: string | number;
  biz_pbanc_nm?: string;
  detl_pg_url?: string;
  sprv_inst?: string;
  pbanc_ntrp_nm?: string;
  supt_biz_clsfc?: string;
  supt_regin?: string;
  biz_enyy?: string;
  aply_trgt?: string;
  aply_trgt_ctnt?: string;
  pbanc_ctnt?: string;
  rcrt_prgs_yn?: string;
  pbanc_rcpt_bgng_dt?: string;
  pbanc_rcpt_end_dt?: string;
}

/** YYYYMMDD → YYYY-MM-DD */
function fmtDate(v?: string | number): string | undefined {
  if (!v) return undefined;
  const s = String(v).replace(/\D/g, "");
  if (s.length !== 8) return undefined;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** 지역 문자열 정규화 → 허용지역 배열(전국이면 빈 배열=제한없음) */
function parseRegion(supt_regin?: string): string[] | undefined {
  if (!supt_regin) return undefined;
  const s = supt_regin.trim();
  if (!s || s.includes("전국")) return []; // 제한 없음
  return s
    .split(/[,·/]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 공고 행 → 확정 가능한 요건 파라미터(추측 금지: 모르면 미설정) */
function deriveRequirements(r: KstartupRow, 마감일?: string): GrantRequirements {
  const req: GrantRequirements = {
    창업확인: true,
    결격조항: { ...기본결격조항 },
  };
  const 최대 = parse업력최대개월(r.biz_enyy);
  if (최대 !== undefined) {
    req.업력 = { 최대_개월: 최대, 기준일: 마감일 };
  }
  const 지역 = parseRegion(r.supt_regin);
  if (지역 !== undefined && 지역.length > 0) {
    req.지역 = 지역;
  }
  return req;
}

function composeTarget(r: KstartupRow): string | undefined {
  const parts = [r.aply_trgt, r.aply_trgt_ctnt].filter(Boolean);
  return parts.length ? parts.join(" / ") : undefined;
}

export async function fetchKstartup(
  limit = 200,
  opts: { includeClosed?: boolean } = {}
): Promise<GrantRecord[]> {
  const url = `${API_URL}?page=1&perPage=${Math.max(1, Math.min(limit, 200))}&returnType=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let payload: { data?: KstartupRow[] };
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    payload = (await resp.json()) as { data?: KstartupRow[] };
  } finally {
    clearTimeout(timer);
  }

  const rows = payload.data ?? [];
  const collected_at = new Date().toISOString();
  const today = collected_at.slice(0, 10);
  const out: GrantRecord[] = [];

  for (const r of rows) {
    const sn = r.pbanc_sn ?? r.id;
    const 제목 = (r.biz_pbanc_nm ?? "").trim();
    if (!sn || !제목) continue;
    if (!opts.includeClosed && String(r.rcrt_prgs_yn ?? "").toUpperCase() !== "Y") continue;

    const 마감일 = fmtDate(r.pbanc_rcpt_end_dt);
    if (!opts.includeClosed && 마감일 && 마감일 < today) continue; // 마감 지난 공고 제외

    const url원문 =
      (r.detl_pg_url ?? "").trim() ||
      `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${sn}`;

    out.push({
      id: `kstartup:${sn}`,
      제목,
      주관기관: (r.sprv_inst ?? r.pbanc_ntrp_nm ?? "").trim() || "확인 불가",
      분야: (r.supt_biz_clsfc ?? "").trim() || undefined,
      지역: (r.supt_regin ?? "").trim() || undefined,
      업력요건: (r.biz_enyy ?? "").trim() || undefined,
      지원대상: composeTarget(r),
      지원내용: (r.pbanc_ctnt ?? "").trim() || undefined,
      마감일,
      접수시작: fmtDate(r.pbanc_rcpt_bgng_dt),
      원문URL: url원문,
      source: SOURCE,
      collected_at,
      requirements: deriveRequirements(r, 마감일),
      rubric: 표준루브릭,
    });
  }

  return out;
}
