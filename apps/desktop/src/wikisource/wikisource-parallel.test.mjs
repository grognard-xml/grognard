#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyWikisourceTitle,
  hasRunningText,
  htmlToParallelText,
  listEditionTrees,
  listVolumePages,
  parseWikisourceUrl,
  resolveEditionRoot,
  shouldFetchSingleWikisourcePage,
  volumeNumberFromTitle,
  workTitleFromPageTitle,
  isWikisourceSubPageTitle,
  wikidataSiteCode,
} from './wikisource-parallel.mjs';

test('parseWikisourceUrl accepts wiki and zh-hant paths', () => {
  assert.deepEqual(parseWikisourceUrl('https://zh.wikisource.org/zh-hant/%E8%8D%80%E5%AD%90'), {
    apiHost: 'zh.wikisource.org',
    title: '荀子',
    origin: 'https://zh.wikisource.org',
  });
});

test('resolveEditionRoot prefers chapter pages over scanned editions', () => {
  const links = ['荀子 (四庫全書本)', '荀子 (四部叢刊本)', '荀子/勸學篇', '荀子/修身篇'];
  assert.equal(resolveEditionRoot('荀子', links), '荀子');
});

test('resolveEditionRoot falls back to 四庫全書本 when no chapters', () => {
  const links = ['荀子 (四庫全書本)', '荀子 (四部叢刊本)'];
  assert.equal(resolveEditionRoot('荀子', links), '荀子 (四庫全書本)');
});

test('resolveEditionRoot moves from volume page to edition root', () => {
  assert.equal(
    resolveEditionRoot('荀子 (四庫全書本)/卷01', ['荀子 (四庫全書本)/卷02']),
    '荀子 (四庫全書本)',
  );
});

test('listVolumePages lists chapter pages when no 卷 pages exist', () => {
  const chapters = listVolumePages(['荀子/修身篇', '荀子/勸學篇'], '荀子');
  assert.deepEqual(chapters, ['荀子/修身篇', '荀子/勸學篇']);
});

test('listVolumePages sorts 卷 pages numerically', () => {
  const volumes = listVolumePages(
    ['荀子 (四庫全書本)/卷10', '荀子 (四庫全書本)/卷02', '荀子 (四庫全書本)/卷01'],
    '荀子 (四庫全書本)',
  );
  assert.deepEqual(volumes, [
    '荀子 (四庫全書本)/卷01',
    '荀子 (四庫全書本)/卷02',
    '荀子 (四庫全書本)/卷10',
  ]);
  assert.equal(volumeNumberFromTitle('荀子 (四庫全書本)/卷10'), 10);
});

test('volumeNumberFromTitle accepts 上中下 suffixes', () => {
  assert.equal(volumeNumberFromTitle('後漢書/卷80上'), 80);
  assert.equal(resolveEditionRoot('後漢書/卷80上', ['後漢書/卷80下', '後漢書/卷79']), '後漢書');
});

test('isWikisourceSubPageTitle distinguishes index from subpages', () => {
  assert.equal(isWikisourceSubPageTitle('後漢書/卷79上'), true);
  assert.equal(isWikisourceSubPageTitle('荀子/勸學篇'), true);
  assert.equal(isWikisourceSubPageTitle('後漢書'), false);
});

test('shouldFetchSingleWikisourcePage for editor fetches', () => {
  assert.equal(shouldFetchSingleWikisourcePage('後漢書/卷79上', false), true);
  assert.equal(shouldFetchSingleWikisourcePage('後漢書', false), false);
  assert.equal(shouldFetchSingleWikisourcePage('後漢書', true), false);
});

test('workTitleFromPageTitle walks off chapter and named-edition pages', () => {
  assert.equal(workTitleFromPageTitle('荀子/勸學篇'), '荀子');
  assert.equal(workTitleFromPageTitle('荀子 (四庫全書本)/卷01'), '荀子');
  assert.equal(workTitleFromPageTitle('荀子'), '荀子');
});

test('listEditionTrees lists chapters and named editions without auto-picking', () => {
  const trees = listEditionTrees('荀子', [
    '荀子 (四庫全書本)',
    '荀子 (四部叢刊本)',
    '荀子/勸學篇',
    '荀子/修身篇',
  ]);
  assert.equal(trees.length, 3);
  assert.equal(trees[0].kind, 'chapters');
  assert.deepEqual(trees[0].pages, ['荀子/修身篇', '荀子/勸學篇']);
  assert.equal(trees[1].rootTitle, '荀子 (四庫全書本)');
  assert.equal(trees[1].needsFetch, true);
  assert.equal(trees[2].rootTitle, '荀子 (四部叢刊本)');
});

test('classifyWikisourceTitle rejects talk, index, author, and portal pages', () => {
  assert.equal(classifyWikisourceTitle('荀子').ok, true);
  assert.equal(classifyWikisourceTitle('Index:Foo.djvu').ok, false);
  assert.equal(classifyWikisourceTitle('Page:Foo.djvu/1').ok, false);
  assert.equal(classifyWikisourceTitle('Author:Xunzi').ok, false);
  assert.equal(classifyWikisourceTitle('Talk:荀子').ok, false);
  assert.equal(classifyWikisourceTitle('Portal:Philosophy').ok, false);
  assert.equal(classifyWikisourceTitle('作者:荀子').ok, false);
});

test('wikidataSiteCode maps language host to sitelink site', () => {
  assert.equal(wikidataSiteCode('zh.wikisource.org'), 'zhwikisource');
  assert.equal(wikidataSiteCode('en.wikisource.org'), 'enwikisource');
});

test('htmlToParallelText drops nested licence banner and template boilerplate', () => {
  const html =
    '<div class="mw-parser-output"><p>於是時惟青陽，日在方旭。</p>' +
    '<div class="licenseContainer licenseBanner"><div><div><p>此西晉作品在全世界都属于公有领域。</p></div></div><div><p></p></div></div>' +
    '<div class="licensetpl"><p><span>Public domain</span><span>false</span></p></div></div>';
  assert.equal(htmlToParallelText(html), '於是時惟青陽，日在方旭。');
});

test('hasRunningText tells a poem page from an index of chapter titles', () => {
  assert.equal(hasRunningText('咨五才之並用，寔水德之靈長。'.repeat(8)), true);
  assert.equal(hasRunningText('卷一\n卷二\n卷三\n昭明文選卷四'), false);
  assert.equal(
    hasRunningText('謝靈運從遊京口北固應詔、晚出西射堂、登池上樓、遊南亭、'.repeat(6)),
    false,
  );
  // verse set one short line per line
  assert.equal(
    hasRunningText(
      '伊巫咸之名山，崫孤停而嵥峙。\n體岑峭以隆頹，冠崇嶺以峻起。\n配華霍以助鎮，致靈潤乎百里。\n爾乃寒泉懸涌，浚湍流帶，\n林薄叢蘢，幽蔚隱藹。\n八風之所歸起，游鳥之所喧會。',
    ),
    true,
  );
});

test('htmlToParallelText drops a trailing editorial source note but keeps in-text citations', () => {
  const html =
    '<p>水潤下以作鹹，莫斯鹽之最靈。</p><p>（《藝文類聚》九，又《書鈔》一百四十六引六條）</p>';
  assert.equal(htmlToParallelText(html), '水潤下以作鹹，莫斯鹽之最靈。');
  assert.equal(
    htmlToParallelText('<p>子曰（《論語》）學而時習之。</p>'),
    '子曰（《論語》）學而時習之。',
  );
});
