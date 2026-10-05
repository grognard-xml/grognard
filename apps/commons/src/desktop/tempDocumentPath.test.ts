import { isTempDocumentPath } from './tempDocumentPath';

describe('isTempDocumentPath', () => {
  it('matches the app temp layout on every platform', () => {
    expect(isTempDocumentPath('/var/folders/ab/T/grognard/1759500000000/untitled.xml')).toBe(true);
    expect(
      isTempDocumentPath(
        'C:\\Users\\me\\AppData\\Local\\Temp\\grognard\\1759500000000\\untitled.xml',
      ),
    ).toBe(true);
  });

  it('does not match real files inside a directory that happens to be called grognard', () => {
    expect(isTempDocumentPath('/Users/daniel/Code/grognard-xml/grognard/docs/test.xml')).toBe(
      false,
    );
    expect(isTempDocumentPath('/Users/daniel/grognard/KR4h0134_057.xml')).toBe(false);
    expect(isTempDocumentPath('/Users/daniel/grognard/project/imported/a.xml')).toBe(false);
    expect(isTempDocumentPath('/Users/daniel/grognard/2026/notes.xml')).toBe(false);
  });
});
