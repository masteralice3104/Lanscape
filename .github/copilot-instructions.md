# copilot-instructions.md — Lanscape v0.1（Windows / CSV Inventory）

## 0. 目的（Mission）
Lanscape は「LANを空間（Landscape）として把握する」ために、既知のIPセグメントを能動探索（Active Survey）し、構造化されたインベントリを生成するツールである。

v0.1 は “まず動く最小” を優先し、以下を満たす：
- 既知CIDRのホスト範囲を探索して、生存（alive）IPを列挙する
- ユーザ定義の「空間（user_space）」と「手動名（manual_name）」をマージする
- 自動取得名（auto_name）は **逆引きDNS（rDNS）のみ** を採用する（取得できなければ空）
- 出力は CSV（inventory）を標準出力に出す

## 1. 実装方針（非交渉の制約）
- OS依存を避ける（Windows / macOS / Linux）
- 言語：Node.js（.js）
- TypeScriptは使わない（.jsで完結）
- v0.1 は “依存ゼロ” を推奨（npm依存は無しで開始）。ただし、実装都合で最小限を入れるなら理由をコメントで明記。
- ICMPは **OS標準の `ping` コマンドを呼び出す**（raw socket や ICMPライブラリは使わない）
- 並列化は入れて良いが、Windowsで暴れないよう **並列上限を必ず設ける**

## 2. 入力仕様

### 2.1 segments.txt（必須）
- 1行=1セグメント
- 形式：`<SEGMENT_NAME><space><CIDR>`
- 例：
  - `LAN 192.168.100.0/23`
  - `VPNVLAN 192.168.102.0/24`
  - `SITEB 192.168.101.0/24`
- パース要件：
  - 空行は無視
  - 先頭/末尾の空白はトリム
  - SEGMENT_NAME は空白なしのトークン（`^\S+$`）
  - CIDR は IPv4 のみ（`A.B.C.D/N`）
  - 不正行は **エラー終了**（行番号付きで出す）

### 2.2 space.csv（任意）
- ユーザ定義の「空間（segments）」と「手動名（name）」付与用
- ヘッダ必須：`ip,segments,name,auto_name,mac,os_guess,ssh_banner,smb_banner,cert_cn,cert_san,http_server,http_status,http_location`（旧: `ip,user_space,manual_name`）
  - `name` は空でもよい（空欄なら `auto_name` で補完）
- 例：
  - `192.168.100.204,portal,reverse-proxy`
  - `192.168.100.1,edge,rtx210`
- パース要件：
  - `ip` がキー（同一ipが重複した場合は後勝ち）
  - `user_space` が空でも良い（空文字扱い）
  - `manual_name` が空でも良い
- v0.1 ではCSVの厳密なRFC対応は不要（引用符などは未対応でよい）が、将来拡張しやすいよう関数を分離しておくこと。

## 3. 探索仕様（ICMP Survey）

### 3.1 対象アドレス生成（IPv4 CIDR）
- CIDRからホスト列挙する
- /24以下（一般的なネットワーク）：
  - network address と broadcast address は除外（例：/24なら .0 と .255 を除外）
- /31 /32 は特例：
  - /31 は両方を列挙（ポイントツーポイント想定）
  - /32 はそのIP単体
- 実装は「int変換→範囲生成」でも良い

### 3.2 ping 実行（Windows）
- `ping` を子プロセス起動して判定する
- 推奨コマンド：
  - `ping -n 1 -w 1000 <ip>`
    - `-n 1`：1回送信
    - `-w 1000`：タイムアウトms
- 成功条件：
  - プロセス終了コード `0` を alive とする
- 標準出力は捨ててよい（性能/ノイズ対策）

### 3.3 並列制御
- Windowsでpingを大量起動すると不安定になり得るため、必ず上限を設ける
- v0.1 のデフォルト：
  - ping並列：`80`
  - rDNS並列：`30`
- CLIオプションで変更できるようにする（後述）

## 4. 名称取得（auto_name）
- v0.1 は `manual_name` → rDNS → mDNS → NetBIOS → HTTPタイトル の順で取得
- rDNS: Node.js 標準 `dns.promises.reverse(ip)`
- mDNS: `multicast-dns` で PTR 逆引きを試行
- NetBIOS: Windows のみ `nbtstat -A`
- HTTPタイトル: `http://<ip>/` の `<title>`
- 取得できない場合は空文字
- 優先順位：
  1) `manual_name`（space.csvにある場合）
  2) `rdns`（取得できた場合）
  3) 空

`source` 列は上記に合わせて：
- `manual` / `rdns` / `mdns` / `netbios` / `http` / `none`

## 5. 出力仕様（CSV）

### 5.1 出力先
- **標準出力**（stdout）に書き出す
- ログや進捗は標準エラー（stderr）へ（将来のパイプ利用を邪魔しない）

### 5.2 CSV列（固定）
ヘッダ行を必ず出力する：

`segment,ip,segments,name,auto_name,mac,os_guess,ssh_banner,smb_banner,cert_cn,cert_san,http_server,http_status,http_location,source`

- `segment`：segments.txt のセグメント名
- `ip`：alive と判定したIP
- `segments`：space.csvから（なければ空）
- `name`：space.csvの `name`（空欄なら `auto_name` で補完）
- `auto_name`：lookupService → mdns → ping -a → rdns → netbios → http(タイトル/Server) → cert → ssh → 空
- `cert_san`：TLS証明書SAN
- `http_server`：HTTPヘッダ
- `http_status`：HTTPステータス
- `http_location`：HTTP Location
- `mac`：ARP/近傍テーブルからのベストエフォート取得
- `os_guess`：TTL由来のOS推定
- `ssh_banner`：22/tcp バナー
- `smb_banner`：445/tcp 応答（ベストエフォート）
- `cert_cn`：443/tcp 証明書CN
- `source`：manual / lookup / rdns / mdns / netbios / ping / http / cert / ssh / none

### 5.3 CSVエスケープ
- 値にカンマ/改行/ダブルクォートが入る可能性があるため、最低限のエスケープを実装する：
  - `"` を `""` に置換
  - カンマ/改行/`"` を含む場合は全体を `"` で囲む

## 6. CLI 仕様（最小）
v0.1 は「単一コマンド」で十分。以下の形で実装する：

### 6.1 実行形式
- `node lanscape.js <segments.txt> [space.csv]`

### 6.2 オプション（推奨）
- `--timeout <ms>`：pingタイムアウト（デフォルト 1000）
- `--ping-concurrency <n>`：ping並列（デフォルト 80）
- `--dns-concurrency <n>`：rDNS並列（デフォルト 30）
- `--no-dns`：rDNSしない（auto_nameはmanualのみ）
- `--format csv`：将来の拡張用（v0.1はcsv固定でも可）

※依存ゼロを守るなら、オプションは手書きパースでも良い（必要十分）。

## 7. エラーハンドリング
- segments.txt が読めない／不正 → 非ゼロ終了
- space.csv が指定されて読めない／不正 → 非ゼロ終了
- `ping` コマンドが存在しない/失敗 → エラーをstderrに出し、非ゼロ終了
- rDNS失敗は通常系（空文字）扱い（プロセス停止しない）

## 8. 非目標（Not Goals / v0.1でやらない）
- MACアドレス取得（ARP等）… **やらない**
- SNMP / SSH / ルータ設定解析 … やらない
- トポロジー推定（リンク関係の自動推論）… やらない
- 長期DB（first_seen/last_seen）… v0.2以降

## 9. 期待される挙動（サンプル）

### 入力
segments.txt:
- `LAN 192.168.100.0/23`

space.csv:
- `ip,user_space,manual_name`
- `192.168.100.204,portal,reverse-proxy`

### 出力（例）
segment,ip,user_space,auto_name,source
LAN,192.168.100.204,portal,reverse-proxy,manual
LAN,192.168.100.1,,rtx210,rdns
LAN,192.168.100.10,,,none

※実際の値は環境依存。順序は固定不要（ただし同一セグメント内はIP昇順だと見やすいので推奨）。

## 10. リポジトリ構成（最小）
- `lanscape.js`（単一ファイルでもOK）
- `README.md`
- `samples/segments.txt`
- `samples/space.csv`

将来の分割を見据えるなら：
- `src/` 配下に分けても良いが v0.1 は単一で可。

## 11. README最小（実装側への指示）
READMEには最低限これを含める：
- 目的（1段落）
- インストール（Node 20+）
- 使い方（コマンド例）
- 入力ファイル形式（segments / space）
- 出力CSVの列説明
- 制約（Windows前提、MAC無し、rDNSのみ）

---

以上。v0.1 は “動く最小” を最優先にし、動作確認ができたら v0.2 以降で拡張する。
