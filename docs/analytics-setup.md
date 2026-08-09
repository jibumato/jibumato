# GTM設定手順 — 購入ファネル計測をGA4に流す

サイト側の実装は**完了済み**です。以下は GTM（`GTM-T7NLKV87`）側で **1回だけ**行う設定手順です。
所要時間の目安：**15〜20分**。

---

## 0. 前提の確認

GTM に「GA4 設定タグ」（測定IDが `G-` で始まるもの）が既に存在するか確認してください。
- **ある場合** → そのまま手順1へ
- **無い場合** → 先に GA4 設定タグを作成してください
  - タグの種類：`Google タグ`（または「GA4 設定」）
  - 測定ID：GA4管理画面 →「データストリーム」→ ウェブ → `G-XXXXXXXXXX`
  - トリガー：`Initialization - All Pages`

---

## 1. データレイヤー変数を作る（8個）

GTM 左メニュー →「**変数**」→ ユーザー定義変数の「**新規**」

以下8個を作成します。すべて **変数タイプ＝「データレイヤーの変数」**、
「データレイヤーの変数名」に下記の名前を**そのまま**入力します。

| 変数名（GTMでの名前） | データレイヤーの変数名 |
|---|---|
| DLV - talent_type | `talent_type` |
| DLV - archetype | `archetype` |
| DLV - top1 | `top1` |
| DLV - top2 | `top2` |
| DLV - lang | `lang` |
| DLV - source | `source` |
| DLV - value | `value` |
| DLV - currency | `currency` |

> 変数名の頭の「DLV - 」は分かりやすさのための命名で、自由に変えて構いません。
> ただし**右側の「データレイヤーの変数名」は完全一致**である必要があります。

---

## 2. トリガーを作る（8個）

GTM 左メニュー →「**トリガー**」→「**新規**」

すべて **トリガーのタイプ＝「カスタム イベント」**、
「イベント名」に下記を**そのまま**入力し、「すべてのカスタム イベント」を選択します。

| トリガー名 | イベント名 |
|---|---|
| CE - diagnosis_start | `diagnosis_start` |
| CE - result_view | `result_view` |
| CE - premium_view | `premium_view` |
| CE - premium_buy_click | `premium_buy_click` |
| CE - sticky_cta_view | `sticky_cta_view` |
| CE - sticky_cta_click | `sticky_cta_click` |
| CE - share_click | `share_click` |
| CE - purchase_complete | `purchase_complete` |

---

## 3. GA4イベントタグを作る（8個）

GTM 左メニュー →「**タグ**」→「**新規**」

すべて **タグの種類＝「Google アナリティクス: GA4 イベント」**。
「設定タグ」に手順0のGA4設定タグを選び、下表のとおり設定します。

### 3-1. 診断開始
- タグ名：`GA4 - diagnosis_start`
- イベント名：`diagnosis_start`
- イベントパラメータ：`lang` = `{{DLV - lang}}`
- トリガー：`CE - diagnosis_start`

### 3-2. 結果表示
- タグ名：`GA4 - result_view`
- イベント名：`result_view`
- イベントパラメータ：
  - `archetype` = `{{DLV - archetype}}`
  - `top1` = `{{DLV - top1}}`
  - `top2` = `{{DLV - top2}}`
  - `lang` = `{{DLV - lang}}`
- トリガー：`CE - result_view`

### 3-3. 有料セクション閲覧
- タグ名：`GA4 - premium_view`
- イベント名：`premium_view`
- イベントパラメータ：`top1` = `{{DLV - top1}}` / `lang` = `{{DLV - lang}}`
- トリガー：`CE - premium_view`

### 3-4. 購入ボタンクリック（最重要）
- タグ名：`GA4 - premium_buy_click`
- イベント名：`premium_buy_click`
- イベントパラメータ：
  - `talent_type` = `{{DLV - talent_type}}`
  - `archetype` = `{{DLV - archetype}}`
  - `source` = `{{DLV - source}}` ← **本体CTA（main_cta）か追従バー（sticky_bar）かの判別用**
  - `lang` = `{{DLV - lang}}`
- トリガー：`CE - premium_buy_click`

### 3-5. 追従バー表示
- タグ名：`GA4 - sticky_cta_view`／イベント名：`sticky_cta_view`
- パラメータ：`top1` / `lang`
- トリガー：`CE - sticky_cta_view`

### 3-6. 追従バークリック
- タグ名：`GA4 - sticky_cta_click`／イベント名：`sticky_cta_click`
- パラメータ：`top1` / `lang`
- トリガー：`CE - sticky_cta_click`

### 3-7. シェアクリック
- タグ名：`GA4 - share_click`／イベント名：`share_click`
- パラメータ：`top1` / `lang`
- トリガー：`CE - share_click`

### 3-8. 購入完了（最重要）
- タグ名：`GA4 - purchase_complete`
- イベント名：`purchase_complete`
- イベントパラメータ：
  - `talent_type` = `{{DLV - talent_type}}`
  - `lang` = `{{DLV - lang}}`
  - `value` = `{{DLV - value}}`
  - `currency` = `{{DLV - currency}}`
- トリガー：`CE - purchase_complete`

---

## 4. プレビューで動作確認

1. GTM 右上の「**プレビュー**」をクリック
2. `https://www.jibunmatrix.com/` を入力して接続
3. 実際に診断を進めながら、左側のイベント一覧に以下が順に出るか確認
   - `diagnosis_start`（診断開始を押したとき）
   - `result_view`（結果が出たとき）
   - `premium_view`（有料セクションまでスクロールしたとき）
   - `sticky_cta_view`（スマホ幅で追従バーが出たとき）
4. 各イベントをクリック →「Tags」タブで**対応するGA4タグが Fired（配信）**になっていることを確認
5. 「Variables」タブで `DLV - archetype` などに**値が入っている**ことを確認

> 値が `undefined` の場合、変数名のスペルミスが原因のことがほとんどです。

---

## 5. 公開

確認できたら GTM 右上の「**公開**」→ バージョン名（例：`購入ファネル計測の追加`）を入力して送信。

---

## 6. GA4側の設定（公開後）

### 6-1. キーイベント（コンバージョン）に指定
GA4管理画面 →「**管理**」→「**イベント**」または「**キーイベント**」

`purchase_complete` を**キーイベントとしてマーク**します。
※ イベントは**1回でも発生しないと一覧に出ません**。公開後にご自身で一度テスト購入するか、
実際の購入が発生するまで待ってから設定してください。

### 6-2. カスタムディメンションを登録（分析の精度が上がる）
GA4管理画面 →「**管理**」→「**カスタム定義**」→「カスタムディメンションを作成」

| ディメンション名 | 範囲 | イベントパラメータ |
|---|---|---|
| 才能タイプ | イベント | `talent_type` |
| アーキタイプ | イベント | `archetype` |
| 購入導線 | イベント | `source` |
| 言語 | イベント | `lang` |

> これを登録しないと、レポートでパラメータ別に分解できません。**登録前のデータは遡って見られない**ため、早めの登録を推奨します。

---

## 7. 見るべき指標（データが貯まってから）

### ファネルの通過率
| 指標 | 計算 | 意味 |
|---|---|---|
| 診断完走率 | `result_view` ÷ `diagnosis_start` | 24問を最後まで答えた割合 |
| 有料到達率 | `premium_view` ÷ `result_view` | 結果を読み進めてCTAまで来た割合 |
| CTAクリック率 | `premium_buy_click` ÷ `premium_view` | 訴求の強さ |
| 決済完了率 | `purchase_complete` ÷ `premium_buy_click` | 決済フローの摩擦 |

### 特に注目したい点
- **有料到達率が低い**（例：30%未満）→ 結果画面が長すぎる可能性。CTAを上部にも置く施策が有効
- **CTAクリック率は高いが決済完了率が低い** → Stripe決済画面での離脱。価格や決済手段の見直し
- `source` 別の `premium_buy_click` → **追従バーの貢献度**が分かる
- `archetype` / `talent_type` 別の購入数 → **どのタイプが買いやすいか**が分かり、記事の狙いどころが定まる

---

## 付録：サイトが送信するイベント一覧（実装済み）

| イベント名 | 発火タイミング | パラメータ |
|---|---|---|
| `diagnosis_start` | 「診断をはじめる」クリック | `lang` |
| `result_view` | 結果画面の表示（復元含む） | `archetype`, `top1`, `top2`, `lang` |
| `premium_view` | 有料セクションが画面に入った時（結果ごと1回） | `top1`, `lang` |
| `premium_buy_click` | 購入ボタンクリック | `talent_type`, `archetype`, `has_payment_link`, `source`, `lang` |
| `sticky_cta_view` | 追従バーが表示された時 | `top1`, `lang` |
| `sticky_cta_click` | 追従バーのボタンをクリック | `top1`, `lang` |
| `share_click` | シェアボタンクリック | `top1`, `lang` |
| `purchase_complete` | thanks.html 到達（決済完了後） | `talent_type`, `lang`, `value:980`, `currency:JPY` |

※ `has_payment_link` は必要に応じて変数・パラメータを追加してください（通常は不要）。
