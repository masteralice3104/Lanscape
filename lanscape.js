"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const dns = require("dns").promises;
const { spawn } = require("child_process");
const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const dgram = require("dgram");
const snmp = require("net-snmp");
const murmur = require("murmurhash3js-revisited");
const multicastDns = require("multicast-dns");

function fatal(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const DEFAULT_OPTIONS = {
  timeout: 1000,
  pingConcurrency: 80,
  dnsConcurrency: 30,
  dnsEnabled: true,
  mdnsEnabled: true,
  mdnsTimeout: 2000,
  netbiosEnabled: process.platform === "win32",
  httpTitleEnabled: true,
  httpTimeout: 2000,
  httpHeaderEnabled: true,
  faviconEnabled: true,
  format: "csv",
  segmentsPath: null,
  spacePath: null,
  outputPath: null,
  watchEnabled: false,
  watchIntervalMs: 60000,
  updateSpaceEnabled: true,
  spaceFromSegment: true,
  macEnabled: true,
  macTimeout: 2000,
  osGuessEnabled: true,
  sshBannerEnabled: true,
  sshTimeout: 2000,
  smbBannerEnabled: true,
  smbTimeout: 2000,
  certCnEnabled: true,
  certTimeout: 2000,
  ssdpEnabled: true,
  ssdpTimeout: 2000,
  snmpEnabled: true,
  snmpCommunity: "public",
  snmpTimeout: 2000,
  mdnsServicesEnabled: true,
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
        case "--mdns":
          options.mdnsEnabled = true;
          break;
        case "--no-mdns":
          options.mdnsEnabled = false;
          break;
        case "--mdns-timeout":
          options.mdnsTimeout = Number(takeValue());
          break;
        case "--netbios":
          options.netbiosEnabled = true;
          break;
        case "--no-netbios":
          options.netbiosEnabled = false;
          break;
        case "--http-title":
          options.httpTitleEnabled = true;
          break;
        case "--no-http-title":
          options.httpTitleEnabled = false;
          break;
        case "--http-timeout":
          options.httpTimeout = Number(takeValue());
          break;
        case "--http-headers":
          options.httpHeaderEnabled = true;
          break;
        case "--no-http-headers":
          options.httpHeaderEnabled = false;
          break;
        case "--favicon":
          options.faviconEnabled = true;
          break;
        case "--no-favicon":
          options.faviconEnabled = false;
          break;
        case "--mac":
          options.macEnabled = true;
          break;
        case "--no-mac":
          options.macEnabled = false;
          break;
        case "--mac-timeout":
          options.macTimeout = Number(takeValue());
          break;
        case "--os-guess":
          options.osGuessEnabled = true;
          break;
        case "--no-os-guess":
          options.osGuessEnabled = false;
          break;
        case "--ssh-banner":
          options.sshBannerEnabled = true;
          break;
        case "--no-ssh-banner":
          options.sshBannerEnabled = false;
          break;
        case "--ssh-timeout":
          options.sshTimeout = Number(takeValue());
          break;
        case "--smb-banner":
          options.smbBannerEnabled = true;
          break;
        case "--no-smb-banner":
          options.smbBannerEnabled = false;
          break;
        case "--smb-timeout":
          options.smbTimeout = Number(takeValue());
          break;
        case "--cert-cn":
          options.certCnEnabled = true;
          break;
        case "--no-cert-cn":
          options.certCnEnabled = false;
          break;
        case "--cert-timeout":
          options.certTimeout = Number(takeValue());
          break;
        case "--ssdp":
          options.ssdpEnabled = true;
          break;
        case "--no-ssdp":
          options.ssdpEnabled = false;
          break;
        case "--ssdp-timeout":
          options.ssdpTimeout = Number(takeValue());
          break;
        case "--snmp":
          options.snmpEnabled = true;
          break;
        case "--no-snmp":
          options.snmpEnabled = false;
          break;
        case "--snmp-community":
          options.snmpCommunity = takeValue();
          break;
        case "--snmp-timeout":
          options.snmpTimeout = Number(takeValue());
          break;
        case "--mdns-services":
          options.mdnsServicesEnabled = true;
          break;
        case "--no-mdns-services":
          options.mdnsServicesEnabled = false;
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
        case "--space-from-segment":
          options.spaceFromSegment = true;
          break;
        case "--no-space-from-segment":
          options.spaceFromSegment = false;
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
  if (!Number.isFinite(options.mdnsTimeout) || options.mdnsTimeout <= 0) {
    fatal("--mdns-timeout は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.httpTimeout) || options.httpTimeout <= 0) {
    fatal("--http-timeout は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.macTimeout) || options.macTimeout <= 0) {
    fatal("--mac-timeout は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.sshTimeout) || options.sshTimeout <= 0) {
    fatal("--ssh-timeout は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.smbTimeout) || options.smbTimeout <= 0) {
    fatal("--smb-timeout は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.certTimeout) || options.certTimeout <= 0) {
    fatal("--cert-timeout は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.ssdpTimeout) || options.ssdpTimeout <= 0) {
    fatal("--ssdp-timeout は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.snmpTimeout) || options.snmpTimeout <= 0) {
    fatal("--snmp-timeout は正の数値で指定してください。");
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
    mdnsEnabled: options.mdnsEnabled,
    mdnsTimeout: options.mdnsTimeout,
    netbiosEnabled: options.netbiosEnabled,
    httpTitleEnabled: options.httpTitleEnabled,
    httpTimeout: options.httpTimeout,
    httpHeaderEnabled: options.httpHeaderEnabled,
    faviconEnabled: options.faviconEnabled,
    macEnabled: options.macEnabled,
    macTimeout: options.macTimeout,
    osGuessEnabled: options.osGuessEnabled,
    sshBannerEnabled: options.sshBannerEnabled,
    sshTimeout: options.sshTimeout,
    smbBannerEnabled: options.smbBannerEnabled,
    smbTimeout: options.smbTimeout,
    certCnEnabled: options.certCnEnabled,
    certTimeout: options.certTimeout,
    ssdpEnabled: options.ssdpEnabled,
    ssdpTimeout: options.ssdpTimeout,
    snmpEnabled: options.snmpEnabled,
    snmpCommunity: options.snmpCommunity,
    snmpTimeout: options.snmpTimeout,
    mdnsServicesEnabled: options.mdnsServicesEnabled,
    format: options.format,
    outputPath: options.outputPath,
    watchEnabled: options.watchEnabled,
    watchIntervalMs: options.watchIntervalMs,
    updateSpaceEnabled: options.updateSpaceEnabled,
    spaceFromSegment: options.spaceFromSegment,
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
  applyValue("mdnsEnabled");
  applyValue("mdnsTimeout");
  applyValue("netbiosEnabled");
  applyValue("httpTitleEnabled");
  applyValue("httpTimeout");
  applyValue("httpHeaderEnabled");
  applyValue("faviconEnabled");
  applyValue("macEnabled");
  applyValue("macTimeout");
  applyValue("osGuessEnabled");
  applyValue("sshBannerEnabled");
  applyValue("sshTimeout");
  applyValue("smbBannerEnabled");
  applyValue("smbTimeout");
  applyValue("certCnEnabled");
  applyValue("certTimeout");
  applyValue("ssdpEnabled");
  applyValue("ssdpTimeout");
  applyValue("snmpEnabled");
  applyValue("snmpCommunity");
  applyValue("snmpTimeout");
  applyValue("mdnsServicesEnabled");
  applyValue("format");
  applyValue("outputPath");
  applyValue("watchEnabled");
  applyValue("watchIntervalMs");
  applyValue("updateSpaceEnabled");
  applyValue("spaceFromSegment");

  return options;
}

async function ensureSampleFiles(prompt, targetDir) {
  const sampleFiles = [
    { name: "segments.txt", fallback: "LAN 192.168.100.0/24\n" },
    {
      name: "space.csv",
      fallback:
        "ip,segments,name,auto_name,mac,os_guess,ssh_banner,smb_banner,cert_cn,cert_san,http_server,http_powered_by,http_www_auth,favicon_hash,mdns_services,ssdp_server,ssdp_usn,snmp_sysname,snmp_sysdescr\n",
    },
  ];

  for (const file of sampleFiles) {
    const destPath = path.join(targetDir, file.name);
    if (fileExists(destPath)) {
      const overwrite = await askYesNo(prompt, `${file.name} を上書きしますか`, false);
      if (!overwrite) continue;
    }
    fs.writeFileSync(destPath, file.fallback, "utf8");
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

    const wantSamples = await askYesNo(prompt, "入力テンプレートを作成しますか", true);
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
    const mdnsEnabled = await askYesNo(prompt, "mDNS 名を取得しますか", baseOptions.mdnsEnabled);
    const mdnsTimeout = mdnsEnabled
      ? await askNumber(prompt, "mDNS タイムアウト(ms)", baseOptions.mdnsTimeout)
      : baseOptions.mdnsTimeout;
    const netbiosEnabled = await askYesNo(prompt, "NetBIOS 名を取得しますか", baseOptions.netbiosEnabled);
    const httpTitleEnabled = await askYesNo(
      prompt,
      "HTTP タイトルから名前を取得しますか",
      baseOptions.httpTitleEnabled,
    );
    const httpTimeout = httpTitleEnabled
      ? await askNumber(prompt, "HTTP タイムアウト(ms)", baseOptions.httpTimeout)
      : baseOptions.httpTimeout;
    const httpHeaderEnabled = await askYesNo(
      prompt,
      "HTTP ヘッダ取得を有効にしますか",
      baseOptions.httpHeaderEnabled,
    );
    const faviconEnabled = await askYesNo(prompt, "Favicon ハッシュ取得を有効にしますか", baseOptions.faviconEnabled);
    const macEnabled = await askYesNo(prompt, "MAC アドレスを取得しますか", baseOptions.macEnabled);
    const macTimeout = macEnabled
      ? await askNumber(prompt, "MAC 取得タイムアウト(ms)", baseOptions.macTimeout)
      : baseOptions.macTimeout;
    const osGuessEnabled = await askYesNo(prompt, "OS推定を有効にしますか", baseOptions.osGuessEnabled);
    const sshBannerEnabled = await askYesNo(prompt, "SSHバナー取得を有効にしますか", baseOptions.sshBannerEnabled);
    const sshTimeout = sshBannerEnabled
      ? await askNumber(prompt, "SSH タイムアウト(ms)", baseOptions.sshTimeout)
      : baseOptions.sshTimeout;
    const smbBannerEnabled = await askYesNo(prompt, "SMBバナー取得を有効にしますか", baseOptions.smbBannerEnabled);
    const smbTimeout = smbBannerEnabled
      ? await askNumber(prompt, "SMB タイムアウト(ms)", baseOptions.smbTimeout)
      : baseOptions.smbTimeout;
    const certCnEnabled = await askYesNo(prompt, "証明書CN取得を有効にしますか", baseOptions.certCnEnabled);
    const certTimeout = certCnEnabled
      ? await askNumber(prompt, "証明書取得タイムアウト(ms)", baseOptions.certTimeout)
      : baseOptions.certTimeout;
    const ssdpEnabled = await askYesNo(prompt, "SSDP を有効にしますか", baseOptions.ssdpEnabled);
    const ssdpTimeout = ssdpEnabled
      ? await askNumber(prompt, "SSDP タイムアウト(ms)", baseOptions.ssdpTimeout)
      : baseOptions.ssdpTimeout;
    const snmpEnabled = await askYesNo(prompt, "SNMP を有効にしますか", baseOptions.snmpEnabled);
    const snmpCommunity = snmpEnabled
      ? await prompt.ask("SNMP コミュニティ", baseOptions.snmpCommunity)
      : baseOptions.snmpCommunity;
    const snmpTimeout = snmpEnabled
      ? await askNumber(prompt, "SNMP タイムアウト(ms)", baseOptions.snmpTimeout)
      : baseOptions.snmpTimeout;
    const mdnsServicesEnabled = await askYesNo(
      prompt,
      "mDNS サービス取得を有効にしますか",
      baseOptions.mdnsServicesEnabled,
    );
    const saveOutput = await askYesNo(prompt, "出力CSVをファイルに保存しますか", false);
    const outputPath = saveOutput
      ? await prompt.ask("保存先ファイルパス", "inventory.csv")
      : "";
    const watchEnabled = await askYesNo(prompt, "定期更新を有効にしますか", true);
    const watchIntervalMs = watchEnabled
      ? await askNumber(prompt, "更新間隔(ms)", baseOptions.watchIntervalMs)
      : baseOptions.watchIntervalMs;
    const updateSpaceEnabled = await askYesNo(prompt, "space.csv を自動更新しますか", true);
    const spaceFromSegment = updateSpaceEnabled
      ? await askYesNo(prompt, "segments をセグメント名で上書きしますか", baseOptions.spaceFromSegment)
      : baseOptions.spaceFromSegment;

    const options = {
      ...baseOptions,
      segmentsPath: segmentsPath || null,
      spacePath: spacePath || null,
      timeout,
      pingConcurrency,
      dnsConcurrency,
      dnsEnabled,
      mdnsEnabled,
      mdnsTimeout,
      netbiosEnabled,
      httpTitleEnabled,
      httpTimeout,
      httpHeaderEnabled,
      faviconEnabled,
      macEnabled,
      macTimeout,
      osGuessEnabled,
      sshBannerEnabled,
      sshTimeout,
      smbBannerEnabled,
      smbTimeout,
      certCnEnabled,
      certTimeout,
      ssdpEnabled,
      ssdpTimeout,
      snmpEnabled,
      snmpCommunity,
      snmpTimeout,
      mdnsServicesEnabled,
      outputPath: outputPath || null,
      watchEnabled,
      watchIntervalMs,
      updateSpaceEnabled,
      spaceFromSegment,
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
  const headers = header.split(",").map((value) => value.trim());
  if (!headers.includes("ip")) {
    fatal("space.csv のヘッダに ip が含まれている必要があります。");
  }

  const normalizeKey = (key) => {
    if (key === "user_space") return "segments";
    if (key === "manual_name") return "name";
    return key;
  };

  const normalizedHeaders = headers.map(normalizeKey);
  const allowed = new Set([
    "ip",
    "segments",
    "name",
    "auto_name",
    "mac",
    "os_guess",
    "ssh_banner",
    "smb_banner",
    "cert_cn",
    "cert_san",
    "http_server",
    "http_powered_by",
    "http_www_auth",
    "favicon_hash",
    "mdns_services",
    "ssdp_server",
    "ssdp_usn",
    "snmp_sysname",
    "snmp_sysdescr",
  ]);
  if (!normalizedHeaders.some((value) => value === "segments")) {
    fatal("space.csv のヘッダに segments（または user_space）が必要です。");
  }
  if (!normalizedHeaders.some((value) => value === "name")) {
    fatal("space.csv のヘッダに name（または manual_name）が必要です。");
  }
  if (!normalizedHeaders.every((value) => allowed.has(value))) {
    fatal("space.csv のヘッダに未対応の列があります。");
  }

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const parts = line.split(",");
    if (parts.length < 3) {
      fatal(`space.csv の ${i + 1} 行目が不正です。`);
    }
    const values = parts.map((value) => value.trim());
    const row = {};
    normalizedHeaders.forEach((key, index) => {
      row[key] = values[index] ?? "";
    });
    const ip = row.ip || "";
    if (!ip) {
      fatal(`space.csv の ${i + 1} 行目の ip が空です。`);
    }
    if (!isValidIp(ip)) {
      fatal(`space.csv の ${i + 1} 行目の ip が不正です。`);
    }
    map.set(ip, {
      segments: row.segments || "",
      name: row.name || "",
      auto_name: row.auto_name || "",
      mac: row.mac || "",
      os_guess: row.os_guess || "",
      ssh_banner: row.ssh_banner || "",
      smb_banner: row.smb_banner || "",
      cert_cn: row.cert_cn || "",
      cert_san: row.cert_san || "",
      http_server: row.http_server || "",
      http_powered_by: row.http_powered_by || "",
      http_www_auth: row.http_www_auth || "",
      favicon_hash: row.favicon_hash || "",
      mdns_services: row.mdns_services || "",
      ssdp_server: row.ssdp_server || "",
      ssdp_usn: row.ssdp_usn || "",
      snmp_sysname: row.snmp_sysname || "",
      snmp_sysdescr: row.snmp_sysdescr || "",
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

function updateSpaceCsv(spacePath, spaceMap, recordMap, spaceFromSegment) {
  if (!spacePath) return;

  const merged = new Map(spaceMap);
  for (const [ip, record] of recordMap.entries()) {
    const existing = merged.get(ip);
    const nextSegments = spaceFromSegment && record.segment ? record.segment : existing?.segments || "";
    if (existing) {
      merged.set(ip, {
        segments: nextSegments,
        name: existing.name || record.name || record.auto_name || "",
        auto_name: record.auto_name || existing.auto_name || "",
        mac: record.mac || existing.mac || "",
        os_guess: record.os_guess || existing.os_guess || "",
        ssh_banner: record.ssh_banner || existing.ssh_banner || "",
        smb_banner: record.smb_banner || existing.smb_banner || "",
        cert_cn: record.cert_cn || existing.cert_cn || "",
        cert_san: record.cert_san || existing.cert_san || "",
        http_server: record.http_server || existing.http_server || "",
        http_powered_by: record.http_powered_by || existing.http_powered_by || "",
        http_www_auth: record.http_www_auth || existing.http_www_auth || "",
        favicon_hash: record.favicon_hash || existing.favicon_hash || "",
        mdns_services: record.mdns_services || existing.mdns_services || "",
        ssdp_server: record.ssdp_server || existing.ssdp_server || "",
        ssdp_usn: record.ssdp_usn || existing.ssdp_usn || "",
        snmp_sysname: record.snmp_sysname || existing.snmp_sysname || "",
        snmp_sysdescr: record.snmp_sysdescr || existing.snmp_sysdescr || "",
      });
    } else {
      merged.set(ip, {
        segments: nextSegments,
        name: record.name || record.auto_name || "",
        auto_name: record.auto_name || "",
        mac: record.mac || "",
        os_guess: record.os_guess || "",
        ssh_banner: record.ssh_banner || "",
        smb_banner: record.smb_banner || "",
        cert_cn: record.cert_cn || "",
        cert_san: record.cert_san || "",
        http_server: record.http_server || "",
        http_powered_by: record.http_powered_by || "",
        http_www_auth: record.http_www_auth || "",
        favicon_hash: record.favicon_hash || "",
        mdns_services: record.mdns_services || "",
        ssdp_server: record.ssdp_server || "",
        ssdp_usn: record.ssdp_usn || "",
        snmp_sysname: record.snmp_sysname || "",
        snmp_sysdescr: record.snmp_sysdescr || "",
      });
    }
  }

  const rows = [
    "ip,segments,name,auto_name,mac,os_guess,ssh_banner,smb_banner,cert_cn,cert_san,http_server,http_powered_by,http_www_auth,favicon_hash,mdns_services,ssdp_server,ssdp_usn,snmp_sysname,snmp_sysdescr",
  ];
  const sortedIps = Array.from(merged.keys()).sort((a, b) => ipToInt(a) - ipToInt(b));
  for (const ip of sortedIps) {
    const entry = merged.get(ip) || {
      segments: "",
      name: "",
      auto_name: "",
      mac: "",
      os_guess: "",
      ssh_banner: "",
      smb_banner: "",
      cert_cn: "",
      cert_san: "",
      http_server: "",
      http_powered_by: "",
      http_www_auth: "",
      favicon_hash: "",
      mdns_services: "",
      ssdp_server: "",
      ssdp_usn: "",
      snmp_sysname: "",
      snmp_sysdescr: "",
    };
    rows.push(
      [
        ip,
        entry.segments || "",
        entry.name || "",
        entry.auto_name || "",
        entry.mac || "",
        entry.os_guess || "",
        entry.ssh_banner || "",
        entry.smb_banner || "",
        entry.cert_cn || "",
        entry.cert_san || "",
        entry.http_server || "",
        entry.http_powered_by || "",
        entry.http_www_auth || "",
        entry.favicon_hash || "",
        entry.mdns_services || "",
        entry.ssdp_server || "",
        entry.ssdp_usn || "",
        entry.snmp_sysname || "",
        entry.snmp_sysdescr || "",
      ]
        .map(csvEscape)
        .join(","),
    );
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

function normalizeName(name) {
  if (!name) return "";
  const trimmed = String(name).trim();
  if (!trimmed) return "";
  const firstPart = trimmed.split(",")[0].trim();
  const cleaned = firstPart.replace(/^(DNS:|IP Address:)/i, "").trim();
  const withoutDot = cleaned.replace(/\.$/, "");
  return withoutDot.replace(/\.local$/i, "");
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

function getPingCommand(timeoutMs, ip) {
  if (process.platform === "win32") {
    return { cmd: "ping", args: ["-n", "1", "-w", String(timeoutMs), ip] };
  }

  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  if (process.platform === "darwin") {
    return { cmd: "ping", args: ["-c", "1", "-W", String(timeoutMs), ip] };
  }

  return { cmd: "ping", args: ["-c", "1", "-W", String(timeoutSeconds), ip] };
}

function pingAlive(ip, timeoutMs) {
  return new Promise((resolve, reject) => {
    const { cmd, args } = getPingCommand(timeoutMs, ip);
    const child = spawn(cmd, args, { stdio: "ignore" });

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

function reverseArpa(ip) {
  return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
}

function mdnsReverse(ip, timeoutMs) {
  return new Promise((resolve) => {
    const mdns = multicastDns();
    const name = reverseArpa(ip);
    const timer = setTimeout(() => {
      mdns.destroy();
      resolve("");
    }, timeoutMs);

    mdns.on("response", (response) => {
      const answers = response.answers || [];
      for (const answer of answers) {
        if (answer.type === "PTR" && answer.name === name && answer.data) {
          clearTimeout(timer);
          mdns.destroy();
          resolve(String(answer.data).replace(/\.$/, ""));
          return;
        }
      }
    });

    mdns.query({
      questions: [{ name, type: "PTR" }],
    });
  });
}

function parseNetbiosName(output) {
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([^\s]+)\s+<00>\s+UNIQUE/i);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function netbiosName(ip, timeoutMs) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve("");
      return;
    }
    const child = spawn("nbtstat", ["-A", ip], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve("");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(parseNetbiosName(output));
    });
  });
}

function extractHtmlTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return match[1].replace(/\s+/g, " ").trim();
}

function isMeaninglessTitle(title) {
  if (!title) return true;
  const value = title.trim().toLowerCase();
  if (!value) return true;
  const badPatterns = [
    /^error/,
    /^login$/, /^login\b/, /^sign in$/, /^sign-in$/, /^signin$/, /^sign in\b/, /^sign\s?in\b/,
    /^forbidden$/, /^unauthorized$/, /^not found$/, /^bad request$/,
    /^moved permanently$/, /^301$/, /^302$/, /^redirect$/, /^redirected$/,
    /^access denied$/, /^service unavailable$/, /^internal server error$/,
  ];
  if (badPatterns.some((pattern) => pattern.test(value))) {
    return true;
  }
  if (/\b(error|login|sign\s?in|forbidden|unauthorized|not found|moved permanently|redirect)\b/i.test(value)) {
    return true;
  }
  return false;
}

function resolveRedirect(baseHost, location, baseScheme) {
  if (!location) return null;
  if (/^https?:\/\//i.test(location)) {
    try {
      const url = new URL(location);
      return { scheme: url.protocol.replace(":", ""), host: url.hostname, path: url.pathname || "/" };
    } catch (error) {
      return null;
    }
  }
  if (location.startsWith("/")) {
    return { scheme: baseScheme, host: baseHost, path: location };
  }
  return { scheme: baseScheme, host: baseHost, path: `/${location}` };
}

function faviconHash(ip, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: ip,
        port: 80,
        path: "/favicon.ico",
        method: "GET",
        timeout: timeoutMs,
        headers: {
          "User-Agent": "Lanscape/0.1",
        },
      },
      (res) => {
        const chunks = [];
        let total = 0;
        const maxBytes = 256 * 1024;
        res.on("data", (chunk) => {
          if (total < maxBytes) {
            chunks.push(chunk);
            total += chunk.length;
          }
        });
        res.on("end", () => {
          if (chunks.length === 0) {
            resolve("");
            return;
          }
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString("base64");
          const hash = murmur.x86.hash32(base64);
          resolve(String(hash));
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      resolve("");
    });
    req.on("error", () => resolve(""));
    req.end();
  });
}

function httpInfo(ip, timeoutMs) {
  const maxRedirects = 3;

  const requestOnce = (scheme, host, path, redirectsLeft) =>
    new Promise((resolve) => {
      const client = scheme === "https" ? https : http;
      const req = client.request(
        {
          host,
          port: scheme === "https" ? 443 : 80,
          path,
          method: "GET",
          timeout: timeoutMs,
          rejectUnauthorized: false,
          headers: {
            "User-Agent": "Lanscape/0.1",
          },
        },
        (res) => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && redirectsLeft > 0) {
            const redirect = resolveRedirect(host, res.headers.location, scheme);
            if (redirect) {
              res.resume();
              requestOnce(redirect.scheme, redirect.host, redirect.path, redirectsLeft - 1).then(resolve);
              return;
            }
          }

          let body = "";
          const serverHeader = res.headers.server ? String(res.headers.server) : "";
          const poweredBy = res.headers["x-powered-by"] ? String(res.headers["x-powered-by"]) : "";
          const wwwAuth = res.headers["www-authenticate"] ? String(res.headers["www-authenticate"]) : "";
          const maxBytes = 64 * 1024;
          res.on("data", (chunk) => {
            if (body.length < maxBytes) {
              body += chunk.toString("utf8");
            }
          });
          res.on("end", () => {
            const title = extractHtmlTitle(body);
            if (title && !isMeaninglessTitle(title)) {
              resolve({ name: title, serverHeader, poweredBy, wwwAuth });
              return;
            }
            const serverName = normalizeName(serverHeader);
            if (serverName && !isMeaninglessTitle(serverName)) {
              resolve({ name: serverName, serverHeader, poweredBy, wwwAuth });
              return;
            }
            resolve({ name: "", serverHeader, poweredBy, wwwAuth });
          });
        },
      );

      req.on("timeout", () => {
        req.destroy();
        resolve("");
      });
      req.on("error", () => resolve(""));
      req.end();
    });

  return requestOnce("http", ip, "/", maxRedirects).then((result) => {
    if (result.name || result.serverHeader || result.poweredBy || result.wwwAuth) {
      return result;
    }
    return requestOnce("https", ip, "/", maxRedirects);
  });
}

function normalizeMac(mac) {
  if (!mac) return "";
  const cleaned = mac.trim().replace(/-/g, ":").toLowerCase();
  return cleaned;
}

function parseTtlFromPing(output) {
  const match = output.match(/ttl[=:\s]+(\d+)/i);
  if (!match) return null;
  const ttl = Number(match[1]);
  return Number.isFinite(ttl) ? ttl : null;
}

function osGuessFromTtl(ttl) {
  if (!ttl) return "";
  if (ttl >= 128) return "Windows";
  if (ttl >= 64) return "Linux/Unix";
  if (ttl >= 1) return "Network/Embedded";
  return "";
}

function pingAliveWithTtl(ip, timeoutMs) {
  return new Promise((resolve, reject) => {
    const { cmd, args } = getPingCommand(timeoutMs, ip);
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ alive: true, ttl: parseTtlFromPing(output) });
      } else {
        resolve({ alive: false, ttl: null });
      }
    });
  });
}

function sshBanner(ip, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port: 22 }, () => {});
    let banner = "";
    const timer = setTimeout(() => {
      socket.destroy();
      resolve("");
    }, timeoutMs);

    socket.on("data", (chunk) => {
      banner += chunk.toString("utf8");
      if (banner.includes("\n")) {
        clearTimeout(timer);
        socket.destroy();
        resolve(banner.split(/\r?\n/)[0].trim());
      }
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (!banner) resolve("");
    });
  });
}

function smbBanner(ip, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port: 445 }, () => {
      // SMB does not always send a banner; indicate port open.
      resolve("SMB");
      socket.destroy();
    });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve("");
    }, timeoutMs);
    socket.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
}

function certInfo(ip, timeoutMs) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: ip,
        port: 443,
        servername: ip,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        const cn = cert && cert.subject && cert.subject.CN ? String(cert.subject.CN) : "";
        const san = cert && cert.subjectaltname ? String(cert.subjectaltname) : "";
        resolve({ cn, san });
      },
    );

    socket.on("error", () => resolve({ cn: "", san: "" }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ cn: "", san: "" });
    });
  });
}

function parseSsdpResponse(message) {
  const text = message.toString("utf8");
  const lines = text.split(/\r?\n/);
  const headers = {};
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index > 0) {
      const key = line.slice(0, index).trim().toLowerCase();
      const value = line.slice(index + 1).trim();
      headers[key] = value;
    }
  }
  return {
    server: headers.server || "",
    usn: headers.usn || "",
    st: headers.st || "",
  };
}

function ssdpDiscover(timeoutMs) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const results = new Map();
    const message = Buffer.from(
      [
        "M-SEARCH * HTTP/1.1",
        "HOST: 239.255.255.250:1900",
        "MAN: \"ssdp:discover\"",
        "MX: 1",
        "ST: ssdp:all",
        "",
        "",
      ].join("\r\n"),
    );

    socket.on("message", (msg, rinfo) => {
      const info = parseSsdpResponse(msg);
      if (info.server || info.usn || info.st) {
        results.set(rinfo.address, info);
      }
    });
    socket.on("error", () => {
      socket.close();
      resolve(results);
    });

    socket.bind(() => {
      socket.send(message, 0, message.length, 1900, "239.255.255.250");
    });

    setTimeout(() => {
      socket.close();
      resolve(results);
    }, timeoutMs);
  });
}

function snmpInfo(ip, community, timeoutMs) {
  return new Promise((resolve) => {
    const session = snmp.createSession(ip, community, { timeout: timeoutMs, retries: 0 });
    const oids = ["1.3.6.1.2.1.1.5.0", "1.3.6.1.2.1.1.1.0"]; // sysName, sysDescr
    session.get(oids, (error, varbinds) => {
      session.close();
      if (error) {
        resolve({ sysName: "", sysDescr: "" });
        return;
      }
      const sysName = varbinds[0] && varbinds[0].value ? String(varbinds[0].value) : "";
      const sysDescr = varbinds[1] && varbinds[1].value ? String(varbinds[1].value) : "";
      resolve({ sysName, sysDescr });
    });
  });
}

function mdnsServices(timeoutMs) {
  return new Promise((resolve) => {
    const mdns = multicastDns();
    const serviceTypes = new Set();
    const targetToServices = new Map();

    const timer = setTimeout(() => {
      mdns.destroy();
      resolve(targetToServices);
    }, timeoutMs);

    mdns.on("response", (response) => {
      const answers = response.answers || [];
      for (const answer of answers) {
        if (answer.type === "PTR" && answer.name === "_services._dns-sd._udp.local") {
          serviceTypes.add(answer.data);
          mdns.query({ questions: [{ name: answer.data, type: "PTR" }] });
        }
        if (answer.type === "PTR" && answer.name && answer.name.endsWith(".local")) {
          mdns.query({ questions: [{ name: answer.data, type: "SRV" }] });
        }
        if (answer.type === "SRV" && answer.data && answer.data.target) {
          const target = String(answer.data.target).replace(/\.$/, "");
          const service = String(answer.name).split(".")[0];
          if (!targetToServices.has(target)) {
            targetToServices.set(target, new Set());
          }
          targetToServices.get(target).add(service);
        }
      }
    });

    mdns.query({ questions: [{ name: "_services._dns-sd._udp.local", type: "PTR" }] });
  });
}

function parseMacTable(output) {
  const map = new Map();
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/(\d+\.\d+\.\d+\.\d+).+?([0-9a-fA-F:-]{11,})/);
    if (match) {
      const ip = match[1];
      const mac = normalizeMac(match[2]);
      if (isValidIp(ip) && mac) {
        map.set(ip, mac);
      }
    }
  }
  return map;
}

function getArpCommand() {
  if (process.platform === "win32") {
    return { cmd: "arp", args: ["-a"] };
  }
  if (process.platform === "darwin") {
    return { cmd: "arp", args: ["-a"] };
  }
  return { cmd: "ip", args: ["neigh"] };
}

function loadMacTable(timeoutMs) {
  return new Promise((resolve) => {
    const { cmd, args } = getArpCommand();
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(new Map());
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(new Map());
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(parseMacTable(output));
    });
  });
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

  writeLine(
    "segment,ip,segments,name,auto_name,mac,os_guess,ssh_banner,smb_banner,cert_cn,cert_san,http_server,http_powered_by,http_www_auth,favicon_hash,mdns_services,ssdp_server,ssdp_usn,snmp_sysname,snmp_sysdescr,source",
  );

  const recordMap = new Map();

  const macTable = options.macEnabled ? await loadMacTable(options.macTimeout) : new Map();
  const ssdpMap = options.ssdpEnabled ? await ssdpDiscover(options.ssdpTimeout) : new Map();
  const mdnsServiceMap = options.mdnsServicesEnabled ? await mdnsServices(options.mdnsTimeout) : new Map();

  for (const segment of segments) {
    const hosts = enumerateHosts(segment.ipInt, segment.prefix);
    const aliveIps = [];

    const ttlMap = new Map();

    try {
      await runWithConcurrency(hosts, options.pingConcurrency, async (ip) => {
        const result = await pingAliveWithTtl(ip, options.timeout);
        if (result.alive) {
          aliveIps.push(ip);
          if (result.ttl) ttlMap.set(ip, result.ttl);
        }
      });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        fatal("ping コマンドが見つかりません。Windows の ping を使用してください。");
      }
      fatal(`ping 実行に失敗しました: ${error.message || error}`);
    }

    aliveIps.sort((a, b) => ipToInt(a) - ipToInt(b));

    const records = aliveIps.map((ip) => {
      const entry = spaceMap.get(ip) || {
        segments: "",
        name: "",
        auto_name: "",
        mac: "",
        os_guess: "",
        ssh_banner: "",
        smb_banner: "",
        cert_cn: "",
        cert_san: "",
        http_server: "",
        http_powered_by: "",
        http_www_auth: "",
        favicon_hash: "",
        mdns_services: "",
        ssdp_server: "",
        ssdp_usn: "",
        snmp_sysname: "",
        snmp_sysdescr: "",
      };
      return {
        segment: segment.name,
        ip,
        segments: entry.segments || "",
        name: entry.name || "",
        auto_name: "",
        mac: entry.mac || macTable.get(ip) || "",
        os_guess: entry.os_guess || "",
        ssh_banner: entry.ssh_banner || "",
        smb_banner: entry.smb_banner || "",
        cert_cn: entry.cert_cn || "",
        cert_san: entry.cert_san || "",
        http_server: entry.http_server || "",
        http_powered_by: entry.http_powered_by || "",
        http_www_auth: entry.http_www_auth || "",
        favicon_hash: entry.favicon_hash || "",
        mdns_services: entry.mdns_services || "",
        ssdp_server: entry.ssdp_server || "",
        ssdp_usn: entry.ssdp_usn || "",
        snmp_sysname: entry.snmp_sysname || "",
        snmp_sysdescr: entry.snmp_sysdescr || "",
        source: "none",
        ttl: ttlMap.get(ip) || null,
        mdns_host: "",
        http_name: "",
      };
    });

    for (const record of records) {
      const ssdpInfo = ssdpMap.get(record.ip);
      if (ssdpInfo) {
        record.ssdp_server = ssdpInfo.server || "";
        record.ssdp_usn = ssdpInfo.usn || "";
      }
    }

    await runWithConcurrency(records, options.dnsConcurrency, async (record) => {
      if (options.osGuessEnabled && record.ttl) {
        record.os_guess = osGuessFromTtl(record.ttl);
      }

      if (options.sshBannerEnabled && !record.ssh_banner) {
        record.ssh_banner = await sshBanner(record.ip, options.sshTimeout);
      }
      if (options.smbBannerEnabled && !record.smb_banner) {
        record.smb_banner = await smbBanner(record.ip, options.smbTimeout);
      }
      if (options.certCnEnabled && !record.cert_cn && !record.cert_san) {
        const cert = await certInfo(record.ip, options.certTimeout);
        record.cert_cn = cert.cn || "";
        record.cert_san = cert.san || "";
      }
      if ((options.httpTitleEnabled || options.httpHeaderEnabled) && !record.http_name) {
        const info = await httpInfo(record.ip, options.httpTimeout);
        record.http_name = info.name || "";
        record.http_server = info.serverHeader || "";
        record.http_powered_by = info.poweredBy || "";
        record.http_www_auth = info.wwwAuth || "";
      }
      if (options.faviconEnabled && !record.favicon_hash) {
        record.favicon_hash = await faviconHash(record.ip, options.httpTimeout);
      }
      if (options.snmpEnabled && !record.snmp_sysname && !record.snmp_sysdescr) {
        const info = await snmpInfo(record.ip, options.snmpCommunity, options.snmpTimeout);
        record.snmp_sysname = info.sysName || "";
        record.snmp_sysdescr = info.sysDescr || "";
      }
      }
    });

    await runWithConcurrency(records, options.dnsConcurrency, async (record) => {
      if (options.dnsEnabled) {
        const rdns = normalizeName(await reverseDns(record.ip));
        if (rdns) {
          record.auto_name = rdns;
          record.source = "rdns";
          return;
        }
      }

      if (options.mdnsEnabled) {
        const mdnsRaw = await mdnsReverse(record.ip, options.mdnsTimeout);
        const mdnsName = normalizeName(mdnsRaw);
        if (mdnsRaw) {
          record.mdns_host = mdnsRaw;
          const services = mdnsServiceMap.get(mdnsRaw.replace(/\.$/, ""));
          if (services && services.size > 0) {
            record.mdns_services = Array.from(services).join(";");
          }
        }
        if (mdnsName) {
          record.auto_name = mdnsName;
          record.source = "mdns";
          return;
        }
      }

      if (options.netbiosEnabled) {
        const nb = normalizeName(await netbiosName(record.ip, options.httpTimeout));
        if (nb) {
          record.auto_name = nb;
          record.source = "netbios";
          return;
        }
      }

      if (options.httpTitleEnabled && record.http_name) {
        const httpResult = normalizeName(record.http_name);
        if (httpResult) {
          record.auto_name = httpResult;
          record.source = "http";
          return;
        }
      }

      if (options.certCnEnabled && record.cert_cn) {
        const cn = normalizeName(record.cert_cn);
        if (cn) {
          record.auto_name = cn;
          record.source = "cert";
          return;
        }
      }

      if (options.certCnEnabled && record.cert_san) {
        const san = normalizeName(record.cert_san);
        if (san) {
          record.auto_name = san;
          record.source = "cert";
          return;
        }
      }

      if (options.sshBannerEnabled && record.ssh_banner) {
        const banner = normalizeName(record.ssh_banner);
        if (banner) {
          record.auto_name = banner;
          record.source = "ssh";
          return;
        }
      }

      record.auto_name = "";
      record.source = "none";
    });

    for (const record of records) {
      if (!record.name && record.auto_name) {
        record.name = record.auto_name;
      }
      if (record.name && record.source === "none") {
        record.source = "manual";
      }
    }

    for (const record of records) {
      recordMap.set(record.ip, record);
      const row = [
        record.segment,
        record.ip,
        record.segments,
        record.name,
        record.auto_name,
        record.mac,
        record.os_guess,
        record.ssh_banner,
        record.smb_banner,
        record.cert_cn,
        record.cert_san,
        record.http_server,
        record.http_powered_by,
        record.http_www_auth,
        record.favicon_hash,
        record.mdns_services,
        record.ssdp_server,
        record.ssdp_usn,
        record.snmp_sysname,
        record.snmp_sysdescr,
        record.source,
      ]
        .map(csvEscape)
        .join(",");
      writeLine(row);
    }
  }

  if (options.updateSpaceEnabled) {
    updateSpaceCsv(options.spacePath, spaceMap, recordMap, options.spaceFromSegment);
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
