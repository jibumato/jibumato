# 日本語版の決済を PayPay 対応にする（Cloudflare Workers + Stripe Checkout Session）

日本語版だけ **Stripe Payment Link をやめ**、`/api/checkout` でその都度 Checkout Session を
サーバー側生成する方式に切り替えました。PayPay を使うための変更です。

> **なぜ Payment Link をやめたか**
> Payment Link ではアダプティブプライシング（訪問者の国の通貨に自動換算する機能）が
> 有効だと PayPay を決済手段として選べません。Checkout Session ならリクエストごとに
> `adaptive_pricing[enabled]=false` と `payment_method_types` を指定できるため、
> 日本語版だけ確実に「円建て・PayPay あり」にできます。
> 英語 / 中国語 / 韓国語は従来どおり Payment Link のままです（換算が効いたほうが良いため）。

---

## 前提：このサイトは Cloudflare Workers で動いている

Cloudflare の Worker `jibumato` に、**静的アセットだけ**が載っている状態でした。
そのため設定画面の「変数とシークレット」に

> 静的アセットのみを持つワーカーには変数を追加できません

と表示され、**`STRIPE_SECRET_KEY` を登録できません**でした。
そこで Worker にスクリプトを持たせる構成に変更しています。

```
リクエスト
  ├ /api/checkout          → Worker が処理（Stripe Checkout Session を生成）
  └ それ以外（/ , *.html …）→ 従来どおり静的アセットを配信（挙動は変わりません）
```

## 構成

| ファイル | 役割 |
|---|---|
| `wrangler.toml` | Worker の設定。`main`（スクリプト）と `assets`（静的ファイル）を両方指定 |
| `worker/index.js` | 入口。`/api/checkout` と `/api/stripe-webhook` を処理し、他はアセットへ委譲 |
| `shared/checkout-core.js` | Stripe API を叩いて Checkout Session を作る |
| `shared/webhook-core.js` | 決済完了を受け取り、ダウンロードリンクをメール送信する |
| `.assetsignore` | ソースや社内ドキュメントをサイトとして配信しないための除外リスト |
| `index.html` | 購入ボタン。`ja` のときだけ `/api/checkout` を呼ぶ |

金額（980円）・商品名・成功後のリダイレクト先は **すべてサーバー側で固定**しています。
クライアントから送るのは `type`（才能タイプ）だけで、8種類のホワイトリストで検証します。
金額をクライアントから受け取る箇所はありません。

---

## セットアップ手順

### 1. Stripe 側で PayPay を有効化する

1. Stripe ダッシュボード →「**設定**」→「**決済手段**」
2. **PayPay** を探して「**有効にする**」
3. 審査があります（**数週間かかることがあります**）。承認されるまでは PayPay は表示されません

> PayPay は **日本の Stripe アカウント・JPY 建て決済のみ**対応です。
> 未承認の間に `paypay` を指定すると Stripe がエラーを返しますが、
> `shared/checkout-core.js` が自動でカードのみに切り替えて再試行するため、
> **決済が止まることはありません**（ログに `retrying without paypay` が出ます）。

### 2. デプロイして Worker にスクリプトを持たせる

**この順番が重要です。** スクリプトが載るまでシークレットは登録できません。

`main` を含む `wrangler.toml` をリポジトリに置いたので、
GitHub 連携（Workers Builds）でビルドが走れば自動でスクリプト付きの Worker になります。

うまくいかない場合は手元からデプロイしてください。

```bash
npx wrangler deploy
```

デプロイ後、ダッシュボードの Worker `jibumato` →「デプロイ」で
**バージョンが更新され、「静的アセットのみ」の表示が消えている**ことを確認します。

> **ビルドが失敗する場合**は、ダッシュボードの「デプロイ」→ 該当ビルドの
> **ビルドログ**を確認してください。ビルドコマンドが設定されていると
> （`npm run build` など。このリポジトリに `package.json` はありません）失敗します。
> その場合はビルドコマンドを空に、デプロイコマンドを `npx wrangler deploy` にします。

### 3. シークレットを登録する

スクリプトが載ると「設定」→「**変数とシークレット**」が使えるようになります。

| 種別 | 名前 | 値 |
|---|---|---|
| **シークレット** | `STRIPE_SECRET_KEY` | まず `sk_test_...`、確認後 `sk_live_...` |

CLI からでも登録できます。

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

`SITE_ORIGIN` / `PAYMENT_METHODS` / `UNIT_AMOUNT_JPY` は `wrangler.toml` の `[vars]` に
書いてあるので、ダッシュボードでの登録は不要です。

> **シークレットキーは絶対にリポジトリに書かないでください。**
> `[vars]` はデプロイのたびに `wrangler.toml` の内容で上書きされますが、
> シークレットはデプロイでは消えません。

### 4. 動作確認

1. `sk_test_...` を登録した状態で日本語版の診断を進め、購入ボタンを押す
2. ボタンが「決済ページへ移動中…」になり、Stripe の決済画面に飛べば成功
3. 決済画面に **カード / Apple Pay / Google Pay / PayPay** が並ぶことを確認
   （PayPay が無い場合 = まだ審査中、または手順1が未完了）
4. テストカード `4242 4242 4242 4242` で決済 → `thanks.html?type=◯◯&lang=ja` に戻り
   PDF がダウンロードできることを確認
5. 問題なければ `STRIPE_SECRET_KEY` を `sk_live_...` に差し替え

---

---

## Webhook でのメール配信（PayPay には必須）

### なぜ必要か

**実際に発生した事象。** PayPay で ¥980 の決済が成功したにもかかわらず、
ブラウザが `thanks.html` に戻れず、PDF が届きませんでした。

```
19:23:22  POST /v1/checkout/sessions   200 OK   ← Worker が Session 生成
19:23:39  PayPay へリダイレクト
19:24:04  支払い成功 ✅  ¥980 請求済み
19:24:05  Checkout セッション完了
19:25     ← スマホの画面はまだ「ぐるぐる」のまま
```

PayPay はスマホアプリを往復するため、承認後に Safari へ戻ってきても
タブが凍結されていて `success_url` への自動遷移が起きないことがあります。
カード決済でも「決済直後にブラウザを閉じた」場合に同じことが起きます。

**ブラウザのリダイレクトだけを配信手段にしていると、「支払ったのに商品が届かない」が起きます。**
Webhook はサーバー間通信なのでブラウザの状態に一切左右されず、確実に配信できます。

### 設定手順

**① Resend でメール送信を用意する**

1. [resend.com](https://resend.com) でアカウントを作る（無料枠：月3,000通）
2. 「Domains」で `jibunmatrix.com` を追加し、表示された **DNS レコード（SPF / DKIM）を
   ドメインの DNS に登録**する。Cloudflare でドメインを管理しているならそこに追加
3. 認証が済んだら「API Keys」で送信用キー（`re_...`）を作成

> ドメイン認証をしないと、送ったメールが迷惑メール判定されます。ここは省略しないでください。
> 差出人アドレスは `wrangler.toml` の `MAIL_FROM` で変更できます（既定 `noreply@jibunmatrix.com`）。

**② Stripe に Webhook エンドポイントを登録する**

1. Stripe ダッシュボード →「**開発者**」→「**Webhook**」→「エンドポイントを追加」
2. エンドポイント URL：`https://www.jibunmatrix.com/api/stripe-webhook`
3. 送信するイベントに以下の**2つ**を選ぶ
   - `checkout.session.completed` … カードなど即時確定した決済
   - `checkout.session.async_payment_succeeded` … PayPay などあとから確定した決済
4. 作成後に表示される「**署名シークレット**」（`whsec_...`）をコピー

**③ Cloudflare にシークレットを登録する**

Worker `jibumato` →「設定」→「変数とシークレット」で追加します。

| 種別 | 名前 | 値 |
|---|---|---|
| シークレット | `STRIPE_WEBHOOK_SECRET` | ②の `whsec_...` |
| シークレット | `RESEND_API_KEY` | ①の `re_...` |

**④ 動作確認**

Stripe の Webhook 設定画面から「**テストイベントを送信**」で
`checkout.session.completed` を送り、**200 が返る**ことを確認します。
そのうえで実際に1件購入し、メールが届くことを確認してください。

> `RESEND_API_KEY` を登録しないまま Webhook だけ動かした場合、Worker は
> 200 を返しつつログに宛先とダウンロード URL を出します。
> Cloudflare の「Observability（ログ）」から手動で救済できます。

### 二重送信について

`checkout.session.completed` で `payment_status` が `paid` でないものは送らず、
あとから来る `async_payment_succeeded` で拾う作りにしてあります。
どちらか一方でしか送信されないため、同じ購入で2通届くことはありません。

### 併せて設定しておくとよいこと

Stripe の**領収書メールが無効**になっています（ログに「領収書は送信されませんでした」）。
現状お客様には支払いの証跡が何も届いていないので、
Stripe ダッシュボード →「設定」→「**顧客のメール**」で
「支払い成功時に領収書を送信」を有効にしておくことをお勧めします。

---

## フォールバックの設計

`/api/checkout` が使えないとき（未デプロイ、シークレット未設定、Stripe 障害、通信タイムアウト）は
**日本語版でも従来の Payment Link にそのまま落ちます**。売上を止めないための保険です。

```
購入ボタン
  └ ja ?
      ├ YES → POST /api/checkout ─ 成功 → Stripe Checkout（PayPay あり）
      │                          └ 失敗 → Payment Link（従来どおり・PayPay なし）
      └ NO  → Payment Link
```

つまり **デプロイやシークレット登録が終わっていない間も、日本語版の購入は今までどおり動きます。**

フォールバックが起きると GTM に `checkout_api_fallback` イベントが飛びます。
**このイベントが出続けている＝サーバー側決済が動いていない**サインなので、
GTM に同名のカスタムイベントトリガーと GA4 タグを足しておくと早く気づけます
（設定方法は `docs/analytics-setup.md` の手順2・3と同じ要領）。

そのため `index.html` の `STRIPE_PAYMENT_LINKS.ja` は**削除せず残してあります**。
サーバー側決済が安定したら削除しても構いませんが、保険として残す価値は大きいです。

---

## Stripe 側で確認しておくこと

- **アダプティブプライシング**：ダッシュボード →「設定」→「決済」で無効にしておくと確実です。
  Checkout Session 側でも `adaptive_pricing[enabled]=false` を送っていますが、
  API バージョンによってはこのパラメータが受け付けられません。
  その場合はコードが自動でパラメータを外して再試行するため、
  **ダッシュボード側の設定が最終的な効き目**になります。
- **成功後のリダイレクト**：Payment Link と違い、Checkout Session では
  `success_url` をコード側（`shared/checkout-core.js`）で指定しています。
  ダッシュボードでの設定は不要です。
- **PayPay の入金サイクル**：カードと異なり、最短4営業日程度での入金です。

---

## 変更したもの（サイト側）

- `wrangler.toml` / `.assetsignore` を新規追加（Worker にスクリプトを持たせる設定）
- `worker/index.js` / `shared/checkout-core.js` を新規追加
- `index.html`
  - `goToPremiumCheckout()` を非同期化。`ja` のときだけ `/api/checkout` を経由
  - 生成待ちの間、購入ボタンを「決済ページへ移動中…」にして二重クリックを防止
  - 決済手段の表記を **カード・PayPay対応** に更新
