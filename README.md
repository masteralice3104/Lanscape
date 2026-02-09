# Lanscape
LANを空間として把握するために、既知のIPv4セグメントを能動探索し、CSVインベントリを標準出力に出すツールです。

## インストール
- Windows 10/11
- Node.js 20+
- npm依存なし

## 使い方
- 対話式（デフォルト）: `node lanscape.js`
	- 初回は設定ファイル作成や samples から入力ファイル生成を案内します。
- 実行形式（非対話）: `node lanscape.js <segments.txt> [space.csv]`
- 例: `node lanscape.js samples/segments.txt samples/space.csv`

### オプション
- `--timeout <ms>` pingタイムアウト（既定 1000）
- `--ping-concurrency <n>` ping並列（既定 80）
- `--dns-concurrency <n>` rDNS並列（既定 30）
- `--no-dns` rDNSを無効化
- `--format csv` 将来拡張用（v0.1はcsvのみ）
- `--config <path>` 設定ファイルを指定（既定: ./lanscape.config.json）

## 入力ファイル
### segments.txt（必須）
- 1行=1セグメント: `<SEGMENT_NAME><space><CIDR>`
- 例: `LAN 192.168.100.0/24`

### space.csv（任意）
- ヘッダ必須: `ip,user_space,manual_name`
- 例:
	- `192.168.100.204,portal,reverse-proxy`
	- `192.168.100.1,edge,rtx210`

## 出力CSV
標準出力に以下の列を固定で出力します。

`segment,ip,user_space,auto_name,source`

- `segment`: segments.txt のセグメント名
- `ip`: alive と判定したIP
- `user_space`: space.csv の `user_space`
- `auto_name`: `manual_name` → rDNS → 空 の優先順
- `source`: `manual` / `rdns` / `none`

## 制約（v0.1）
- Windows前提、Node.jsのみ（TypeScriptは使わない）
- ICMPはOS標準 `ping` を起動して判定
- rDNSは `dns.promises.reverse()` のみ
- MAC/ARP、SNMP/SSH、mDNS/NBNS/HTTPバナー、トポロジ推定は非対応
