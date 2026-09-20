import { adminLevelsCompatible, importOriginPlace } from './originPlaceImport';

describe('importOriginPlace', () => {
  it('Rule 1: a coherent geo cluster with no admin-level conflict imports as coordinates-mode', () => {
    const result = importOriginPlace(
      [
        {
          source: 'CBDB',
          authId: 'c_addr_123',
          placeName: '鄱陽',
          geo: { lat: 28.21, lon: 116.68 },
          adminLevel: 'xian',
        },
        {
          source: 'CHGIS',
          authId: 'sys_456',
          placeName: '鄱陽縣',
          geo: { lat: 28.22, lon: 116.69 },
        },
      ],
      5,
    );
    expect(result.storageMode).toBe('coordinates');
    expect(result.geo).toEqual({ lat: 28.21, lon: 116.68 });
    expect(result.conflict).toBeUndefined();
    expect(result.sourceEntries).toEqual([
      { source: 'CBDB', authId: 'c_addr_123', dates: undefined },
      { source: 'CHGIS', authId: 'sys_456', dates: undefined },
    ]);
    expect(result.placeNames).toEqual([
      { text: '鄱陽', source: 'CBDB' },
      { text: '鄱陽縣', source: 'CHGIS' },
    ]);
  });

  it('Rule 2: geo-bearing candidates outside the radius import as id-mode with no promoted coordinate', () => {
    const result = importOriginPlace(
      [
        { source: 'CBDB', authId: 'c_addr_1', geo: { lat: 30.5, lon: 114.3 } }, // Hubei
        { source: 'CBDB', authId: 'c_addr_2', geo: { lat: 39.9, lon: 116.4 } }, // Beijing
      ],
      5,
    );
    expect(result.storageMode).toBe('id');
    expect(result.conflict).toBe('geo-out-of-radius');
    expect(result.geo).toBeUndefined();
    // Provenance is preserved even though no coordinate was promoted.
    expect(result.sourceEntries).toHaveLength(2);
  });

  it('Rule 2: incompatible administrative levels force id-mode even with coherent geo', () => {
    const result = importOriginPlace(
      [
        {
          source: 'CBDB',
          authId: 'c_addr_1',
          geo: { lat: 28.21, lon: 116.68 },
          adminLevel: 'xian',
        },
        { source: 'CHGIS', authId: 'sys_1', geo: { lat: 28.22, lon: 116.69 }, adminLevel: 'zhou' },
      ],
      5,
    );
    expect(result.storageMode).toBe('id');
    expect(result.conflict).toBe('admin-level-mismatch');
  });

  it('Rule 3: no candidate has coordinates → id-mode, missing coordinates are not a conflict', () => {
    const result = importOriginPlace([{ source: 'DILA', authId: 'PL456', placeName: '鄱陽' }], 5);
    expect(result.storageMode).toBe('id');
    expect(result.conflict).toBeUndefined();
    expect(result.sourceEntries).toEqual([{ source: 'DILA', authId: 'PL456', dates: undefined }]);
  });

  it('preserves per-source multi-range dates verbatim regardless of storage mode', () => {
    const result = importOriginPlace(
      [
        {
          source: 'CBDB',
          authId: 'c_addr_123',
          geo: { lat: 28.21, lon: 116.68 },
          dates: [
            { from: 0, to: 260 },
            { from: 501, to: 504 },
            { from: 704, to: null },
          ],
        },
      ],
      5,
    );
    expect(result.storageMode).toBe('coordinates');
    expect(result.sourceEntries[0]!.dates).toEqual([
      { from: 0, to: 260 },
      { from: 501, to: 504 },
      { from: 704, to: null },
    ]);
  });

  it('a candidate missing its own admin level never conflicts with one that has it', () => {
    expect(
      adminLevelsCompatible([
        { source: 'CBDB', authId: 'a', adminLevel: 'xian' },
        { source: 'CHGIS', authId: 'b' },
      ]),
    ).toBe(true);
  });

  it('two different non-empty admin levels conflict', () => {
    expect(
      adminLevelsCompatible([
        { source: 'CBDB', authId: 'a', adminLevel: 'xian' },
        { source: 'CHGIS', authId: 'b', adminLevel: 'Xian' },
      ]),
    ).toBe(true); // case-insensitive match — not a real conflict
    expect(
      adminLevelsCompatible([
        { source: 'CBDB', authId: 'a', adminLevel: 'xian' },
        { source: 'CHGIS', authId: 'b', adminLevel: 'zhou' },
      ]),
    ).toBe(false);
  });
});
