# CSPとCSPmの読み方

この文書は、specforgeが生成するCSPmを読むための入門である。
式からイベントの順序、選択、並行性を読み取れることを目標にし、厳密な数学的意味論までは扱わない。

**CSP**は、並行して動く処理を、観測できるイベントと処理同士の組合せで表す理論である。
**CSPm**は、そのモデルを記述するための言語である。
specforgeはCSPmを生成できるが、FDR4による検査は自動実行しない。

通常の検証に使うTLA+とTLCを含めた全体像は[基本概念](./concepts.md)を参照する。

## プロセスとイベント

CSPでは、起きることを**イベント**、イベントを受け付けながら振る舞うものを**プロセス**と呼ぶ。

```cspm
P = a -> b -> SKIP
```

この式は、プロセス`P`がイベント`a`を受けた後に`b`を受け、正常終了することを表す。
`->`の左側が次に起きるイベント、右側がその後のプロセスである。

| 記号   | 意味                       |
| ------ | -------------------------- |
| `SKIP` | 正常終了する               |
| `STOP` | 何も受け付けられず停止する |

specforgeは、Mermaidの終端`[*]`を`SKIP`へ変換する。

## イベント接頭辞

`a -> P`は、イベント`a`の後にプロセス`P`として振る舞うことを表す。

```cspm
Door = open -> close -> Door
```

この例は、`open`、`close`の順でイベントを受け、再び同じ振る舞いを繰り返す。

## 選択

### 外部選択`P [] Q`

外部選択は、最初に起きたイベントによって進む側を決める。

```cspm
ATM = insert_card -> Authenticated [] cancel -> Idle
```

環境が`insert_card`を起こせば`Authenticated`へ、`cancel`を起こせば`Idle`へ進む。
specforgeは、一つの状態から出る複数の遷移を外部選択で並べる。

### 内部選択`P |~| Q`

内部選択は、外部から選択結果を制御できない選択である。
現在のspecforgeは通常、この演算子を生成しない。

## ガード

`(condition) & P`は、条件が真のときだけ`P`を選べることを表す。

```cspm
(balance >= 1) & choose_item -> Dispensing
```

残高が1以上なら`choose_item`を受け付けて`Dispensing`へ進める。 条件が偽なら、この選択肢は使えない。
他の選択肢もなければ、プロセスは進めなくなる。

ペイロードのないイベントでは、specforgeはガードをイベントの前へ置く。
ペイロードを受信してから条件を評価する場合は、次のように受信の後へ置く。

```cspm
coin_inserted?balance -> (balance > 0) & Selecting(balance)
```

## チャネルとペイロード

値を持つイベントは、型付きチャネルとして宣言される。

```cspm
nametype VAL = {0..3}
channel coin_inserted : VAL
channel filter_done : VAL.VAL
```

`VAL`は取り得る値の集合であり、`--bound=3`なら`0..3`になる。
`VAL.VAL`は、二つの値を持つイベントを表す。

| 構文          | 意味                                     |
| ------------- | ---------------------------------------- |
| `ev!x -> P`   | 値`x`を送って`P`へ進む                   |
| `ev?x -> P`   | 値を受け取って変数`x`へ束縛し、`P`へ進む |
| `ev?x.y -> P` | 二つの値を受け取って`x`と`y`へ束縛する   |

specforgeは受信形式を生成する。
ペイロード項目と状態変数の名前が一致すると、受信値が同名の引数を置き換え、次のプロセスへ渡される。

```cspm
Idle(balance) =
    coin_inserted?balance -> Selecting(balance)
```

## 順序合成`P ; Q`

`P ; Q`は、`P`が正常終了した後に`Q`を始める。
specforgeは、階層状態の全領域が完了した後に進む完了遷移へ使う。

```cspm
Setup = (Prelabel ||| Build) ; notify_complete -> Working
```

`Prelabel`と`Build`が両方とも正常終了すると、`notify_complete`を経て`Working`へ進む。

## 同期しない並行合成`P ||| Q`

`P ||| Q`は、二つのプロセスを同時に有効にし、それぞれのイベントを同期せずに進める。

```cspm
Producer ||| Consumer
```

`Producer`と`Consumer`のイベントは、可能な順序で交互に起きる。
同名イベントが両方にあっても、同時には起きない。

specforgeは、Mermaidの直交領域をこの演算子へ変換する。

## 同期する並行合成`P [| S |] Q`

`P [| S |] Q`は、集合`S`に含まれるイベントだけを二つのプロセスで同期する。

```cspm
Sender [| {send_message} |] Receiver
```

`send_message`は、`Sender`と`Receiver`の両方が同時に受け入れられるときだけ起きる。

現在のspecforgeは、この同期を生成しない。
直交領域に同じイベント名を書いても、`|||`による同期しない並行合成になる。

## 割り込み`P /\ Q`

`P /\ Q`は、`P`の実行中に`Q`が始まると、`P`を中断して`Q`へ移ることを表す。

```cspm
Working /\ (abort -> Cleanup -> Failed)
```

specforgeは、階層状態の内部処理が完了する前に外へ出る遷移へ、この演算子を使う。

## 隠蔽`P \ X`

`P \ X`は、集合`X`に含まれるイベントを外部から観測できない内部イベントとして扱う。

```cspm
Auth \ {internal_check_lockout}
```

隠蔽しても内部の遷移は起きるが、外部から見えるイベント列には現れない。
現在のspecforgeは`internal_`イベントの隠蔽を生成しない。

## 自動販売機の出力例

[vending-machine.md](../examples/vending-machine.md)から生成される主要部分は次のとおりである。

```cspm
nametype VAL = {0..1}
channel coin_inserted : VAL
channel choose_item
channel refund
channel lock_item
channel return_all

Spec = Idle(0)

Idle(balance) =
  coin_inserted?balance -> (balance > 0) & Selecting(balance)

Selecting(balance) =
  coin_inserted?balance -> Selecting(balance)
  []
  (balance >= 1) & choose_item -> lock_item -> Dispensing(balance)
  []
  refund -> return_all -> Idle(balance)
```

順に読むと、次の意味になる。

1. 状態変数`balance`の初期値を0として`Idle`から始める。
2. `Idle`では、`coin_inserted`と新しい残高を受け取る。
3. 新しい残高が0より大きい場合だけ`Selecting`へ進む。
4. `Selecting`では、追加の入金、商品の選択、返金の三つから外部が選べる。
5. 商品の選択は残高が1以上の場合だけ可能で、`lock_item`を経て`Dispensing`へ進む。
6. 返金では`return_all`を経て`Idle`へ戻る。

## 読み取り早見表

| 構文         | 読み方                               |
| ------------ | ------------------------------------ |
| `a -> P`     | `a`の後に`P`へ進む                   |
| `P [] Q`     | 最初のイベントを外部が選ぶ           |
| `P           | ~                                    |
| `P ; Q`      | `P`の正常終了後に`Q`を始める         |
| `P           |                                      |
| `P [         | S                                    |
| `P /\ Q`     | `Q`が`P`へ割り込む                   |
| `P \ X`      | `X`のイベントを外部から隠す          |
| `ev?x -> P`  | 値を受け取り、`x`へ束縛して`P`へ進む |
| `(cond) & P` | 条件が真のときだけ`P`を選べる        |
| `SKIP`       | 正常終了する                         |
| `STOP`       | 何も受け付けられず停止する           |

## 現在の変換範囲

- FDR4は自動起動しない。
- 直交領域の同名イベントを同期しない。
- `internal_`イベントを隠蔽しない。
- アクション名はイベントとして残すが、実際の副作用や冪等性は表現しない。
- イベントの重複配送を自動では追加しない。

厳密な変換規則は[入力仕様](./spec.md)を参照する。
