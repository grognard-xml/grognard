#!/usr/bin/env node
/**
 * Syncs public artwork and generated assets from the private visual_design repo.
 *
 * The private repo is the source of truth for:
 * - core artwork (icon, splash, tab icons)
 * - spoiler-protected reward artwork
 * - achievement definitions
 * - DiceBear head color-match stats
 * - Adventurer avatar-part layers (not a spoiler - mirrored as plain files,
 *   not run through the encrypted assets.bin pipeline)
 *
 * This script clones or updates a cached checkout of visual_design, mirrors
 * the branding artwork used directly by this repo, and then runs
 * visual_design's own pack/generate scripts against this checkout - it does
 * NOT reimplement their packing logic. Two copies of "how to build
 * assets.bin" drifting apart is exactly what caused the bg/* backdrops to
 * silently go missing from a shipped build once already; there must only
 * ever be one implementation of that, living in visual_design/scripts/.
 *
 * That same incident is also why backdrops (rewards/bg_<rank><variant>.png)
 * are auto-discovered by pack-assets.mjs rather than hand-listed in a
 * manifest: a hand-listed manifest is exactly the thing a human forgets to
 * update, twice.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VISUAL_DESIGN_REPO =
  process.env.VISUAL_DESIGN_REPO ?? 'git@github.com:PotatoSinology/grognard-visual-assets.git';
const VISUAL_DESIGN_ROOT =
  process.env.VISUAL_DESIGN_ROOT ?? path.join(ROOT, '.cache', 'visual_design');

const BRANDING_TARGETS = [
  ['icon.svg', 'apps/desktop/resources/branding/icon.svg'],
  ['icon.png', 'apps/desktop/resources/branding/icon.png'],
  ['tab_explorer.svg', 'apps/commons/src/icons/tab/tab_explorer.svg'],
  ['tab_explorer.dark.svg', 'apps/commons/src/icons/tab/tab_explorer.dark.svg'],
  ['tab_explorer.png', 'apps/commons/src/icons/tab/tab_explorer.png'],
  ['tab_explorer.dark.png', 'apps/commons/src/icons/tab/tab_explorer.dark.png'],
  ['tab_highlight.svg', 'apps/commons/src/icons/tab/tab_highlight.svg'],
  ['tab_highlight.dark.svg', 'apps/commons/src/icons/tab/tab_highlight.dark.svg'],
  ['tab_highlight.png', 'apps/commons/src/icons/tab/tab_highlight.png'],
  ['tab_highlight.dark.png', 'apps/commons/src/icons/tab/tab_highlight.dark.png'],
  ['tab_find.svg', 'apps/commons/src/icons/tab/tab_find.svg'],
  ['tab_find.dark.svg', 'apps/commons/src/icons/tab/tab_find.dark.svg'],
  ['tab_find.png', 'apps/commons/src/icons/tab/tab_find.png'],
  ['tab_find.dark.png', 'apps/commons/src/icons/tab/tab_find.dark.png'],
  ['tab_xpath.svg', 'apps/commons/src/icons/tab/tab_xpath.svg'],
  ['tab_xpath.dark.svg', 'apps/commons/src/icons/tab/tab_xpath.dark.svg'],
  ['tab_xpath.png', 'apps/commons/src/icons/tab/tab_xpath.png'],
  ['tab_xpath.dark.png', 'apps/commons/src/icons/tab/tab_xpath.dark.png'],
  ['tab_toc.svg', 'apps/commons/src/icons/tab/tab_toc.svg'],
  ['tab_toc.dark.svg', 'apps/commons/src/icons/tab/tab_toc.dark.svg'],
  ['tab_toc.png', 'apps/commons/src/icons/tab/tab_toc.png'],
  ['tab_toc.dark.png', 'apps/commons/src/icons/tab/tab_toc.dark.png'],
  ['tab_tree.svg', 'apps/commons/src/icons/tab/tab_tree.svg'],
  ['tab_tree.dark.svg', 'apps/commons/src/icons/tab/tab_tree.dark.svg'],
  ['tab_tree.png', 'apps/commons/src/icons/tab/tab_tree.png'],
  ['tab_tree.dark.png', 'apps/commons/src/icons/tab/tab_tree.dark.png'],
  ['tool_correction.svg', 'apps/commons/src/icons/tool_correction.svg'],
  ['tool_correction.dark.svg', 'apps/commons/src/icons/tool_correction.dark.svg'],
  ['tool_transform.svg', 'apps/commons/src/icons/tool_transform.svg'],
  ['tool_transform.dark.svg', 'apps/commons/src/icons/tool_transform.dark.svg'],
  ['tool_hide_notes.svg', 'apps/commons/src/icons/tool_hide_notes.svg'],
  ['tool_hide_notes.dark.svg', 'apps/commons/src/icons/tool_hide_notes.dark.svg'],
  ['tool_hide_notes.svg', 'packages/cwrc-leafwriter/src/images/tool_hide_notes.svg'],
  ['tool_show_notes.svg', 'apps/commons/src/icons/tool_show_notes.svg'],
  ['tool_show_notes.dark.svg', 'apps/commons/src/icons/tool_show_notes.dark.svg'],
  ['krp_menu.svg', 'apps/commons/src/icons/krp_menu.svg'],
  ['krp_menu_dark.svg', 'apps/commons/src/icons/krp_menu.dark.svg'],
  ['menu_norbert.svg', 'apps/commons/src/icons/menu_norbert.svg'],
  ['menu_norbert_dark.svg', 'apps/commons/src/icons/menu_norbert.dark.svg'],
  ['norbert-mini.png', 'apps/commons/src/assets/images/norbert-mini.png'],
  ['splash.svg', 'apps/desktop/resources/branding/splash.svg'],
  ['grognard.png', 'apps/desktop/resources/branding/splash_new.png'],
];

const CLEANUP_TARGETS = [
  'design/export-icon.mjs',
  'design/export-tab-icons.mjs',
  'design/icons',
  'design/disambiguate.svg',
  'design/icon.svg',
  'design/icon.png',
  'design/icon_192.png',
  'design/icon.pdf',
  'design/splash_base.png',
  'design/splash_base2.png',
  'design/splash.svg',
  'design/splash_new.png',
  'design/tab_explorer.svg',
  'design/tab_explorer.dark.svg',
  'design/tab_explorer.png',
  'design/tab_explorer.dark.png',
  'design/tab_find.svg',
  'design/tab_find.dark.svg',
  'design/tab_find.png',
  'design/tab_find.dark.png',
  'design/tab_xpath.svg',
  'design/tab_xpath.dark.svg',
  'design/tab_xpath.png',
  'design/tab_xpath.dark.png',
  'design/tab_toc.svg',
  'design/tab_toc.dark.svg',
  'design/tab_toc.png',
  'design/tab_toc.dark.png',
  'design/tab_tree.svg',
  'design/tab_tree.dark.svg',
  'design/tab_tree.png',
  'design/tab_tree.dark.png',
  'design/tab_entity.svg',
  'design/tab_entity.dark.svg',
  'design/tab_entity.png',
  'design/tab_entity.dark.png',
  'design/tab_icons.svg',
  'apps/commons/src/icons/tab/tab_entity.svg',
  'apps/commons/src/icons/tab/tab_entity.dark.svg',
  'apps/commons/src/icons/tab/tab_entity.png',
  'apps/commons/src/icons/tab/tab_entity.dark.png',
  'apps/desktop/resources/branding/icon.svg',
  'apps/desktop/resources/branding/icon.png',
  'apps/desktop/resources/branding/splash.svg',
  'apps/desktop/resources/branding/splash_new.png',
];

const SOURCE_REPO_ICON_DIR = path.join(VISUAL_DESIGN_ROOT, 'icons');
const SOURCE_REPO_SPLASH_DIR = path.join(VISUAL_DESIGN_ROOT, 'splash');

function runGit(args) {
  execFileSync('git', ['-C', VISUAL_DESIGN_ROOT, ...args], { stdio: 'inherit' });
}

function ensureVisualDesignRepo() {
  if (!existsSync(path.join(VISUAL_DESIGN_ROOT, '.git'))) {
    mkdirSync(path.dirname(VISUAL_DESIGN_ROOT), { recursive: true });
    execFileSync('git', ['clone', '--depth', '1', VISUAL_DESIGN_REPO, VISUAL_DESIGN_ROOT], {
      stdio: 'inherit',
    });
  } else {
    runGit(['pull', '--ff-only', 'origin', 'main']);
  }

  execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: VISUAL_DESIGN_ROOT,
    stdio: 'inherit',
  });
}

function copyRelative(sourceBase, sourceRel, destinationRel) {
  const sourcePath = path.join(sourceBase, sourceRel);
  const destinationPath = path.join(ROOT, destinationRel);
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath);
}

function removeIfPresent(relPath) {
  rmSync(path.join(ROOT, relPath), { force: true });
}

function exportMenuIconPngs() {
  const menuIcons = ['krp_menu', 'menu_norbert'];
  for (const base of menuIcons) {
    for (const variant of ['', '.dark']) {
      const svgPath = path.join(ROOT, 'apps/commons/src/icons', `${base}${variant}.svg`);
      const pngPath = path.join(ROOT, 'apps/commons/src/icons', `${base}${variant}.png`);
      execFileSync('rsvg-convert', ['-w', '32', '-h', '32', svgPath, '-o', pngPath], {
        stdio: 'inherit',
      });
    }
  }
}

function syncArtwork() {
  for (const relPath of CLEANUP_TARGETS) removeIfPresent(relPath);

  for (const [sourceRel, destinationRel] of BRANDING_TARGETS) {
    const sourceBase =
      sourceRel === 'norbert-mini.png'
        ? VISUAL_DESIGN_ROOT
        : sourceRel.startsWith('splash')
          ? SOURCE_REPO_SPLASH_DIR
          : SOURCE_REPO_ICON_DIR;
    copyRelative(sourceBase, sourceRel, destinationRel);
  }

  exportMenuIconPngs();
}

function runVisualDesignScript(relScriptPath) {
  execFileSync('node', [path.join(VISUAL_DESIGN_ROOT, relScriptPath)], {
    cwd: VISUAL_DESIGN_ROOT,
    env: { ...process.env, LEAF_WRITER_ROOT: ROOT },
    stdio: 'inherit',
  });
}

function main() {
  ensureVisualDesignRepo();
  syncArtwork();
  runVisualDesignScript('scripts/pack-assets.mjs');
  runVisualDesignScript('scripts/pack-definitions.mjs');
  runVisualDesignScript('scripts/generate-head-color-stats.mjs');
  runVisualDesignScript('scripts/generate-avatar-parts-manifest.mjs');
  runVisualDesignScript('scripts/sync-avatar-parts.mjs');
  console.log(
    'Synced artwork, game assets, achievement definitions, head color stats, avatar parts manifest, and avatar parts from visual_design.',
  );
}

main();
