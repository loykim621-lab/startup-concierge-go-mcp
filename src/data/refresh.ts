/**
 * 공고 자동 갱신 — 서버가 스스로 최신 공고를 수집한다(재빌드 불필요).
 *
 * 설계 원칙(안정성 최우선):
 * - 요청 경로는 절대 외부호출하지 않는다 — 갱신은 백그라운드에서만, 응답은 메모리 스토어에서 즉답.
 * - fail-safe: 수집 실패/0건이면 기존 데이터를 그대로 유지하고 경고만 남긴다(빈 스토어로 교체 금지).
 * - 기동 직후 1회 + AUTO_REFRESH_HOURS(기본 6시간)마다 반복. 0이면 비활성.
 * - 결정성: 같은 스냅샷 안에서는 같은 입력 → 같은 출력(스냅샷 교체 시점만 달라짐, 출력에 수집시점 표기).
 */
import { fetchKstartup } from "../collector/kstartup.js";
import { refreshStore, loadStore } from "./store.js";
import type { GrantRecord } from "./types.js";

export interface RefreshResult {
  ok: boolean;
  count?: number;
  error?: string;
}

export interface RefreshOptions {
  /** 수집 상한(기본 200) */
  limit?: number;
  /** 디스크 기록 여부(기본 true; 테스트는 false) */
  persist?: boolean;
  /** 수집기 주입(테스트용). 기본은 K-Startup 공식 API */
  fetcher?: () => Promise<GrantRecord[]>;
  /** 로그 싱크(기본 console.error — stdio 프로토콜과 충돌 방지) */
  log?: (msg: string) => void;
}

/** 1회 갱신 — 성공 시에만 스토어 교체, 실패·0건이면 기존 유지(fail-safe). */
export async function refreshOnce(opts: RefreshOptions = {}): Promise<RefreshResult> {
  const log = opts.log ?? ((m: string) => console.error(m));
  try {
    const fetcher = opts.fetcher ?? (() => fetchKstartup(opts.limit ?? 200));
    const grants = await fetcher();
    if (!grants || grants.length === 0) {
      log("[refresh] 수집 0건 — 기존 데이터 유지(파서 점검 필요 가능성)");
      return { ok: false, error: "수집 0건 — 기존 데이터 유지" };
    }
    const file = refreshStore(grants, "K-Startup", { persist: opts.persist });
    log(`[refresh] 공고 갱신 완료: ${file.count}건 (수집시점 ${file.collected_at})`);
    return { ok: true, count: file.count };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`[refresh] 수집 실패 — 기존 데이터 유지: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * 자동 갱신 시작 — 기동 직후 1회(비차단) + 주기 반복.
 * 반환된 타이머는 unref 처리되어 프로세스 종료를 막지 않는다.
 */
export function startAutoRefresh(opts: RefreshOptions & { intervalHours?: number } = {}):
  | NodeJS.Timeout
  | null {
  const log = opts.log ?? ((m: string) => console.error(m));
  const hours =
    opts.intervalHours ?? parseFloat(process.env.AUTO_REFRESH_HOURS ?? "6");
  if (!Number.isFinite(hours) || hours <= 0) {
    log("[refresh] 자동 갱신 비활성(AUTO_REFRESH_HOURS=0)");
    return null;
  }
  const current = loadStore();
  log(
    `[refresh] 자동 갱신 시작 — 현재 ${current.count}건(수집시점 ${current.collected_at || "없음"}), 주기 ${hours}시간`
  );
  // 기동 직후 1회 (서버 기동을 막지 않도록 비차단)
  void refreshOnce(opts);
  const timer = setInterval(() => void refreshOnce(opts), hours * 3_600_000);
  timer.unref?.();
  return timer;
}
