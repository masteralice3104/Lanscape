# Lanscape
LANを空間として把握するために、既知のIPv4セグメントを能動探索し、CSVインベントリを標準出力に出すツールです。

## インストール
- Windows / macOS / Linux
- Node.js 20+
- 依存: `multicast-dns`, `net-snmp`, `murmurhash3js-revisited`
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
- `--http-headers` HTTPヘッダ取得を有効化（既定ON）
- `--no-http-headers` HTTPヘッダ取得を無効化
- `--favicon` Faviconハッシュ取得を有効化（既定ON）
- `--no-favicon` Faviconハッシュ取得を無効化
- `--mac` MACアドレス取得を有効化（既定ON）
- `--no-mac` MACアドレス取得を無効化
- `--mac-timeout <ms>` MAC取得タイムアウト（既定 2000）
- `--os-guess` OS推定を有効化（既定ON）
- `--no-os-guess` OS推定を無効化
- `--ssh-banner` SSHバナー取得を有効化（既定ON）
- `--no-ssh-banner` SSHバナー取得を無効化
- `--ssh-timeout <ms>` SSHタイムアウト（既定 2000）
- `--smb-banner` SMBバナー取得を有効化（既定ON）
- `--no-smb-banner` SMBバナー取得を無効化
- `--smb-timeout <ms>` SMBタイムアウト（既定 2000）
- `--cert-cn` 証明書CN取得を有効化（既定ON）
- `--no-cert-cn` 証明書CN取得を無効化
- `--cert-timeout <ms>` 証明書タイムアウト（既定 2000）
- `--ssdp` SSDPを有効化（既定ON）
- `--no-ssdp` SSDPを無効化
- `--ssdp-timeout <ms>` SSDPタイムアウト（既定 2000）
- `--snmp` SNMPを有効化（既定ON）
- `--no-snmp` SNMPを無効化
- `--snmp-community <name>` SNMPコミュニティ（既定 public）
- `--snmp-timeout <ms>` SNMPタイムアウト（既定 2000）
- `--mdns-services` mDNSサービス取得を有効化（既定ON）
- `--no-mdns-services` mDNSサービス取得を無効化
- `--format csv` 将来拡張用（v0.1はcsvのみ）
- `--config <path>` 設定ファイルを指定（既定: ./lanscape.config.json）
- `--output <path>` 出力CSVを指定ファイルへ保存（stdoutにも出力）
- `--update-space` space.csv を自動更新（既定）
- `--no-update-space` space.csv の自動更新を無効化
- `--space-from-segment` space.csv の segments をセグメント名で上書き（既定ON）
- `--no-space-from-segment` 上書きを無効化
- `--watch` 定期更新を有効化
- `--once` 単発実行（定期更新を無効化）
- `--watch-interval <ms>` 更新間隔（既定 60000）

## 入力ファイル
### segments.txt（必須）
- 1行=1セグメント: `<SEGMENT_NAME><space><CIDR>`
- 例: `LAN 192.168.100.0/24`

### space.csv（任意）
- ヘッダ必須: `ip,segments,name,auto_name,mac,os_guess,ssh_banner,smb_banner,cert_cn,cert_san,http_server,http_powered_by,http_www_auth,favicon_hash,mdns_services,ssdp_server,ssdp_usn,snmp_sysname,snmp_sysdescr`（旧形式の3列も読み込み可）
- 例:
	- `192.168.100.204,portal,reverse-proxy`
	- `192.168.100.1,edge,rtx210`
- `--update-space` 有効時は、生存IPが毎回 space.csv に追記/更新されます。
- `--space-from-segment` 有効時は `segments` を segments.txt のセグメント名で上書きします。

## 出力CSV
標準出力に以下の列を固定で出力します。

`segment,ip,segments,name,auto_name,mac,os_guess,ssh_banner,smb_banner,cert_cn,cert_san,http_server,http_powered_by,http_www_auth,favicon_hash,mdns_services,ssdp_server,ssdp_usn,snmp_sysname,snmp_sysdescr,source`

- `segment`: segments.txt のセグメント名
- `ip`: alive と判定したIP
- `segments`: space.csv の `segments`
- `name`: space.csv の `name`（空欄なら `auto_name` で補完）
- `auto_name`: rDNS → mDNS → NetBIOS → HTTPタイトル/Serverヘッダ → 証明書CN → SSHバナー → 空 の優先順
- `mac`: 取得できた場合のMACアドレス（ベストエフォート）
- `os_guess`: TTL からのOS推定（ベストエフォート）
- `ssh_banner`: SSHのバナー（22/tcp）
- `smb_banner`: SMBの応答（445/tcp, ベストエフォート）
- `cert_cn`: TLS証明書のCN（443/tcp）
- `cert_san`: TLS証明書のSAN
- `http_server`: HTTPのServerヘッダ
- `http_powered_by`: HTTPのX-Powered-Byヘッダ
- `http_www_auth`: HTTPのWWW-Authenticateヘッダ
- `favicon_hash`: favicon.ico の Murmur3 ハッシュ
- `mdns_services`: mDNSサービス（ベストエフォート）
- `ssdp_server`: SSDPのServer
- `ssdp_usn`: SSDPのUSN
- `snmp_sysname`: SNMP sysName
- `snmp_sysdescr`: SNMP sysDescr
- `source`: `manual` / `rdns` / `mdns` / `netbios` / `http` / `none`

## 制約（v0.1）
- OS標準 `ping` を起動して判定（OSごとに引数が異なる）
- rDNSは `dns.promises.reverse()`
- mDNSは `multicast-dns` で PTR 逆引きを試行
- NetBIOSは Windows のみ（`nbtstat -A`）
- HTTPタイトルは `http://<ip>/` の `<title>`
- `auto_name` は末尾の `.local` を自動で除去
- HTTPがリダイレクトする場合は追従し、エラー/ログイン系の無意味なタイトルは採用しません（必要ならServerヘッダへフォールバック）
- MAC取得はARP/近傍テーブル依存のためVPN越しでは取得できない場合があります
- OS推定はTTL由来のため正確性は保証できません
- SMBバナーはポート疎通確認レベルのベストエフォートです
- SSDP/SNMP/mDNSはネットワーク設定により取得できない場合があります
- MAC/ARP、SNMP/SSH、トポロジ推定は非対応
