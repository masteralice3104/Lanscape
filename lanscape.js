"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const dns = require("dns").promises;
const { spawn } = require("child_process");

function fatal(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const DEFAULT_OPTIONS = {
  timeout: 1000,
  pingConcurrency: 80,
  dnsConcurrency: 30,
  dnsEnabled: true,
  format: "csv",
  segmentsPath: null,
  spacePath: null,
  outputPath: null,
  watchEnabled: false,
  watchIntervalMs: 60000,
  updateSpaceEnabled: true,
};

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };
  let configPath = null;

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [flag, inlineValue] = arg.split("=");
      const takeValue = () => {
        if (inlineValue !== undefined) return inlineValue;
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
          fatal(`オプション ${flag} の値がありません。`);
        }
        i += 1;
        return next;
      };

      switch (flag) {
        case "--timeout":
          options.timeout = Number(takeValue());
          break;
        case "--ping-concurrency":
          options.pingConcurrency = Number(takeValue());
          break;
        case "--dns-concurrency":
          options.dnsConcurrency = Number(takeValue());
          break;
        case "--no-dns":
          options.dnsEnabled = false;
          break;
        case "--format":
          options.format = takeValue();
          break;
        case "--output":
          options.outputPath = takeValue();
          break;
        case "--update-space":
          options.updateSpaceEnabled = true;
          break;
        case "--no-update-space":
          options.updateSpaceEnabled = false;
          break;
        case "--watch":
          options.watchEnabled = true;
          break;
        case "--once":
          options.watchEnabled = false;
          break;
        case "--watch-interval":
          options.watchIntervalMs = Number(takeValue());
          break;
        case "--config":
          configPath = takeValue();
          break;
        default:
          fatal(`不明なオプションです: ${flag}`);
      }
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 2) {
    fatal("引数が多すぎます。<segments.txt> [space.csv] のみ指定してください。");
  }

  options.segmentsPath = positional[0];
  options.spacePath = positional[1] || null;

  return { options, configPath, positionalCount: positional.length };
}

function validateOptions(options) {
  if (!options.segmentsPath) {
    fatal("segments.txt のパスが必要です。");
  }

  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    fatal("--timeout は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.pingConcurrency) || options.pingConcurrency <= 0) {
    fatal("--ping-concurrency は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.dnsConcurrency) || options.dnsConcurrency <= 0) {
    fatal("--dns-concurrency は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.watchIntervalMs) || options.watchIntervalMs <= 0) {
    fatal("--watch-interval は正の数値で指定してください。");
  }
  if (options.format !== "csv") {
    fatal("--format は csv のみサポートしています。");
  }

  return options;
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (error) {
    return false;
  }
}

function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question, defaultValue) =>
    new Promise((resolve) => {
      const suffix = defaultValue !== undefined && defaultValue !== "" ? ` [${defaultValue}]` : "";
      rl.question(`${question}${suffix}: `, (answer) => {
        const trimmed = answer.trim();
        if (trimmed === "" && defaultValue !== undefined) {
          resolve(String(defaultValue));
        } else {
          resolve(trimmed);
        }
      });
    });

  const close = () => rl.close();

  return { ask, close };
}

async function askYesNo(prompt, question, defaultYes) {
  const hint = defaultYes ? "Y/n" : "y/N";
  while (true) {
    const answer = (await prompt.ask(`${question} (${hint})`, "")).toLowerCase();
    if (!answer) return Boolean(defaultYes);
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
  }
}

async function askNumber(prompt, question, defaultValue) {
  while (true) {
    const answer = await prompt.ask(question, String(defaultValue));
    const value = Number(answer);
    if (Number.isFinite(value) && value > 0) return value;
    process.stderr.write("数値（正の値）を入力してください。\n");
  }
}

function loadConfig(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    fatal(`設定ファイルを読み込めません: ${filePath}`);
  }
}

function saveConfig(filePath, options) {
  const payload = {
    segmentsPath: options.segmentsPath,
    spacePath: options.spacePath,
    timeout: options.timeout,
    pingConcurrency: options.pingConcurrency,
    dnsConcurrency: options.dnsConcurrency,
    dnsEnabled: options.dnsEnabled,
    format: options.format,
    outputPath: options.outputPath,
    watchEnabled: options.watchEnabled,
    watchIntervalMs: options.watchIntervalMs,
    updateSpaceEnabled: options.updateSpaceEnabled,
  };
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    fatal(`設定ファイルを書き込めません: ${filePath}`);
  }
}

function applyConfig(options, config, override) {
  const applyValue = (key) => {
    if (config[key] === undefined) return;
    if (override || options[key] === null || options[key] === undefined) {
      options[key] = config[key];
    }
  };

  applyValue("segmentsPath");
  applyValue("spacePath");
  applyValue("timeout");
  applyValue("pingConcurrency");
  applyValue("dnsConcurrency");
  applyValue("dnsEnabled");
  applyValue("format");
  applyValue("outputPath");
  applyValue("watchEnabled");
  applyValue("watchIntervalMs");
  applyValue("updateSpaceEnabled");

  return options;
}

async function ensureSampleFiles(prompt, targetDir) {
  const sampleDir = path.join(__dirname, "samples");
  const sampleFiles = [
    { name: "segments.txt", fallback: "LAN 192.168.100.0/24\n" },
    { name: "space.csv", fallback: "ip,user_space,manual_name\n" },
  ];

  for (const file of sampleFiles) {
    const destPath = path.join(targetDir, file.name);
    const sourcePath = path.join(sampleDir, file.name);
    if (fileExists(destPath)) {
      const overwrite = await askYesNo(prompt, `${file.name} を上書きしますか`, false);
      if (!overwrite) continue;
    }
    let content = file.fallback;
    if (fileExists(sourcePath)) {
      content = readTextFile(sourcePath, `samples/${file.name}`);
    }
    fs.writeFileSync(destPath, content, "utf8");
  }
}

async function interactiveSetup(baseOptions, configPath) {
  const prompt = createPrompt();
  try {
    process.stderr.write("対話式セットアップを開始します。\n");
    const hasConfig = fileExists(configPath);
    if (hasConfig) {
      const useConfig = await askYesNo(prompt, `既存の設定ファイルを使用しますか (${configPath})`, true);
      if (useConfig) {
        const config = loadConfig(configPath);
        return applyConfig({ ...baseOptions }, config, true);
      }
    }

    const wantSamples = await askYesNo(prompt, "samples から入力ファイルを作成しますか", true);
    if (wantSamples) {
      await ensureSampleFiles(prompt, process.cwd());
    }

    const defaultSegments = fileExists(path.join(process.cwd(), "segments.txt"))
      ? "segments.txt"
      : "";
    const segmentsPath = await prompt.ask("segments.txt のパス", defaultSegments || undefined);
    const defaultSpace = fileExists(path.join(process.cwd(), "space.csv")) ? "space.csv" : "";
    const spacePath = await prompt.ask("space.csv のパス（不要なら空欄）", defaultSpace || "");

    const timeout = await askNumber(prompt, "ping タイムアウト(ms)", baseOptions.timeout);
    const pingConcurrency = await askNumber(prompt, "ping 並列数", baseOptions.pingConcurrency);
    const dnsConcurrency = await askNumber(prompt, "rDNS 並列数", baseOptions.dnsConcurrency);
    const dnsEnabled = await askYesNo(prompt, "rDNS を有効にしますか", baseOptions.dnsEnabled);
    const saveOutput = await askYesNo(prompt, "出力CSVをファイルに保存しますか", false);
    const outputPath = saveOutput
      ? await prompt.ask("保存先ファイルパス", "inventory.csv")
      : "";
    const watchEnabled = await askYesNo(prompt, "定期更新を有効にしますか", true);
    const watchIntervalMs = watchEnabled
      ? await askNumber(prompt, "更新間隔(ms)", baseOptions.watchIntervalMs)
      : baseOptions.watchIntervalMs;
    const updateSpaceEnabled = await askYesNo(prompt, "space.csv を自動更新しますか", true);

    const options = {
      ...baseOptions,
      segmentsPath: segmentsPath || null,
      spacePath: spacePath || null,
      timeout,
      pingConcurrency,
      dnsConcurrency,
      dnsEnabled,
      outputPath: outputPath || null,
      watchEnabled,
      watchIntervalMs,
      updateSpaceEnabled,
    };

    const save = await askYesNo(prompt, `設定を保存しますか (${configPath})`, true);
    if (save) {
      saveConfig(configPath, options);
    }

    return options;
  } finally {
    prompt.close();
  }
}

async function resolveOptions(argv) {
  const parsed = parseArgs(argv);
  const configPath = parsed.configPath || path.join(process.cwd(), "lanscape.config.json");

  if (parsed.positionalCount === 0) {
    const interactive = await interactiveSetup(parsed.options, configPath);
    if (interactive.updateSpaceEnabled && !interactive.spacePath) {
      interactive.spacePath = "space.csv";
    }
    return validateOptions(interactive);
  }

  if (parsed.configPath) {
    const config = loadConfig(configPath);
    applyConfig(parsed.options, config, false);
  }

  if (parsed.options.updateSpaceEnabled && !parsed.options.spacePath) {
    parsed.options.spacePath = "space.csv";
  }
  return validateOptions(parsed.options);
}

function readTextFile(filePath, label) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.replace(/^\uFEFF/, "");
  } catch (error) {
    fatal(`${label} を読み込めません: ${filePath}`);
  }
}

function parseSegments(content) {
  const segments = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parts = trimmed.split(/\s+/);
    if (parts.length !== 2) {
      fatal(`segments.txt の ${index + 1} 行目が不正です。`);
    }
    const [segmentName, cidr] = parts;
    if (!/^\S+$/.test(segmentName)) {
      fatal(`segments.txt の ${index + 1} 行目のセグメント名が不正です。`);
    }

    const parsed = parseCidr(cidr, `segments.txt の ${index + 1} 行目`);
    segments.push({ name: segmentName, cidr, ipInt: parsed.ipInt, prefix: parsed.prefix });
  });

  if (segments.length === 0) {
    fatal("segments.txt が空です。");
  }

  return segments;
}

function parseSpaceCsv(content) {
  const map = new Map();
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    fatal("space.csv が空です。");
  }

  const header = lines[0].trim();
  if (header !== "ip,user_space,manual_name") {
    fatal("space.csv のヘッダは ip,user_space,manual_name である必要があります。");
  }

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const parts = line.split(",");
    if (parts.length !== 3) {
      fatal(`space.csv の ${i + 1} 行目が不正です。`);
    }
    const [ip, userSpace, manualName] = parts.map((value) => value.trim());
    if (!ip) {
      fatal(`space.csv の ${i + 1} 行目の ip が空です。`);
    }
    if (!isValidIp(ip)) {
      fatal(`space.csv の ${i + 1} 行目の ip が不正です。`);
    }
    map.set(ip, {
      user_space: userSpace || "",
      manual_name: manualName || "",
    });
  }

  return map;
}

function loadSpaceMap(spacePath, allowMissing) {
  if (!spacePath) {
    return new Map();
  }
  if (!fileExists(spacePath)) {
    if (allowMissing) return new Map();
    fatal(`space.csv を読み込めません: ${spacePath}`);
  }
  return parseSpaceCsv(readTextFile(spacePath, "space.csv"));
}

function updateSpaceCsv(spacePath, spaceMap, aliveIps) {
  if (!spacePath) return;

  const merged = new Map(spaceMap);
  for (const ip of aliveIps) {
    if (!merged.has(ip)) {
      merged.set(ip, { user_space: "", manual_name: "" });
    }
  }

  const rows = ["ip,user_space,manual_name"];
  const sortedIps = Array.from(merged.keys()).sort((a, b) => ipToInt(a) - ipToInt(b));
  for (const ip of sortedIps) {
    const entry = merged.get(ip) || { user_space: "", manual_name: "" };
    rows.push([ip, entry.user_space || "", entry.manual_name || ""].join(","));
  }

  try {
    fs.writeFileSync(spacePath, rows.join("\n") + "\n", "utf8");
  } catch (error) {
    fatal(`space.csv を書き込めません: ${spacePath}`);
  }
}

function parseCidr(cidr, context) {
  const match = cidr.match(/^([0-9.]+)\/(\d{1,2})$/);
  if (!match) {
    fatal(`${context} の CIDR が不正です。`);
  }
  const ip = match[1];
  const prefix = Number(match[2]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    fatal(`${context} の CIDR プレフィックスが不正です。`);
  }
  if (!isValidIp(ip)) {
    fatal(`${context} の IP が不正です。`);
  }
  return { ipInt: ipToInt(ip), prefix };
}

function isValidIp(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function ipToInt(ip) {
  const parts = ip.split(".").map((part) => Number(part));
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function maskFromPrefix(prefix) {
  if (prefix === 0) return 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

function enumerateHosts(ipInt, prefix) {
  if (prefix === 32) {
    return [intToIp(ipInt)];
  }
  const mask = maskFromPrefix(prefix);
  const network = ipInt & mask;
  const broadcast = network | (~mask >>> 0);

  if (prefix === 31) {
    return [intToIp(network), intToIp(broadcast)];
  }

  let start = network;
  let end = broadcast;
  if (prefix <= 24) {
    start = network + 1;
    end = broadcast - 1;
  }

  if (start > end) {
    return [];
  }

  const hosts = [];
  for (let current = start; current <= end; current += 1) {
    hosts.push(intToIp(current >>> 0));
  }
  return hosts;
}

function csvEscape(value) {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, '""');
  if (/[",\r\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
}

function runWithConcurrency(items, limit, worker) {
  return new Promise((resolve, reject) => {
    const results = [];
    let index = 0;
    let active = 0;

    const next = () => {
      if (index >= items.length && active === 0) {
        resolve(results);
        return;
      }

      while (active < limit && index < items.length) {
        const item = items[index];
        index += 1;
        active += 1;
        Promise.resolve()
          .then(() => worker(item))
          .then((result) => {
            results.push(result);
            active -= 1;
            next();
          })
          .catch((error) => reject(error));
      }
    };

    next();
  });
}

function pingAlive(ip, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("ping", ["-n", "1", "-w", String(timeoutMs), ip], {
      stdio: "ignore",
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function reverseDns(ip) {
  try {
    const hosts = await dns.reverse(ip);
    if (!hosts || hosts.length === 0) return "";
    return hosts[0];
  } catch (error) {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSurvey(options) {
  const segmentsContent = readTextFile(options.segmentsPath, "segments.txt");
  const segments = parseSegments(segmentsContent);
  const spaceMap = loadSpaceMap(options.spacePath, options.updateSpaceEnabled);
  const outputStream = options.outputPath
    ? fs.createWriteStream(options.outputPath, { encoding: "utf8" })
    : null;

  const writeLine = (line) => {
    process.stdout.write(`${line}\n`);
    if (outputStream) {
      outputStream.write(`${line}\n`);
    }
  };

  writeLine("segment,ip,user_space,auto_name,source");

  const allAliveIps = [];

  for (const segment of segments) {
    const hosts = enumerateHosts(segment.ipInt, segment.prefix);
    const aliveIps = [];

    try {
      await runWithConcurrency(hosts, options.pingConcurrency, async (ip) => {
        const ok = await pingAlive(ip, options.timeout);
        if (ok) aliveIps.push(ip);
      });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        fatal("ping コマンドが見つかりません。Windows の ping を使用してください。");
      }
      fatal(`ping 実行に失敗しました: ${error.message || error}`);
    }

    aliveIps.sort((a, b) => ipToInt(a) - ipToInt(b));
    allAliveIps.push(...aliveIps);

    const records = aliveIps.map((ip) => {
      const entry = spaceMap.get(ip) || { user_space: "", manual_name: "" };
      return {
        segment: segment.name,
        ip,
        user_space: entry.user_space || "",
        manual_name: entry.manual_name || "",
        auto_name: "",
        source: "none",
      };
    });

    if (options.dnsEnabled) {
      await runWithConcurrency(records, options.dnsConcurrency, async (record) => {
        if (record.manual_name) {
          record.auto_name = record.manual_name;
          record.source = "manual";
          return;
        }
        const rdns = await reverseDns(record.ip);
        if (rdns) {
          record.auto_name = rdns;
          record.source = "rdns";
        } else {
          record.auto_name = "";
          record.source = "none";
        }
      });
    } else {
      for (const record of records) {
        if (record.manual_name) {
          record.auto_name = record.manual_name;
          record.source = "manual";
        } else {
          record.auto_name = "";
          record.source = "none";
        }
      }
    }

    for (const record of records) {
      const row = [
        record.segment,
        record.ip,
        record.user_space,
        record.auto_name,
        record.source,
      ]
        .map(csvEscape)
        .join(",");
      writeLine(row);
    }
  }

  if (options.updateSpaceEnabled) {
    updateSpaceCsv(options.spacePath, spaceMap, allAliveIps);
  }

  if (outputStream) {
    await new Promise((resolve) => outputStream.end(resolve));
  }
}

async function main() {
  const options = await resolveOptions(process.argv.slice(2));
  if (!options.watchEnabled) {
    await runSurvey(options);
    return;
  }

  while (true) {
    const startedAt = new Date();
    process.stderr.write(`--- survey start ${startedAt.toISOString()} ---\n`);
    await runSurvey(options);
    const finishedAt = new Date();
    process.stderr.write(`--- survey done  ${finishedAt.toISOString()} ---\n`);
    await sleep(options.watchIntervalMs);
  }
}

main().catch((error) => {
  fatal(error && error.message ? error.message : String(error));
});
