import { serialize } from 'node:v8';
import type { ImportJobOptions } from '../../../../apps/commons/src/desktop/importJobTypes';
import { toPlainJobOptions } from './toPlainJobOptions';

const live = () =>
  ({
    kind: 'cbeta',
    workId: 'C1163',
    title: 'x',
    projectRoot: '/p',
    destDir: '/p/imported',
    // What live editor state can hold:
    projectConfig: {
      schema: { catalogId: 'teiAll' },
      onChange: () => undefined,
      reactive: new Proxy({ a: 1 }, {}),
      nested: { fn: function () {}, kept: 'yes' },
    },
    cleanImport: true,
    stripLineBreaks: false,
    splitUnit: 'juan',
    crossFamily: true,
  }) as unknown as ImportJobOptions;

describe('toPlainJobOptions', () => {
  it('drops what structured clone (Electron IPC) cannot copy and keeps the data', () => {
    const options = live();
    // v8.serialize is the structured-clone algorithm Electron IPC uses (the test environment's
    // own structuredClone is a JSON stand-in).
    expect(() => serialize(options)).toThrow(/could not be cloned/);
    const plain = toPlainJobOptions(options);
    expect(() => serialize(plain)).not.toThrow();
    expect(plain.projectConfig.schema?.catalogId).toBe('teiAll');
    expect((plain.projectConfig as { nested: { kept: string } }).nested.kept).toBe('yes');
    expect((plain.projectConfig as { reactive: { a: number } }).reactive.a).toBe(1);
    expect(plain.workId).toBe('C1163');
  });

  it('says what went wrong when the options cannot be made plain', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const options = { ...live(), projectConfig: circular } as unknown as ImportJobOptions;
    expect(() => toPlainJobOptions(options)).toThrow(/could not be prepared/);
  });
});
