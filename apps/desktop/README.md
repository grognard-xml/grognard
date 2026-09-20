# Grognard (Desktop)

Electron desktop shell for LEAF-Writer Commons.

## Prerequisites

- Node.js 24+
- npm workspaces installed from the repo root: `npm install`

## Development

Run the web app and Electron window together (from repo root):

```bash
npm run dev:desktop
```

Or in two terminals:

```bash
npm run dev -w leafwriter-commons
npm run dev -w grognard-desktop
```

The Electron window opens at `http://localhost:3000/project`.

**First launch can take ~30 seconds** while webpack compiles; the desktop shell waits for the dev server and `js/app.js` before opening the window. If you still see an error, wait until the terminal shows `Compiled successfully`, then reload the window (Cmd+R).

Optional: set `GROGNARD_OPEN_DEVTOOLS=1` to open Chromium DevTools in development.

The View menu's Reload / Force Reload / Toggle Developer Tools items only appear in development builds (`app.isPackaged === false`); they're stripped from packaged production builds.

## Production build

### macOS (.pkg)

```bash
npm run build:desktop
```

This builds Commons, compiles the Electron main/preload scripts, and packages a `.pkg` installer into `apps/desktop/release/`.
For a local-only rebuild without touching GitHub release publishing, run `npm run package:mac -w grognard-desktop -- --publish never`.

### Bundled Python runtime (all platforms)

Every package (mac `.pkg`, Linux `.deb`, Windows NSIS) bundles a relocatable
CPython (python-build-standalone) with the pinned `sanmiao` release
pip-installed into it. `scripts/download-python-runtime.mjs` fetches the
runtime for the host OS/architecture during `npm install` and before
packaging, staging it at `apps/desktop/resources/python/` — the same
repo-relative path on every dev machine and VM. That download now retries
temporary upstream failures before aborting, and the packaging hooks fail
closed if the runtime cannot be staged completely. The app prefers a sibling
`../sanmiao` dev checkout (editable venv), then the bundled runtime, then
system Python; `SANMIAO_PYTHON` overrides everything. End users need no
Python setup.

To bump Python or sanmiao, edit `PBS_TAG` / `PYTHON_VERSION` /
`SANMIAO_SPEC` at the top of the script; the stamp file forces a
re-download on the next install.

### Linux (.deb)

Extra system prerequisites (Debian/Ubuntu):

```bash
sudo apt install librsvg2-bin
```

`librsvg2-bin` provides `rsvg-convert` for icon export. Assembling the `.deb`
itself no longer needs the Ruby `fpm` gem — the build points
`CUSTOM_FPM_PATH` at `scripts/fpm-deb.mjs`, a small Node reimplementation of
the subset of `fpm` electron-builder needs, so nothing beyond Node has to be
installed.

Then, from the repo root:

```bash
npm run build:desktop:linux
```

The `.deb` lands in `apps/desktop/release/` (e.g. `Grognard-linux-0.0.1-arm64.deb`). Install it with:

```bash
sudo apt install ./apps/desktop/release/Grognard-linux-*.deb
```

For GitHub-hosted updates, the release workflow publishes a signed APT repo
to GitHub Pages. In repository settings, set Pages source to `GitHub Actions`.
The repository URL will look like:

```text
https://<owner>.github.io/<repo>/apt
```

After the signing key is added once, `apt update` will pick up new versions
automatically:

```bash
curl -fsSL https://<owner>.github.io/<repo>/apt/grognard-archive-key.asc \
  | sudo gpg --dearmor -o /usr/share/keyrings/grognard-archive-key.gpg
echo "deb [signed-by=/usr/share/keyrings/grognard-archive-key.gpg] https://<owner>.github.io/<repo>/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/grognard.list
sudo apt update
sudo apt install grognard-desktop
```

The standalone `.deb` does this onboarding for the user via maintainer scripts
(`deb.afterInstall` / `deb.afterRemove` in the `electron-builder.linux*.json`
configs):

- `resources/apt/postinst.sh` — on first `configure`, copies the bundled
  signing key (`resources/apt/grognard-archive-key.asc`, shipped as an
  `extraResources` entry) to `/usr/share/keyrings/grognard.asc` and writes
  `/etc/apt/sources.list.d/grognard.list` (arch-pinned, `signed-by` the
  keyring). It never overwrites an existing `.list`, and honours
  `repo_add_once="false"` in `/etc/default/grognard`.
- `resources/apt/postrm.sh` — removes both files on `apt purge` only; a plain
  `apt remove` leaves the repo in place so reinstalls keep working.

Keep `resources/apt/grognard-archive-key.asc` in sync with the key
`scripts/build-apt-repo.mjs` signs the repo with (the CI signing subkey in
`SECURITY.md`); it is a public key, safe to commit.

Platform-specific electron-builder settings live in `electron-builder.mac.json`, `electron-builder.linux.json`, and `electron-builder.win.json`, all extending `electron-builder.base.json`.

The mac packaging hooks also stage LemMinX from `resources/lemminx/` and
retry transient download failures before packaging continues.

### Linux (Flatpak)

Flatpak packaging uses electron-builder’s `flatpak` target. On a machine with `flatpak-builder` installed, run:

```bash
npm run build:desktop:flatpak
```

The resulting `.flatpak` bundle lands in `apps/desktop/release/`. This is a
standalone install bundle, not an update channel. A true Flatpak update path
would need a repository-based Flatpak manifest and signing flow, which is not
set up yet.

### Linux (Arch / CachyOS)

For Arch-based systems, use the local PKGBUILD in `packaging/arch/`:

```bash
cd packaging/arch
makepkg -si
```

This produces a native Arch package for the host architecture (`x86_64` or
`aarch64`).

### Windows (NSIS)

```bash
npm run package:win -w grognard-desktop
```

The `prepackage:win` hook exports the icon and stages the bundled Python
runtime (see above) before electron-builder assembles the installer.

### Notes

- **Host platform:** `npm run package` builds the mac `.pkg` installer. Use `npm run package:linux` for the Linux `.deb`, `npm run package:win` for the Windows NSIS installer, or `npm run package:mac` to be explicit.
- **No code signing:** Unsigned builds may require right-click → Open on first launch.
- If the build fails with `unable to locate '...leafwriter-validator.worker.js'`, build the validator package first: `npm run build -w @cwrc/leafwriter-validator`.
- The bundled LemMinX XML language server is currently downloaded for macOS only; Linux builds skip it, and the mac packaging hook will refuse to continue if it cannot stage the expected binary.
- The packaged app starts a local Express server and loads the `/project` route.

## Asset sources

Artwork and spoiler-protected game assets come from the private [visual_design](https://github.com/grognard-xml/visual_design) repo. Run `npm run visual-design:sync` (from the repo root) to refresh the mirrored files below.

Tracked here as mirrored or generated assets:

- `apps/desktop/resources/branding/icon.svg`
- `apps/desktop/resources/branding/icon.png`
- `apps/desktop/resources/branding/icons/*.png`
- `apps/desktop/resources/branding/splash.svg`
- `apps/desktop/resources/branding/splash_new.png`
- `apps/commons/src/icons/tab/tab_explorer.{svg,png,dark.svg,dark.png}`
- `apps/commons/src/icons/tab/tab_find.{svg,png,dark.svg,dark.png}`
- `apps/commons/src/icons/tab/tab_xpath.{svg,png,dark.svg,dark.png}`
- `apps/commons/src/icons/tab/tab_toc.{svg,png,dark.svg,dark.png}`
- `apps/commons/src/icons/tab/tab_tree.{svg,png,dark.svg,dark.png}`
- `apps/commons/src/icons/tool_{correction,transform,hide_notes,show_notes}.{svg,dark.svg,png,dark.png}`
- `apps/commons/src/icons/{krp_menu,menu_norbert,menu_structure,plugin-CHHIV}.{svg,dark.svg,png,dark.png}`
- `apps/commons/src/assets/images/norbert-mini.png`
- `apps/commons/src/desktop/achievements/definitions.ts`
- `apps/desktop/resources/game-assets/assets.bin`
- `apps/desktop/src/generated/gameAssetKey.ts`
- `apps/desktop/resources/avatar-parts/**` (Adventurer avatar-part layers — not spoiler-protected, mirrored as plain SVG files)

`assets.bin` itself is not committed — it's fetched from Cloudflare R2 by `scripts/fetch-game-assets.mjs` (see that script and `.github/workflows/ci.yml` for the fetch/cache mechanics), keyed against `apps/desktop/resources/game-assets/assets.manifest.json`'s `sha256`.

## License notices

The desktop build bundles third-party runtime components such as Electron, TinyMCE, `monaco-editor`, `jszip`, `mammoth`, and `@xmldom/xmldom`. Their license pointers are tracked in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Current features

- Open a project folder and bootstrap its schema and project metadata
- Browse XML files in a sidebar tree with multiple document tabs
- Save edits back to disk, including Save As and untitled-file flows
- Edit in both visual and source modes
- Find and replace across the current file, open tabs, selected resources, or the whole project
- Run XPath queries on the current project scopes
- Inspect project and file metadata in the side panels
- Use schema validation, XML tree navigation, table of contents, and entity tools
- Work with translation companions in split-pane form for paired source/translation editing
