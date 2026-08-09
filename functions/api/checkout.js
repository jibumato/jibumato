/**
 * Cloudflare Pages Function: POST /api/checkout
 *
 * 日本語版の購入ボタンから呼ばれ、Stripe の Checkout Session を都度生成して
 * その URL を返す。実装本体は shared/checkout-core.js を参照。
 *
 * Cloudflare Pages のプロジェクト設定 →「変数とシークレット」に
 * STRIPE_SECRET_KEY をシークレットとして登録すること（Production / Preview 両方）。
 */
import { handleCheckout } from '../../shared/checkout-core.js';

export const onRequest = (context) => handleCheckout(context.request, context.env);
