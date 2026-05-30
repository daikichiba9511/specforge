# CSP / CSPm の読み方入門

specforge が CSPm 形式で出力する process 定義を読めるようになるための短いガイド。 厳密な意味論は
扱わず、 「式を見て何が起きるか想像できる」レベルを目標にする。 背景理論は
[`./concepts.md`](./concepts.md) §4.1 を参照。

> CSP は specforge の secondary backend (FDR4 環境がある場合の追加検証用)。 primary backend は
> TLA+ + TLC で、 そちらの読み方は別途必要なら追加予定。

---

## 1. 何を読めるようになるか

specforge は spec を CSPm に変換すると、 たとえば下記のような出力を吐く (以下は
`examples/vending-machine.md` の Idle プロセス抜粋):

```cspm
Idle(balance) = coin_inserted?balance -> (balance > 0) & enter_selecting -> Selecting(balance)
```

これを読み解けるのが本ガイドのゴール。 1 行で何が起きてるかを段階的に分解する。

---

## 2. 一番基本: process と event

CSP の世界には 2 つの主役がいる:

- **event** — 起きること (`coin_inserted`、 `tick` 等の atomic な動作 / 観測)
- **process** — event を順番に受け付けたり並行で扱ったりする 何か

process 定義は等式で書く:

```cspm
P = a -> b -> SKIP
```

これは「process `P` は event `a` を受けた後、 event `b` を受けて、 終了する」と読む。 `SKIP`
は「無事終わった」を表す特別な process。 `STOP` も特別で「もう何も受け付けない (deadlock)」。

---

## 3. 一番使う演算子 — prefix と choice

### `a -> P` (prefix)

「event `a` を受けて process `P` に遷移する」。 一番基本の構文。 a の前に -> の左辺、 P の前に ->
の右辺、 と覚える。

```cspm
Door = open -> close -> Door
```

これは「open を受けて close を受けて、 また初期状態 Door に戻る」 = 無限の open/close 繰り返し。

### `P [] Q` (external choice、 外部選択)

「環境 (= 外側) が選んだ方の event で進む」。 通常は「P の最初の event か Q の最初の event の
どちらか好きな方を受け付ける」と読める:

```cspm
ATM = insert_card -> Authed [] press_cancel -> Idle
```

ユーザは `insert_card` か `press_cancel` のどちらかを送る。 ATM はその選択に従って遷移する。

### `P |~| Q` (internal choice、 内部選択)

外部からは選べず、 process が勝手にどちらかになる。 specforge では普段使わない (deterministic spec
を吐く)。 知識として知っておけば十分。

---

## 4. 終了と中断

| 記号   | 意味                                              |
| ------ | ------------------------------------------------- |
| `SKIP` | 正常終了 (`\checkmark` event を 1 つ吐いて止まる) |
| `STOP` | 何もできない停止 (= deadlock)                     |

specforge の CSPm 出力では、 `[*]` (Mermaid の終了擬似状態) は `SKIP` に変換される。

---

## 5. 合成 (composition) — process を組み合わせる 3 つの方法

CSP の真骨頂は、 小さい process を組み合わせて大きな system を作れること。 組み合わせ方は
**同期の度合い** で 3 つに分かれる。

### 5.1 順序合成 `P ; Q`

「P が SKIP したら Q を始める」。 sequential 合成。 specforge では composite の **完了遷移**
(`/ action` ラベル) に使われる:

```cspm
Setup = (Prelabel ||| LSBuild) ; notify_complete -> Working
```

「Prelabel と LSBuild を並行 (`|||`) で走らせ、 両方 SKIP したら notify_complete をして Working に
進む」。

### 5.2 並行合成 — interleaving `P ||| Q`

「P と Q を並行に走らせる、 ただし event は **同期しない**」。 P の event と Q の event は
別々に好きな順で起こる:

```cspm
Producer ||| Consumer
```

ここで Producer の `produce` event と Consumer の `consume` event は何の制約もなく交互 / 並列に
起きる。 同名 event が両方にあっても同期しない。

### 5.3 並行合成 — synchronized `P [| {ev_a, ev_b} |] Q`

「event 集合 `{ev_a, ev_b}` に属する event でのみ同期、 それ以外は independent」。 共有資源や
broadcast event を表現する:

```cspm
Sender [| {send_msg} |] Receiver
```

`send_msg` event は Sender と Receiver が同時に発火しないと進まない (= rendezvous)。 他の event は
それぞれ独立。

### 5.4 並行合成 — alphabetized `P || Q`

「process が宣言した event 集合 (alphabet) で同期、 alphabet 外の event は他方を blocking」。
specforge は generates しないので参考程度。

### 合成の選び方 — 一枚絵

| 構文            | 同期する event                  | 用途                       |
| --------------- | ------------------------------- | -------------------------- |
| `P ; Q`         | (順序合成、 並行ではない)       | P 完了後に Q               |
| `P \|\|\| Q`    | なし (interleaving)             | 同期なしの並行             |
| `P [\| S \|] Q` | S に属する event                | broadcast / shared channel |
| `P \|\| Q`      | 両 process の alphabet 共通部分 | 厳密な multi-process       |

specforge は **直交領域** (`--` で区切られた composite) を `|||` (interleaving) に変換する。
spec-behavior の broadcast を表現する場合は `[| S |]` を使う想定だが、 現状の specforge は broadcast
対応していない。

---

## 6. 隠蔽 — `P \ X`

「process `P` から event 集合 `X` を観測者から隠す」。 隠蔽された event は内部で起きるが
外から見えなくなる (= tau 動作)。

```cspm
Auth \ {internal_check_lockout, internal_timer_tick}
```

これで外側からは internal_xxx 系 event が見えなくなり、 外部から見た振る舞いだけが残る。 specforge
の `internal_*` 命名規約に対応する処理 (現状未実装、 tasks/todo.md 参照)。

**読むときの注意**: 隠蔽されても event 自体は起きるので、 内部状態の遷移は起きている。 trace
から消えるだけ。

---

## 7. 割り込み — `P /\ Q`

「process `P` を走らせている途中、 process `Q` が任意のタイミングで割り込んで P を破棄、 Q を
始められる」。 specforge では composite の **triggered exit** に使われる:

```cspm
Working /\ (abort -> Cleanup -> Failed)
```

「通常は Working を進めるが、 abort が来たら即座に Cleanup → Failed に切り替わる」。 これにより
region 内のどこにいても abort 経由の終了が表現できる。

---

## 8. Channel と payload — event に値を載せる

### 宣言

```cspm
nametype VAL = {0..1}
channel coin_inserted : VAL
channel filter_done : VAL.VAL  -- 2 引数 (batch_id と filtered_pair_count)
```

`nametype VAL` で取りうる値の集合を定義 (`--bound=N` で `0..N` に変わる)。 channel の `: VAL` は
payload 1 個、 `: VAL.VAL` は 2 個。

### 送信 / 受信 (specforge は受信中心)

| 構文          | 意味                                                            |
| ------------- | --------------------------------------------------------------- |
| `ev!x -> P`   | 値 `x` を載せて event `ev` を起こし、 `P` に進む                |
| `ev?x -> P`   | event `ev` を任意の値で受け取り、 値を変数 `x` に bind して `P` |
| `ev?x.y -> P` | 2 引数 event を bind                                            |

specforge の出力例:

```cspm
Idle(balance) = coin_inserted?balance -> Selecting(balance)
```

これは「event `coin_inserted` を任意の値で受信、 その値を `balance` に bind、 同じ `balance` を
引数として Selecting プロセスに渡す」と読む。 specforge は spec-behavior の **payload field と state
var の名前一致** をこの bind に使う (Phase 2 binding)。

### 受信 + guard combination

```cspm
ev?x -> (x > 0) & action_a -> P
```

`(condition) & process` は **guarded process** で、 condition が false なら **block** (= 進めない、
deadlock)。 specforge は spec の `event [guard] / action` ラベルをこの形に変換する。

---

## 9. specforge 生成 CSPm を実際に読む

`examples/vending-machine.md` 全体の出力を一部抜粋して読み解いてみる:

```cspm
nametype VAL = {0..1}
channel coin_inserted : VAL
channel choose_item
channel refund

Spec = enter_idle -> Idle(0)

Idle(balance) =
    coin_inserted?balance -> (balance > 0) & Selecting(balance)

Selecting(balance) =
    coin_inserted?balance -> Selecting(balance)
    []
    choose_item -> (balance >= 1) & lock_item -> Dispensing(balance)
    []
    refund -> return_all -> Idle(balance)
```

読み下し:

1. `nametype VAL = {0..1}` — 値域は {0, 1} (bound=1)
2. `channel coin_inserted : VAL` — coin_inserted は VAL 1 個分の payload
3. `Spec = enter_idle -> Idle(0)` — 初期化 event の後に balance=0 で Idle 開始
4. `Idle(balance) = coin_inserted?balance -> (balance > 0) & Selecting(balance)` — Idle にいるとき、
   coin_inserted を任意値で受信して balance に bind。 受信値が 0 より大きければ Selecting に進む。 0
   だったら guard が false で block (= 別の event が来るか deadlock)
5. `Selecting(balance) = ... [] ... [] ...` — 3 つの遷移を external choice。 ユーザが coin_inserted
   / choose_item / refund のどれかを送って選ぶ
6. `choose_item -> (balance >= 1) & lock_item -> Dispensing(balance)` — choose_item を受け、 balance
   が 1 以上なら lock_item (= action) を発火、 Dispensing へ。 1 未満なら block
7. `refund -> return_all -> Idle(balance)` — refund を受けたら return_all 発火、 Idle に戻る

ポイント:

- **`?balance`** は state var への shadowing — 受信値が同名 state var を上書きしながら次の
  invocation に流れる
- **`(cond) & action -> Next`** は「cond が true なら action を発火して Next、 false なら block」
- **`[]`** で複数遷移を並べる外部選択

---

## 10. 読むときのチートシート

| 見たもの             | 読み方                              |
| -------------------- | ----------------------------------- |
| `P = a -> b -> SKIP` | a → b の順で起こり終了              |
| `P [] Q`             | P か Q を外部が選ぶ                 |
| `P \|\|\| Q`         | P と Q 並行 (同期なし)              |
| `P [\| S \|] Q`      | S の event だけ同期して並行         |
| `P ; Q`              | P 終わったら Q                      |
| `P /\ Q`             | P 実行中いつでも Q が割り込む       |
| `P \ X`              | P から event 集合 X を隠す          |
| `ev?x -> P`          | ev を任意値で受信、 x に bind       |
| `(cond) & P`         | cond=true なら P、 false なら block |
| `SKIP` / `STOP`      | 正常終了 / deadlock                 |

---

## 11. もっと知りたいとき

- 公式 textbook: Hoare, "Communicating Sequential Processes" (1985 book、 PDF 公開あり)
- 現代的 tutorial: Roscoe, "Understanding Concurrent Systems" (2010, Springer)
- FDR4 公式 + tutorial: https://www.cs.ox.ac.uk/projects/fdr/manual/
- specforge の CSPm 変換セマンティクスの詳細: [`./spec.md`](./spec.md) §7

CSP は notation こそ濃いが、 基本演算子は 7-8 個程度。 上の cheatsheet を手元に置いて specforge
出力を 2-3 個読めば慣れる。
