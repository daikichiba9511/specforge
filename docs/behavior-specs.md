# 振る舞い仕様とは何か

**振る舞い仕様**は、対象がどの状態にあり、どの出来事を受けると、どの条件で何を行い、次にどの状態へ移るかを定める文書である。
API
の型やデータ構造が「何を受け渡すか」を定めるのに対し、振る舞い仕様は「時間の経過に沿って何が起き得るか」を定める。

specforge では、状態に依存する振る舞いを Mermaid `stateDiagram-v2` で記述し、TLA+ または CSPm
へ変換する。 この文書は振る舞い仕様の考え方を説明する。 実際の書き方は
[writing-specs.md](./writing-specs.md)、parser が受理する厳密な入力契約は [spec.md](./spec.md)
を参照する。

## 振る舞い仕様が答える問い

振る舞い仕様の対象は、単なる処理手順ではない。 同じ入力でも、それ以前に起きたことや現在の mode
によって結果が変わる規則である。

例えば注文の `cancel` event
は、注文作成直後なら受理され、発送後なら返品処理へ変換され、返金完了後なら無視されるかもしれない。
この違いは `cancel` の入力値だけからは決まらず、現在の注文状態から決まる。

振る舞い仕様は少なくとも次の問いに答える。

- 対象が取り得る状態は何か。
- 初期状態と終了状態はどこか。
- 各状態で受理する event は何か。
- event を受理しても遷移しない条件は何か。
- 遷移時に外部へ観測される action は何か。
- timeout、失敗、cancel、retry はどの経路を通るか。
- 定義していない state と event の組をどう扱うか。
- 並行して進む状態がある場合、どの event が両方へ届くか。

この問いに答えられない箇所は、実装者が独自判断で埋めることになる。
実装ごとの差異を避けるには、正常系だけでなく拒否と回復の規則まで同じ文書で確定する必要がある。

## 変換仕様とリアクティブ仕様

すべての規則を状態機械で書く必要はない。
履歴に依存しない変換は表で書いたほうが、入力と出力の対応を直接読める。

| 種類           | 判定基準                                     | 適した表現             |
| -------------- | -------------------------------------------- | ---------------------- |
| 変換系         | 出力が現在の入力だけで決まる                 | 決定表、入出力表       |
| リアクティブ系 | 結果が履歴、状態、mode、並列性に依存する     | 状態機械               |
| 混合系         | stateful な制御の中に stateless な変換がある | 状態機械と表を分離する |

税率表から税額を求める処理は、同じ入力に対して常に同じ出力を返すなら変換系である。
ログイン試行回数によって認証、retry、lockout
を切り替える処理は、それ以前の失敗回数に依存するためリアクティブ系である。

混合系では境界を明示する。 例えば注文 workflow
は状態機械で書き、各状態で行う価格計算は別の決定表で書く。 価格計算を state として展開すると、注文
lifecycle と計算規則が混ざり、どちらの変更でも図全体を読み直すことになる。

## 拡張状態機械の構成要素

specforge が扱うモデルは、有限状態機械に状態変数、guard、action を加えた**拡張状態機械**である。

### State

**state** は、次に受理できる event の集合と、その event に対する反応が同じ期間をまとめた名前である。
処理の一行ごとに state を作るのではなく、外部から見た振る舞いが変わる境界に state を置く。

例えば `PaymentRequested` と `PaymentAuthorized` では、同じ `cancel`
を受けたときの返金要否が異なるため、別 state にする根拠がある。 一方、同じ event
を同じ規則で扱う二つの内部関数を、関数名に合わせて別 state にする根拠はない。

### Event

**event** は、状態機械が反応する出来事である。 利用者の操作、外部 subsystem
からの通知、timeout、内部条件の成立が event になり得る。

event 名は発生した事実を表す。 例えば `payment_authorized`
は観測済みの事実であり、`authorize_payment` は命令または action と読める。
同じ事実に複数の名前を与えると、entity 間の同期関係を追えなくなる。

### Guard

**guard** は、event を受理したときに遷移を許す事前条件である。 guard は現在の状態変数、event
payload、定数だけを参照する。

同じ state と event から複数の遷移を出す場合、guard が重なると複数の遷移が同時に可能になる。
非決定性を意図していないなら、`retry_count < limit` と `retry_count >= limit`
のように排他的かつ全域を覆う条件へ分ける。

### Action

**action** は、遷移に伴って外部から観測できる作用である。 通知、永続化、予約、counter
更新などが該当する。

action 名は振る舞い上の目的を表し、実装手段を表さない。 `emit_order_confirmed`
なら通信の意味を保てるが、`publish_to_sns_topic` では middleware の変更が仕様変更に見えてしまう。

### State Variable

**state variable** は、有限個の state 名だけでは表しにくい値を保持する。 残高、retry
count、在庫数などが該当する。

state variable を追加すると、model checker が探索する状態空間も増える。
振る舞いの分岐に使わない実装上の値は含めず、検証したい性質に必要な値だけを宣言する。

## 完全性の定義

振る舞い仕様の完全性は、「現実のすべてを記述すること」を意味しない。
仕様が選んだ抽象度の中で、取り得る state と event の組に解釈の空白がないことを意味する。

未定義の組は、次のいずれかで扱いを確定する。

- 明示的な遷移を書く。
- no-op または self-loop として無視する既定規則を書く。
- error とする既定規則を書く。
- invariant により、その組が到達不能であると説明する。

「UI から送られないはず」は、振る舞い上の根拠にならない場合がある。 別
client、retry、遅延配送によって event
が届く可能性があるなら、受信側の規則として扱いを定義する必要がある。

異常系も完全性の一部である。 成功経路だけを細かく書き、timeout と失敗を「error
handling」とまとめると、retry 中の cancel や重複通知の扱いが未定義のまま残る。

## 状態数を増やさずに組合せを表す

複数の状態軸をそのまま掛け合わせると、state 数は各軸の積になる。
支払いに三状態、配送に四状態あれば、単純な直積は十二状態になる。

spec-behavior では次の三つの方法で直積を分解する。

- **禁止状態**：存在できない組合せを state として作らず、不変条件として記録する。
- **遷移制限**：許可しない移動を省き、必要なら reject または no-op を書く。
- **モード依存**：同じ event の意味が mode ごとに変わる場合、hierarchy で mode を分ける。

独立して進む状態軸には**直交領域**を使う。 直交領域は図を短くする記法ではなく、複数の region
が同時に active であるという意味を持つ。

一つの event を複数 region が同時に観測する場合、各 region に同じ event 名を書く。 この broadcast
規則により、名前の一致が同期契約になる。

ただし、現在の specforge backend は直交領域を interleaving として変換し、同名 event の同期を
まだ生成しない。 broadcast を含む仕様では、記述上の契約と model checker が検証した範囲を分けて
記録する。

## 複数 entity の境界

複数の subsystem を一つの巨大な状態機械に入れると、内部状態と通信契約が混ざる。 entity
ごとに状態機械を分け、共有 event を event contract table で接続する。

event contract には producer、consumer、同期性、配送保証、通信形状、payload を書く。 sequence
diagram は代表的な順序を示す補助資料として使えるが、各 entity の取り得る全状態を表す state machine
の代わりにはならない。

共有状態を使う場合は、値の owner、reader、writer、排他方針を定める。 複数 writer
が同じ値を更新できるのに競合規則がない仕様は、単一 entity
の図が正しくても合成後の振る舞いが確定しない。

## 振る舞いと実装の境界

振る舞い仕様は「何が観測され、どの順序が許されるか」を記述する。
実装文書は「どの製品、module、queue、database で実現するか」を記述する。

| 振る舞い仕様に置くもの          | 実装文書に置くもの           |
| ------------------------------- | ---------------------------- |
| sync または async               | broker や queue の製品名     |
| at-least-once などの配送保証    | retry 設定と DLQ 名          |
| ordering guarantee              | topic や resource の具体名   |
| 永続化後に event を発行する規則 | transaction や outbox の実装 |
| state と transition             | class と function の構成     |

この分離は実装詳細を隠すためだけに行うのではない。 同じ behavior
を別実装で満たせるようにし、実装変更と要求変更を別の差分としてレビューするために行う。

## 形式検証との関係

specforge は Mermaid と補助表を typed AST に変換し、TLA+ と CSPm を生成する。 TLC
は有限化した状態空間を探索し、deadlock、invariant 違反、宣言済み liveness property の反例を探す。

形式検証が扱うのは、仕様に書かれた state、variable、transition、property である。
仕様に書かれていない要求や、実装が仕様へ一致しているかは検証できない。

`verified ok` は次の意味に限定して読む。

> 指定した bound と fairness の下で、生成された model に宣言済み property の反例が見つからなかった。

したがって、要求レビュー、spec-behavior の意味レビュー、specforge の静的 validation、TLC の model
checking は別々に行う。 それぞれが異なる種類の欠陥を検出する。

現在の変換では、action による state variable update、複数 spec file の合成、refinement、直交領域の
broadcast 同期は検証範囲外である。これらを文書に書くことはできるが、`verified ok` の対象には
含まれない。

## 文書の読み分け

- [writing-specs.md](./writing-specs.md)：仕様を一枚ずつ作る手順と template
- [spec.md](./spec.md)：Mermaid subset、Markdown table、変換 semantics の入力契約
- [label-reading.md](./label-reading.md)：`event [guard] / action` の読み方
- [concepts.md](./concepts.md)：TLA+、CSP、safety、liveness の背景
- [behavior.md](./behavior.md)：specforge 自身を対象にした self-dogfood spec
- [../examples/README.md](../examples/README.md)：正常例と反例
