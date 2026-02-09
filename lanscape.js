"use strict";

const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const { spawn } = require("child_process");

function fatal(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    timeout: 1000,
    pingConcurrency: 80,
    dnsConcurrency: 30,
    dnsEnabled: true,
    format: "csv",
    segmentsPath: null,
    spacePath: null,
  };

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
        default:
          fatal(`不明なオプションです: ${flag}`);
      }
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    fatal("segments.txt のパスが必要です。");
  }
  if (positional.length > 2) {
    fatal("引数が多すぎます。<segments.txt> [space.csv] のみ指定してください。");
  }

  options.segmentsPath = positional[0];
  options.spacePath = positional[1] || null;

  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    fatal("--timeout は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.pingConcurrency) || options.pingConcurrency <= 0) {
    fatal("--ping-concurrency は正の数値で指定してください。");
  }
  if (!Number.isFinite(options.dnsConcurrency) || options.dnsConcurrency <= 0) {
    fatal("--dns-concurrency は正の数値で指定してください。");
  }
  if (options.format !== "csv") {
    fatal("--format は csv のみサポートしています。");
  }

  return options;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const segmentsContent = readTextFile(options.segmentsPath, "segments.txt");
  const segments = parseSegments(segmentsContent);
  const spaceMap = options.spacePath
    ? parseSpaceCsv(readTextFile(options.spacePath, "space.csv"))
    : new Map();

  process.stdout.write("segment,ip,user_space,auto_name,source\n");

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
      process.stdout.write(`${row}\n`);
    }
  }
}

main().catch((error) => {
  fatal(error && error.message ? error.message : String(error));
});
