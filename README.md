# Lanscape
LANを空間として把握するために、既知のIPv4セグメントを能動探索し、CSVインベントリを標準出力に出すツールです。

## インストール
- Windows / macOS / Linux
- Node.js 20+
- 依存: `multicast-dns`
	- `npm install`

## 使い方
- 対話式（デフォルト）: `node lanscape.js`
	- 初回は設定ファイル作成や samples から入力ファイル生成を案内します。
	- 出力CSVの保存有無も対話で設定できます。
	- 既定で定期更新（watch）を有効にします。
	- 既定で space.csv を自動更新します（alive IP を追加）。
- 実行形式（非対話）: `node lanscape.js <segments.txt> [space.csv]`
- 例: `node lanscape.js samples/segments.txt samples/space.csv`

### オプション
- `--timeout <ms>` pingタイムアウト（既定 1000）
- `--ping-concurrency <n>` ping並列（既定 80）
- `--dns-concurrency <n>` rDNS並列（既定 30）
- `--no-dns` rDNSを無効化
- `--mdns` mDNS名取得を有効化（既定ON）
- `--no-mdns` mDNS名取得を無効化
- `--mdns-timeout <ms>` mDNSタイムアウト（既定 2000）
- `--netbios` NetBIOS名取得を有効化（既定ON）
- `--no-netbios` NetBIOS名取得を無効化
- `--http-title` HTTPタイトル取得を有効化（既定ON）
- `--no-http-title` HTTPタイトル取得を無効化
- `--http-timeout <ms>` HTTP/NetBIOS タイムアウト（既定 2000）
- `--format csv` 将来拡張用（v0.1はcsvのみ）
- `--config <path>` 設定ファイルを指定（既定: ./lanscape.config.json）
- `--output <path>` 出力CSVを指定ファイルへ保存（stdoutにも出力）
- `--update-space` space.csv を自動更新（既定）
- `--no-update-space` space.csv の自動更新を無効化
- `--space-from-segment` space.csv の user_space をセグメント名で上書き（既定ON）
- `--no-space-from-segment` 上書きを無効化
- `--watch` 定期更新を有効化
- `--once` 単発実行（定期更新を無効化）
- `--watch-interval <ms>` 更新間隔（既定 60000）

## 入力ファイル
### segments.txt（必須）
- 1行=1セグメント: `<SEGMENT_NAME><space><CIDR>`
- 例: `LAN 192.168.100.0/24`

### space.csv（任意）
- ヘッダ必須: `ip,user_space,manual_name,auto_name`（旧形式の3列も読み込み可）
- 例:
	- `192.168.100.204,portal,reverse-proxy`
	- `192.168.100.1,edge,rtx210`
- `--update-space` 有効時は、生存IPが毎回 space.csv に追記/更新されます。
- `--space-from-segment` 有効時は `user_space` を segments.txt のセグメント名で上書きします。

## 出力CSV
標準出力に以下の列を固定で出力します。

`segment,ip,user_space,auto_name,source`

- `segment`: segments.txt のセグメント名
- `ip`: alive と判定したIP
- `user_space`: space.csv の `user_space`
- `auto_name`: `manual_name` → rDNS → mDNS → NetBIOS → HTTPタイトル → 空 の優先順
- `source`: `manual` / `rdns` / `mdns` / `netbios` / `http` / `none`

## 制約（v0.1）
- OS標準 `ping` を起動して判定（OSごとに引数が異なる）
- rDNSは `dns.promises.reverse()`
- mDNSは `multicast-dns` で PTR 逆引きを試行
- NetBIOSは Windows のみ（`nbtstat -A`）
- HTTPタイトルは `http://<ip>/` の `<title>`
- `auto_name` は末尾の `.local` を自動で除去
- MAC/ARP、SNMP/SSH、トポロジ推定は非対応
