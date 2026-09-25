import fs from 'fs/promises';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import os from 'os';
import path from 'path';
import { extractDocxTextWithImages, resolvePastedImagePath } from './pastedImages';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const inlineImageRun = (relId: string) => `<w:r><w:drawing>
  <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
    <wp:extent cx="100" cy="100"/><wp:docPr id="1" name="gaiji"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:blipFill><a:blip r:embed="${relId}"/></pic:blipFill>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing></w:r>`;

const textRun = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

const writeDocx = async (paragraphs: string[]): Promise<string> => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="png" ContentType="image/png"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
    </Relationships>`,
  );
  zip.file('word/media/image1.png', PNG_BYTES);
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${paragraphs
      .map((paragraph) => `<w:p>${paragraph}</w:p>`)
      .join('')}</w:body></w:document>`,
  );

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grognard-docx-'));
  const filePath = path.join(dir, 'test.docx');
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
  return filePath;
};

describe('extractDocxTextWithImages', () => {
  test('marks each inline image in place and returns its bytes', async () => {
    const filePath = await writeDocx([
      textRun('天') + inlineImageRun('rIdImg') + textRun('地'),
      textRun('玄') + inlineImageRun('rIdImg'),
    ]);
    const result = await extractDocxTextWithImages(filePath);
    expect(result.text).toBe('天0地\n\n玄1\n\n');
    expect(result.images).toHaveLength(2);
    expect(result.images[0].contentType).toBe('image/png');
    expect(Buffer.from(result.images[0].bytes).equals(PNG_BYTES)).toBe(true);
  });

  test('matches mammoth.extractRawText exactly when there are no images', async () => {
    const filePath = await writeDocx([
      textRun('道可道，') + '<w:r><w:tab/></w:r>' + textRun('非常道。'),
      textRun('名可名'),
    ]);
    const raw = await mammoth.extractRawText({ path: filePath });
    const result = await extractDocxTextWithImages(filePath);
    expect(result.text).toBe(raw.value);
    expect(result.images).toEqual([]);
  });
});

describe('resolvePastedImagePath', () => {
  const tempDir = path.resolve(os.tmpdir());

  test("accepts Word's msohtmlclip files, including macOS's doubled slash", () => {
    expect(
      resolvePastedImagePath(
        'file:////Users/me/Library/Group%20Containers/UBF8T346G9.Office/TemporaryItems/msohtmlclip/clip_image001.png',
        tempDir,
      ),
    ).toBe(
      '/Users/me/Library/Group Containers/UBF8T346G9.Office/TemporaryItems/msohtmlclip/clip_image001.png',
    );
  });

  test('accepts images inside the temp dir', () => {
    const url = `file://${path.join(tempDir, 'paste', 'a.png')}`;
    expect(resolvePastedImagePath(url, tempDir)).toBe(path.join(tempDir, 'paste', 'a.png'));
  });

  test('rejects anything else', () => {
    expect(resolvePastedImagePath('file:///Users/me/Documents/secret.png', tempDir)).toBeNull();
    expect(resolvePastedImagePath(`file://${path.join(tempDir, 'notes.txt')}`, tempDir)).toBeNull();
    expect(
      resolvePastedImagePath(`file://${tempDir}/msohtmlclip/../../../etc/passwd.png`, tempDir),
    ).toBeNull();
    expect(resolvePastedImagePath('https://example.com/a.png', tempDir)).toBeNull();
  });
});
