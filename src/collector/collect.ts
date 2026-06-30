/**
 * 수집기 CLI — K-Startup 실데이터를 가져와 로컬 스토어(data/grants.json)에 적재.
 *   npm run collect            (실수집)
 *   DRY_RUN=true npm run collect  (외부호출 없이 현재 스토어 점검)
 *
 * 🟢 자율 허용(되돌릴 수 있는 로컬 작업). 외부 발송·배포 없음.
 */
import { fetchKstartup } from "./kstartup.js";
import { saveStore, loadStore, GRANTS_FILE } from "../data/store.js";

async function main() {
  const limit = parseInt(process.env.COLLECT_LIMIT ?? "200", 10);
  const dryRun = (process.env.DRY_RUN ?? "false").toLowerCase() === "true";

  if (dryRun) {
    const store = loadStore(true);
    console.log(`[DRY_RUN] 외부호출 없음. 현재 스토어: ${store.count}건 (수집시점 ${store.collected_at || "없음"})`);
    console.log(`스토어 파일: ${GRANTS_FILE}`);
    return;
  }

  console.log(`K-Startup 공식 API 수집 시작 (limit=${limit})...`);
  const t0 = Date.now();
  let grants;
  try {
    grants = await fetchKstartup(limit);
  } catch (e) {
    console.error(`수집 실패(파서 깨짐 의심): ${(e as Error).message}`);
    console.error("기존 스토어를 유지합니다.");
    process.exitCode = 1;
    return;
  }
  const file = saveStore(grants, "K-Startup");
  console.log(
    `완료: ${file.count}건 적재 (${Date.now() - t0}ms). 수집시점 ${file.collected_at}`
  );
  console.log(`저장: ${GRANTS_FILE}`);
  // 헬스체크: 0건이면 경고
  if (file.count === 0) {
    console.warn("⚠️ 수집 0건 — API 응답 변화 또는 모집중 공고 없음. 파서 점검 필요.");
  } else {
    const sample = file.grants[0];
    console.log(`샘플: [${sample.제목}] 마감 ${sample.마감일 ?? "미상"} / ${sample.원문URL}`);
  }
}

main();
