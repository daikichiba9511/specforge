# specforgeを使う手順

specforge と組み合わせて振る舞い仕様を作成し、レビューするための手順。

## 正準文書

役割の異なる文書を混同しない。

| 文書                     | 役割                                         |
| ------------------------ | -------------------------------------------- |
| `docs/behavior-specs.md` | 振る舞い仕様の考え方と適用範囲               |
| `docs/writing-specs.md`  | 人が specforge 互換仕様を書く手順            |
| `docs/spec.md`           | parser と codegen が受理する機械的な入力契約 |

構文や変換結果について判断するときは `docs/spec.md` を優先する。
仕様の分け方や不足ケースについて判断するときは `docs/behavior-specs.md` と
`references/behavior-spec-guide.md` を使う。

## 仕様作成

specforge に渡す仕様は Markdown の `.md` を基本とする。 生の `.mmd`
ではガード定義、状態変数、イベント payload、liveness property を同じファイルに書けないためである。

最低限、次の順序で作成する。

1. Mermaid `stateDiagram-v2` ブロックを書く。
2. ガードを使う場合は `### ガード定義` 表を書く。
3. 状態変数を使う場合は `### 共有状態` 表を書く。
4. payload を使う場合は `### イベント契約` または `### イベント一覧` 表を書く。
5. 設計メモを書く。
6. 終端到達などを検証する場合は`### 進行性`表を書く。

イベント引数と payload field と状態変数を同じ名前にすると、specforge
は受信した値を次の状態へ引き継げる。 同じ概念に別名を与えない。

## 静的検査とモデル検査

リポジトリ内で作業している場合は、保存後に次を実行する。

```bash
deno task cli --json --strict path/to/spec.md
```

インストール済みバイナリを使う場合は次を実行する。

```bash
specforge --json --strict path/to/spec.md
```

`--strict`は静的検査の指摘を失敗として扱う。
失敗した場合は指摘IDと対象行を確認し、仕様の意図を保ったまま修正する。

構文解析と静的検査が通っても、到達可能な状態の性質はまだ検証されていない。
TLCが利用できる環境では次を実行する。

```bash
deno task verify --strict --bound=3 path/to/spec.md
```

バイナリの場合は次を実行する。

```bash
specforge verify --strict --bound=3 path/to/spec.md
```

`--bound` は状態変数の有限値域を決める。
ガードの境界値を含む最小の値から始め、必要な範囲まで広げる。

## レビュー結果

レビュー結果では次の三種類を区別する。

- **構文エラー**：specforge parser が入力を受理しない
- **validation issue**：V001 以降の静的検査に違反する
- **意味上の finding**：要求漏れ、未定義イベント、異常系不足、競合、不適切な抽象度など

`verified ok` は有限化したモデルが宣言済み property を満たしたことを示す。
要求が正しく仕様化されていることや、実装が仕様に従っていることまでは保証しない。

## 現在の検証範囲

authoring 規律が表現できる意味のすべてを、現在の specforge が検証できるわけではない。
次の制約をレビュー結果に含める。

- 直交領域の同名 event は broadcast の記法だが、現在の backend は region を interleaving
  として変換し、同名 event を同期させない。
- 複数 spec file の event contract と parent-child refinement は、文書としてレビューできるが、
  specforge は file 間を合成しない。
- CSPmではアクション名をイベントとして残すが、TLA+ではアクションによる状態変数の更新を生成しない。
  どちらの形式でも、実際の副作用や冪等性は検査しない。

該当する性質を検証したと報告せず、未検証の契約として区別する。
