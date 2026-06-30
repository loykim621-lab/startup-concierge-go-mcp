/** 날짜 유틸 — 달력상 유효한 YYYY-MM-DD인지 엄격 검증(형식+실재 날짜). */
export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map((v) => parseInt(v, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // 실제 달력 날짜인지(2월 30일·13월 등 정규화로 인한 오판 차단)
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
