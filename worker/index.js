/**
 * Cloudflare Worker エントリポイント（静的アセット + API）
 *
 * ルーティング:
 *   POST /api/checkout       … Stripe Checkout Session を生成して URL を返す
 *   POST /api/stripe-webhook … 決済完了を受け取り、ダウンロードリンクをメール送信
 *   それ以外                  … 従来どおり静的アセット（index.html など）を配信
 *
 * 静的アセットに一致するリクエストは Cloudflare 側で先に処理されるため、
 * この fetch に到達するのは主に API パスと存在しないパス。
 * 後者は ASSETS バインディング経由で通常の 404 応答に任せる。
 *
 * 必要なシークレット:
 *   STRIPE_SECRET_KEY      … Checkout Session の生成
 *   STRIPE_WEBHOOK_SECRET  … Webhook の署名検証
 *   RESEND_API_KEY         … 配信メールの送信
 */
import { handleCheckout } from '../shared/checkout-core.js';
import { handleStripeWebhook } from '../shared/webhook-core.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/checkout') {
      return handleCheckout(request, env);
    }
    if (url.pathname === '/api/stripe-webhook') {
      return handleStripeWebhook(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
