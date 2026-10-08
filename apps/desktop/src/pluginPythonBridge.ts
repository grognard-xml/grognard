/**
 * Generic subprocess bridge for hybrid plugins with a Python backend (manifest.entry.python).
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import { app } from 'electron';
import {
  getCachedPluginHostSnapshot,
  getPluginHostSnapshot,
  isPluginEnabledInMain,
  resolveDevPluginSourcePath,
  resolvePluginPythonBinary,
} from './plugins/pluginHost';

const execFileAsync = promisify(execFile);

const PYTHON_TIMEOUT_MS = 5 * 60 * 1000;
const DAOZANG_SYNC_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_SANMIAO_VERSION = '0.2.10';
const SANMIAO_SPEC = `sanmiao[fuzzy]==${MIN_SANMIAO_VERSION}`;
const KANRIPO_API_SPEC = 'kanripo==0.31';

export type PluginPythonProgressEvent =
  | { type: 'init'; total: number; tablesMs: number }
  | {
      type: 'chunk';
      index: number;
      done: number;
      total: number;
      ms: number;
      chars: number;
      proposals: number;
      skipped: boolean;
    };

export type PluginPythonProgressCallback = (event: PluginPythonProgressEvent) => void;

/** A python interpreter invocation: `spawn(bin, [...args, ...rest])`. */
interface PythonCommand {
  bin: string;
  args: string[];
}

const commandLabel = (cmd: PythonCommand): string => [cmd.bin, ...cmd.args].join(' ');

const pythonCache = new Map<string, PythonCommand>();
const devRootCache = new Map<string, string | null>();
const extraPythonPathCache = new Map<string, string[]>();

const logPluginPython = (pluginId: string, message: string, data?: Record<string, unknown>) => {
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`[plugin-python:${pluginId}] ${message}${suffix}`);
};

const pluginRecord = (pluginId: string) =>
  getCachedPluginHostSnapshot()?.plugins.find((p) => p.id === pluginId && !p.manifestError);

const pythonModuleForPlugin = (pluginId: string): string => {
  const plugin = pluginRecord(pluginId);
  const moduleName = plugin?.manifest.entry?.python?.module?.trim();
  if (!moduleName) throw new Error(`Plugin ${pluginId} has no manifest.entry.python.module`);
  return moduleName;
};

const extraPythonPathsForPlugin = (pluginId: string): string[] => {
  const paths: string[] = [];
  const devSource = resolveDevPluginSourcePath(pluginId);
  if (devSource) {
    const devPython = path.join(devSource, 'python');
    if (fs.existsSync(devPython)) paths.push(devPython);
  }
  const plugin = pluginRecord(pluginId);
  if (plugin?.installPath) {
    const pythonDir = path.join(plugin.installPath, 'python');
    if (fs.existsSync(pythonDir) && !paths.includes(pythonDir)) paths.push(pythonDir);
  }
  return paths;
};

const pluginInstallRootForPython = (pluginId: string): string | null => {
  const devSource = resolveDevPluginSourcePath(pluginId);
  if (devSource) return devSource;
  return pluginRecord(pluginId)?.installPath ?? null;
};

/** Resolve sibling sanmiao repo (dev) for cjk-dates. */
const resolveSanmiaoDevRoot = (): string | null => {
  const candidates = [
    path.join(process.resourcesPath, 'sanmiao'),
    path.resolve(__dirname, '../../../../sanmiao'),
    path.resolve(process.cwd(), '../sanmiao'),
  ];
  for (const root of candidates) {
    if (fs.existsSync(path.join(root, 'src/sanmiao/tei_bridge.py'))) return root;
  }
  return null;
};

const coreBundledPython = (): string | null => {
  const roots = [
    process.resourcesPath ? path.join(process.resourcesPath, 'python') : null,
    path.resolve(__dirname, '../resources/python'),
  ].filter((root): root is string => Boolean(root));
  for (const root of roots) {
    const python =
      process.platform === 'win32'
        ? path.join(root, 'python.exe')
        : path.join(root, 'bin', 'python3');
    if (fs.existsSync(python)) return python;
  }
  return null;
};

const pythonCandidatesForPlugin = (pluginId: string): PythonCommand[] => {
  const fromEnv =
    pluginId === 'cjk-dates'
      ? process.env.SANMIAO_PYTHON?.trim()
      : process.env.GROGNARD_PLUGIN_PYTHON?.trim();
  if (fromEnv) return [{ bin: fromEnv, args: [] }];

  const candidates: PythonCommand[] = [];
  const pluginPython = resolvePluginPythonBinary(pluginId);
  if (pluginPython) candidates.push({ bin: pluginPython, args: [] });

  const corePython = coreBundledPython();
  if (corePython) candidates.push({ bin: corePython, args: [] });

  // Keep system interpreters as a last resort. In particular, do not return
  // early when a plugin-level interpreter exists: an incomplete plugin tree
  // must not mask the app-bundled interpreter that contains sanmiao.
  //
  // On Windows, bare "python"/"python3" are frequently shadowed by the OS's
  // App Execution Alias stubs (they open the Microsoft Store instead of
  // running anything) even when a real interpreter is installed. The `py`
  // launcher is a distinct binary that those stubs don't intercept, so try
  // it first there — it finds the real interpreter without requiring the
  // user to dig into Settings to disable the aliases.
  if (process.platform === 'win32') {
    candidates.push({ bin: 'py', args: ['-3'] });
  }
  candidates.push({ bin: 'python3', args: [] }, { bin: 'python', args: [] });

  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = commandLabel(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isMissingSanmiaoModule = (stderr: string): boolean =>
  /ModuleNotFoundError: No module named ['"]sanmiao['"]/.test(stderr);

const isMissingKanripoApiModule = (stderr: string): boolean =>
  /ModuleNotFoundError: No module named ['"]kanripo['"]/.test(stderr);

/**
 * Windows ships stub executables named python.exe/python3.exe ("App execution
 * aliases") that print this message and exit instead of running anything.
 * They shadow a real interpreter on PATH unless the user disables them in
 * Settings > Apps > Advanced app settings > App execution aliases.
 */
const isWindowsStoreStub = (output: string): boolean =>
  process.platform === 'win32' && /install.*from|Microsoft Store|ms-windows-store:/i.test(output);

/** Force UTF-8 I/O so non-ASCII (CJK) text survives on Windows, whose default
 * console codepage otherwise mangles it and can raise UnicodeEncodeError. */
const forceUtf8Env = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
});

const tryAutoInstallKanripoApi = async (
  pluginId: string,
  python: PythonCommand,
): Promise<boolean> => {
  const label = commandLabel(python);
  try {
    logPluginPython(pluginId, 'attempting automatic kanripo API install', {
      python: label,
      spec: KANRIPO_API_SPEC,
    });
    await execFileAsync(
      python.bin,
      [...python.args, '-m', 'pip', 'install', '--no-warn-script-location', KANRIPO_API_SPEC],
      { timeout: 3 * 60 * 1000, env: forceUtf8Env(process.env) },
    );
    return true;
  } catch (error) {
    const stderr = (error as { stderr?: string })?.stderr ?? String(error);
    logPluginPython(pluginId, 'automatic kanripo API install failed', {
      python: label,
      reason: stderr.trim().slice(-500),
    });
    return false;
  }
};
const tryAutoInstallSanmiao = async (pluginId: string, python: PythonCommand): Promise<boolean> => {
  const label = commandLabel(python);
  try {
    logPluginPython(pluginId, 'attempting automatic sanmiao install', {
      python: label,
      spec: SANMIAO_SPEC,
    });
    await execFileAsync(
      python.bin,
      [...python.args, '-m', 'pip', 'install', '--user', '--upgrade', SANMIAO_SPEC],
      { timeout: 3 * 60 * 1000, env: forceUtf8Env(process.env) },
    );
    return true;
  } catch (error) {
    const stderr = (error as { stderr?: string })?.stderr ?? String(error);
    logPluginPython(pluginId, 'automatic sanmiao install failed', {
      python: label,
      reason: stderr.trim().slice(-500),
    });
    return false;
  }
};

const SANMIAO_IMPORT_CHECK = [
  'import re, sanmiao',
  'from sanmiao.tei_bridge import cli_main',
  `minimum = tuple(int(x) for x in "${MIN_SANMIAO_VERSION}".split("."))`,
  'found = tuple(int(x) for x in re.findall(r"\\d+", sanmiao.__version__)[:3])',
  'assert found >= minimum, f"sanmiao {sanmiao.__version__} is too old (need >= ' +
    MIN_SANMIAO_VERSION +
    ')"',
].join('; ');

const KANRIPO_IMPORT_CHECK = [
  'from kanripo_import.grognard_bridge import cli_main',
  'from kanripo_import.kanripo_tei import convert_kanripo_txt',
  'import kanripo',
].join('; ');

const DAOZANG_IMPORT_CHECK = [
  'from daozang_import.grognard_bridge import cli_main',
  'from daozang_import.daozang_tei import convert_daozang_txt',
].join('; ');

const pythonTimeoutMs = (pluginId: string, payload: Record<string, unknown>): number => {
  if (
    pluginId === 'daozang-import' &&
    (payload.op === 'sync' || payload.op === 'install_from_source')
  ) {
    return DAOZANG_SYNC_TIMEOUT_MS;
  }
  // CBETA: `sync`/`install_from_source` clone xml-p5; the first `search` builds
  // the catalog index by scanning the whole checkout.
  if (
    pluginId === 'cbeta-import' &&
    (payload.op === 'sync' || payload.op === 'install_from_source' || payload.op === 'search')
  ) {
    return DAOZANG_SYNC_TIMEOUT_MS;
  }
  return PYTHON_TIMEOUT_MS;
};

const resolveCjkDatesPython = async (): Promise<PythonCommand> => {
  const pluginId = 'cjk-dates';
  const cached = pythonCache.get(pluginId);
  if (cached) return cached;

  const devRoot = resolveSanmiaoDevRoot();
  const failures: string[] = [];

  let sawWindowsStoreStub = false;

  const recordFailure = (label: string, error: unknown) => {
    const stdout = (error as { stdout?: string })?.stdout ?? '';
    const stderr = (error as { stderr?: string })?.stderr ?? String(error);
    if (isWindowsStoreStub(stdout) || isWindowsStoreStub(stderr)) {
      sawWindowsStoreStub = true;
    }
    const assertion = stderr.match(/AssertionError: (.+)/)?.[1];
    const reason = assertion ?? stderr.trim().split('\n').pop() ?? stdout.trim() ?? 'unknown error';
    failures.push(`${label}: ${reason}`);
    logPluginPython(pluginId, 'candidate rejected', { python: label, reason });
  };

  for (const python of pythonCandidatesForPlugin(pluginId)) {
    const label = commandLabel(python);
    try {
      await execFileAsync(python.bin, [...python.args, '-c', SANMIAO_IMPORT_CHECK], {
        timeout: 15_000,
        env: forceUtf8Env(process.env),
      });
      pythonCache.set(pluginId, python);
      devRootCache.set(pluginId, null);
      logPluginPython(pluginId, 'using python', { python: label, devRoot: devRoot ?? undefined });
      return python;
    } catch (error) {
      const stderr = (error as { stderr?: string })?.stderr ?? String(error);
      if (isMissingSanmiaoModule(stderr) && (await tryAutoInstallSanmiao(pluginId, python))) {
        try {
          await execFileAsync(python.bin, [...python.args, '-c', SANMIAO_IMPORT_CHECK], {
            timeout: 15_000,
            env: forceUtf8Env(process.env),
          });
          pythonCache.set(pluginId, python);
          devRootCache.set(pluginId, null);
          logPluginPython(pluginId, 'using python (auto-installed sanmiao)', { python: label });
          return python;
        } catch (retryError) {
          recordFailure(label, retryError);
          continue;
        }
      }
      recordFailure(label, error);
    }
  }

  if (devRoot) {
    const env = forceUtf8Env({ ...process.env, PYTHONPATH: path.join(devRoot, 'src') });
    const devCandidates: PythonCommand[] =
      process.platform === 'win32'
        ? [
            { bin: 'py', args: ['-3'] },
            { bin: 'python3', args: [] },
            { bin: 'python', args: [] },
          ]
        : [
            { bin: 'python3', args: [] },
            { bin: 'python', args: [] },
          ];
    for (const python of devCandidates) {
      try {
        await execFileAsync(python.bin, [...python.args, '-c', SANMIAO_IMPORT_CHECK], {
          timeout: 15_000,
          env,
        });
        pythonCache.set(pluginId, python);
        devRootCache.set(pluginId, devRoot);
        logPluginPython(pluginId, 'using python with PYTHONPATH', {
          python: commandLabel(python),
          devRoot,
        });
        return python;
      } catch (error) {
        recordFailure(`${commandLabel(python)} (PYTHONPATH=${devRoot}/src)`, error);
      }
    }
  }

  const devHint = devRoot
    ? ` Editable setup: cd ${devRoot} && python3 -m venv .venv && .venv/bin/pip install -e ".[fuzzy]"`
    : '';
  const storeStubHint = sawWindowsStoreStub
    ? ' Windows is redirecting "python"/"python3" to its Microsoft Store stub instead of a real ' +
      'interpreter. Disable this in Settings > Apps > Advanced app settings > App execution aliases ' +
      '(turn off the python.exe / python3.exe toggles), then restart the app.'
    : '';
  const failureHint = failures.length > 0 ? ` [${failures.join(' | ')}]` : '';
  throw new Error(
    `Plugin ${pluginId} Python backend (sanmiao >= ${MIN_SANMIAO_VERSION}) is not available.${devHint}${storeStubHint} ` +
      `Run "npm run python:download" in plugin-cjk-dates, or set SANMIAO_PYTHON.${failureHint}`,
  );
};

const resolveGenericPluginPython = async (pluginId: string): Promise<PythonCommand> => {
  const cached = pythonCache.get(pluginId);
  if (cached) return cached;

  extraPythonPathCache.set(pluginId, extraPythonPathsForPlugin(pluginId));
  const importCheck =
    pluginId === 'kanripo-import'
      ? KANRIPO_IMPORT_CHECK
      : pluginId === 'daozang-import'
        ? DAOZANG_IMPORT_CHECK
        : `import ${pythonModuleForPlugin(pluginId)}`;
  const failures: string[] = [];
  let sawWindowsStoreStub = false;

  const recordFailure = (label: string, error: unknown) => {
    const stdout = (error as { stdout?: string })?.stdout ?? '';
    const stderr = (error as { stderr?: string })?.stderr ?? String(error);
    if (isWindowsStoreStub(stdout) || isWindowsStoreStub(stderr)) {
      sawWindowsStoreStub = true;
    }
    const reason = stderr.trim().split('\n').pop() ?? stdout.trim() ?? 'unknown error';
    failures.push(`${label}: ${reason}`);
    logPluginPython(pluginId, 'candidate rejected', { python: label, reason });
  };

  for (const python of pythonCandidatesForPlugin(pluginId)) {
    const label = commandLabel(python);
    try {
      await execFileAsync(python.bin, [...python.args, '-c', importCheck], {
        timeout: 15_000,
        env: forceUtf8Env(pythonEnvForPlugin(pluginId)),
      });
      pythonCache.set(pluginId, python);
      logPluginPython(pluginId, 'using python', {
        python: label,
        pythonPath: extraPythonPathCache.get(pluginId),
      });
      return python;
    } catch (error) {
      const stderr = (error as { stderr?: string })?.stderr ?? String(error);
      if (
        pluginId === 'kanripo-import' &&
        isMissingKanripoApiModule(stderr) &&
        (await tryAutoInstallKanripoApi(pluginId, python))
      ) {
        try {
          await execFileAsync(python.bin, [...python.args, '-c', importCheck], {
            timeout: 15_000,
            env: forceUtf8Env(pythonEnvForPlugin(pluginId)),
          });
          pythonCache.set(pluginId, python);
          logPluginPython(pluginId, 'using python (auto-installed kanripo API)', { python: label });
          return python;
        } catch (retryError) {
          recordFailure(label, retryError);
          continue;
        }
      }
      recordFailure(label, error);
    }
  }

  const storeStubHint = sawWindowsStoreStub
    ? ' Windows is redirecting "python"/"python3" to its Microsoft Store stub instead of a real interpreter.'
    : '';
  const failureHint = failures.length > 0 ? ` [${failures.join(' | ')}]` : '';
  const reinstallHint =
    pluginId === 'kanripo-import'
      ? ' Reinstall the plugin from Tools → Plugins (Install from folder… → plugin-kanripo-import) if you recently updated it.'
      : pluginId === 'daozang-import'
        ? ' Reinstall the plugin from Tools → Plugins (Install from folder… → plugin-daozang-import) if you recently updated it.'
        : '';
  throw new Error(
    `Plugin ${pluginId} Python backend is not available.${storeStubHint}${reinstallHint}${failureHint}`,
  );
};

const resolvePluginPython = async (pluginId: string): Promise<PythonCommand> => {
  if (pluginId === 'cjk-dates') return resolveCjkDatesPython();
  return resolveGenericPluginPython(pluginId);
};

const pythonEnvForPlugin = (pluginId: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const installRoot = pluginInstallRootForPython(pluginId);
  if (installRoot) {
    env.GROGNARD_PLUGIN_INSTALL_PATH = installRoot;
  }
  // Scratch dir for rebuilt catalog indexes. The xml-p5 checkout lives under
  // GROGNARD_PLUGIN_INSTALL_PATH/data/corpus/ (cloned on plugin install / enable).
  try {
    env.GROGNARD_PLUGIN_CACHE_PATH = path.join(app.getPath('userData'), 'plugin-cache', pluginId);
  } catch {
    // app not ready / non-electron context — Python falls back to its data dir
  }
  const extras: string[] = [];
  const devRoot = devRootCache.get(pluginId);
  if (devRoot) extras.push(path.join(devRoot, 'src'));
  extras.push(...(extraPythonPathCache.get(pluginId) ?? extraPythonPathsForPlugin(pluginId)));
  const unique = [...new Set(extras.filter(Boolean))];
  if (unique.length) {
    env.PYTHONPATH = [...unique, env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  }
  return env;
};

const runPluginPythonCli = async (
  pluginId: string,
  payload: Record<string, unknown>,
  onProgress?: PluginPythonProgressCallback,
): Promise<string> => {
  // setPluginProject() clears the snapshot cache (e.g. on opening a project) and
  // nothing guarantees it is rebuilt before the first plugin call.
  if (!getCachedPluginHostSnapshot()) await getPluginHostSnapshot();
  const useStream = Boolean(onProgress && (payload.chunks || payload.dates));
  const moduleName = pythonModuleForPlugin(pluginId);

  // Resolved before the executor rather than inside it: an `async` executor
  // swallows anything thrown after the first await, leaving the promise
  // permanently pending. A rejection here propagates through this function
  // instead, which is what callers already expect.
  const python = await resolvePluginPython(pluginId);

  return new Promise((resolve, reject) => {
    const input = JSON.stringify(useStream ? { ...payload, stream: true } : payload);
    const t0 = Date.now();
    logPluginPython(pluginId, 'spawn', {
      module: moduleName,
      python: commandLabel(python),
      stream: useStream,
      chunks: Array.isArray(payload.chunks) ? payload.chunks.length : 0,
    });

    const child = spawn(
      python.bin,
      [...python.args, '-c', `from ${moduleName} import cli_main; cli_main()`],
      {
        env: forceUtf8Env({
          ...pythonEnvForPlugin(pluginId),
          PYTHONWARNINGS: 'ignore::RuntimeWarning',
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let resultLine: string | null = null;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const timeoutMs = pythonTimeoutMs(pluginId, payload);
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      settled = true;
      reject(new Error(`Plugin ${pluginId} Python timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    // A pipe delivers arbitrary byte chunks, so a multi-byte UTF-8 character (every Han character
    // is 3 or 4 bytes) can straddle two of them; decoding each chunk alone turns both halves into
    // U+FFFD and silently corrupts the text. The decoder holds the partial character back.
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    const takeStdout = (text: string) => {
      if (useStream) {
        lineBuffer += text;
        let newline = lineBuffer.indexOf('\n');
        while (newline !== -1) {
          const line = lineBuffer.slice(0, newline).trim();
          lineBuffer = lineBuffer.slice(newline + 1);
          if (line) {
            try {
              const event = JSON.parse(line) as { type: string };
              if (event.type === 'result') {
                resultLine = line;
              } else if (event.type === 'init' || event.type === 'chunk') {
                onProgress?.(event as PluginPythonProgressEvent);
                logPluginPython(pluginId, 'progress', event as Record<string, unknown>);
              }
            } catch {
              logPluginPython(pluginId, 'bad progress line', { line: line.slice(0, 200) });
            }
          }
          newline = lineBuffer.indexOf('\n');
        }
      } else {
        stdout += text;
      }
    };
    child.stdout.on('data', (chunk: Buffer) => takeStdout(stdoutDecoder.write(chunk)));

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += stderrDecoder.write(chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (settled) return;
      settled = true;
      takeStdout(stdoutDecoder.end());
      stderr += stderrDecoder.end();
      logPluginPython(pluginId, 'done', { code, ms: Date.now() - t0 });
      if (code !== 0) {
        const lines = stderr
          .trim()
          .split('\n')
          .filter((line) => line.trim());
        const tracebackIdx = lines.findIndex((line) => line.startsWith('Traceback'));
        const detail =
          tracebackIdx >= 0
            ? lines.slice(tracebackIdx).join('\n')
            : lines.filter((line) => !line.includes('FutureWarning')).join('\n');
        logPluginPython(pluginId, 'failed', { code, stderr: detail.slice(0, 2000) });
        reject(new Error(detail.trim() || `${pluginId} python exited with code ${code}`));
        return;
      }
      if (useStream) {
        if (lineBuffer.trim()) resultLine = lineBuffer.trim();
        if (!resultLine) {
          reject(new Error(`Plugin ${pluginId} stream mode returned no result line`));
          return;
        }
        resolve(resultLine);
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(input);
    child.stdin.end();
  });
};

const parseSanmiaoStdout = (stdout: string, payload: Record<string, unknown>): unknown => {
  const parsed = JSON.parse(stdout) as { type?: string; results?: unknown };
  if (parsed && parsed.type === 'result' && 'results' in parsed) {
    return parsed.results;
  }
  if (payload.mode === 'authority') {
    return parsed;
  }
  if (payload.text && !payload.chunks && !payload.dates) {
    return Array.isArray(parsed) ? parsed : parsed;
  }
  return parsed;
};

/** Invoke a hybrid plugin Python backend; returns parsed JSON for sanmiao tei_bridge protocol. */
export const invokePluginPython = async (
  pluginId: string,
  payload: Record<string, unknown>,
  onProgress?: PluginPythonProgressCallback,
): Promise<unknown> => {
  if (!isPluginEnabledInMain(pluginId)) {
    throw new Error(`Plugin not enabled: ${pluginId}`);
  }
  const stdout = await runPluginPythonCli(pluginId, payload, onProgress);
  return parseSanmiaoStdout(stdout, payload);
};

/** Like invokePluginPython but for install-time setup (corpus sync before the plugin is enabled). */
export const invokePluginPythonSetup = async (
  pluginId: string,
  payload: Record<string, unknown>,
): Promise<unknown> => {
  const stdout = await runPluginPythonCli(pluginId, payload);
  return JSON.parse(stdout.trim());
};

export const clearPluginPythonCache = (pluginId?: string): void => {
  if (pluginId) {
    pythonCache.delete(pluginId);
    devRootCache.delete(pluginId);
    extraPythonPathCache.delete(pluginId);
    return;
  }
  pythonCache.clear();
  devRootCache.clear();
  extraPythonPathCache.clear();
};
