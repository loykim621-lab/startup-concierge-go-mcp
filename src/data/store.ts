/**
 * 데이터 스토어 — 수집된 공고를 읽어 결정적으로 서빙(요청 시 외부호출 0).
 * 기본은 로컬 JSON(server/data/grants.json). SUPABASE_URL 설정 시 어댑터 확장 가능.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GrantRecord, GrantStoreFile } from "./types.js";

/** server/data/grants.json — src/와 dist/ 모두 루트 기준 2단계 상위 */
const GRANTS_FILE =
  process.env.GRANTS_FILE ?? fileURLToPath(new URL("../../data/grants.json", import.meta.url));

let _cache: GrantStoreFile | null = null;

export function loadStore(force = false): GrantStoreFile {
  if (_cache && !force) return _cache;
  if (!existsSync(GRANTS_FILE)) {
    _cache = { collected_at: "", source: "(빈 스토어)", count: 0, grants: [] };
    return _cache;
  }
  const raw = readFileSync(GRANTS_FILE, "utf-8");
  const parsed = JSON.parse(raw) as GrantStoreFile;
  _cache = parsed;
  return parsed;
}

export function saveStore(grants: GrantRecord[], source: string): GrantStoreFile {
  const file: GrantStoreFile = {
    collected_at: new Date().toISOString(),
    source,
    count: grants.length,
    grants,
  };
  mkdirSync(dirname(GRANTS_FILE), { recursive: true });
  writeFileSync(GRANTS_FILE, JSON.stringify(file, null, 2), "utf-8");
  _cache = file;
  return file;
}

/**
 * 런타임 갱신(자동 수집용) — 메모리 스토어를 원자적으로 교체하고,
 * 디스크 기록은 best-effort(컨테이너 읽기전용 등으로 실패해도 무시 — 메모리가 진실원).
 * 요청 경로는 계속 메모리에서 즉답하므로 갱신 중에도 응답 지연·불안정이 없다.
 */
export function refreshStore(
  grants: GrantRecord[],
  source: string,
  opts: { persist?: boolean } = {}
): GrantStoreFile {
  const file: GrantStoreFile = {
    collected_at: new Date().toISOString(),
    source,
    count: grants.length,
    grants,
  };
  _cache = file; // 원자적 참조 교체
  if (opts.persist !== false) {
    try {
      mkdirSync(dirname(GRANTS_FILE), { recursive: true });
      writeFileSync(GRANTS_FILE, JSON.stringify(file, null, 2), "utf-8");
    } catch {
      // 디스크 실패는 치명 아님 — 메모리 스토어로 계속 서빙
    }
  }
  return file;
}

export function getAllGrants(): GrantRecord[] {
  return loadStore().grants;
}

export function getGrant(id: string): GrantRecord | undefined {
  return loadStore().grants.find((g) => g.id === id);
}

export interface GrantQuery {
  keywords?: string;
  region?: string;
  stage?: "예비" | "초기" | "도약";
  industry?: string;
  deadline_within_days?: number;
  limit?: number;
}

const STAGE_KEYWORDS: Record<string, string[]> = {
  예비: ["예비", "예비창업"],
  초기: ["초기", "창업초기", "3년", "도약 전"],
  도약: ["도약", "7년", "스케일업"],
};

function daysUntil(deadline: string | undefined, today: Date): number | null {
  if (!deadline) return null;
  const [y, m, d] = deadline.split("-").map((s) => parseInt(s, 10));
  const dl = Date.UTC(y, m - 1, d);
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((dl - t) / 86_400_000);
}

export function queryGrants(q: GrantQuery, now: Date = new Date()): GrantRecord[] {
  const all = getAllGrants();
  const kw = q.keywords?.trim().toLowerCase();
  const stageWords = q.stage ? STAGE_KEYWORDS[q.stage] : undefined;

  const filtered = all.filter((g) => {
    const haystack = [g.제목, g.분야, g.지원대상, g.지원내용, g.업력요건, g.지역]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (kw && !kw.split(/\s+/).every((token) => haystack.includes(token))) return false;
    if (q.region && !(g.지역 ?? "").includes(q.region) && !haystack.includes(q.region.toLowerCase()))
      return false;
    if (q.industry && !haystack.includes(q.industry.toLowerCase())) return false;
    if (stageWords && !stageWords.some((w) => haystack.includes(w.toLowerCase()))) return false;
    if (q.deadline_within_days !== undefined) {
      const dd = daysUntil(g.마감일, now);
      if (dd === null || dd < 0 || dd > q.deadline_within_days) return false;
    }
    return true;
  });

  // 마감 임박순 (마감일 없는 건 뒤로)
  filtered.sort((a, b) => {
    const da = daysUntil(a.마감일, now);
    const db = daysUntil(b.마감일, now);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });

  return q.limit ? filtered.slice(0, q.limit) : filtered;
}

export { GRANTS_FILE, daysUntil };
