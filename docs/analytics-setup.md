# 購入ファネル計測のセットアップ（GTM → GA4）

サイト側は以下のイベントを `dataLayer` に送信済み。GA4に届かせるには
**GTM（GTM-T7NLKV87）側で1回だけ設定**が必要です。

## サイトが送信するイベント

| イベント名 | 発火タイミング | 主なパラメータ |
|---|---|---|
| `diagnosis_start` | 「診断をはじめる」クリック | `lang` |
| `result_view` | 結果画面の表示（復元含む） | `archetype`, `top1`, `top2`, `lang` |
| `premium_view` | 有料セクションが画面に入った時（結果ごとに1回） | `top1`, `lang` |
| `premium_buy_click` | 購入ボタンクリック | `talent_type`, `archetype`, `has_payment_link`, `lang` |
| `share_click` | シェアボタンクリック | `top1`, `lang` |
| `purchase_complete` | thanks.html 到達（決済完了後） | `talent_type`, `lang`, `value:980`, `currency:JPY` |

## GTM側の設定手順（各イベント共通・6回繰り返し）

1. **トリガー作成**: 種類「カスタムイベント」→ イベント名に上記の名前（例 `result_view`）
2. **タグ作成**: 種類「GA4イベント」→ 設定タグ（既存のGA4設定）を選択 →
   イベント名は同じ名前 → 「イベントパラメータ」に上記パラメータを
   `{{DLV - archetype}}` のような **データレイヤー変数** で紐付け
3. **変数作成**（初回のみ）: 「データレイヤー変数」で `archetype` / `top1` / `top2` /
   `talent_type` / `lang` / `has_payment_link` / `value` / `currency` を定義
4. プレビューで動作確認 → 公開

## GA4側（任意・推奨）

- `purchase_complete` を**キーイベント（コンバージョン）に指定**
- 探索レポートで目標到達プロセス:
  `diagnosis_start → result_view → premium_view → premium_buy_click → purchase_complete`
- `archetype` / `talent_type` を**カスタムディメンション**に登録すると
  「どのアーキタイプが売れるか」を分析できる

## 見るべきKPI

- 結果到達率 = result_view / diagnosis_start（診断の完走率）
- 有料閲覧率 = premium_view / result_view（スクロール到達）
- クリック率 = premium_buy_click / premium_view（訴求の強さ）
- 決済完了率 = purchase_complete / premium_buy_click（決済の摩擦）
