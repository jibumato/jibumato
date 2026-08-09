/**
 * 単体 Cloudflare Worker 版のエントリポイント。
 *
 * サイトを Cloudflare Pages 以外（GitHub Pages など）でホストしている場合は、
 * この Worker を www.jibunmatrix.com/api/* のルートに割り当てて使う。
 * Cloudflare Pages でホストしている場合は functions/api/checkout.js が
 * 自動で有効になるので、この Worker は不要。
 *
 * デプロイ:
 *   npx wrangler deploy -c worker/wrangler.toml
 *   npx wrangler secret put STRIPE_SECRET_KEY -c worker/wrangler.toml
 */
import { handleCheckout } from '../shared/checkout-core.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/checkout') {
      return handleCheckout(request, env);
    }
    return new Response('Not found', { status: 404 });
  }
};
