import { contentSignature } from './resultsFreshness';

describe('contentSignature', () => {
  it('is stable for equal text and differs when the text or a tag changes', () => {
    const xml = '<div><p>圖讚</p></div>';
    expect(contentSignature(xml)).toBe(contentSignature(`${xml}`));
    expect(contentSignature(xml)).not.toBe(contentSignature('<div><head>圖讚</head></div>'));
    expect(contentSignature(xml)).not.toBe(contentSignature('<div><p>圖讚 </p></div>'));
  });

  it('distinguishes same-length texts', () => {
    expect(contentSignature('abcd')).not.toBe(contentSignature('abdc'));
  });
});
