/**
 * DOCX 생성 — 'docx' 패키지로 제목/칸이름/내용 구조를 Word 문서 Buffer로 변환한다.
 *
 * 원칙:
 * - 제목은 Heading(Title), 각 칸이름은 Heading2, 내용은 문단(빈 줄로 문단 구분).
 * - 한글 폰트는 지정하지 않는다(뷰어 기본 폰트에 위임 — 환경별 폰트 미설치 문제 회피).
 * - 결정적 산출물: 타임스탬프 등 실행마다 달라지는 값을 삽입하지 않는다(같은 입력 → 같은 바이트는
 *   docx 내부 zip 압축 특성상 보장하지 않지만, 텍스트 내용에는 비결정 요소를 넣지 않는다).
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from "docx";

export interface DocxSection {
  칸이름: string;
  내용: string;
}

/**
 * 제목 + 섹션(칸이름·내용) 목록으로 DOCX Buffer를 생성한다.
 * 내용은 빈 줄(\n\n 이상 또는 단일 \n) 기준으로 문단을 나눠 삽입한다.
 */
export async function buildDocx(제목: string, sections: DocxSection[]): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: 제목 })],
    })
  );

  for (const { 칸이름, 내용 } of sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: 칸이름 })],
      })
    );

    const 문단들 = splitParagraphs(내용);
    if (문단들.length === 0) {
      children.push(new Paragraph({ children: [] }));
    } else {
      for (const p of 문단들) {
        children.push(new Paragraph({ children: [new TextRun({ text: p })] }));
      }
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}

/** 내용을 빈 줄 기준으로 문단 분리(빈 문자열 항목은 제거). 줄바꿈만 있으면 각 줄을 문단으로. */
function splitParagraphs(내용: string): string[] {
  const text = String(내용 ?? "");
  if (!text.trim()) return [];
  // 연속 개행(빈 줄)을 문단 구분자로 우선 사용.
  const byBlank = text.split(/\r?\n\s*\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  // 빈 줄 구분이 없으면 단일 줄바꿈 기준으로 분리.
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
