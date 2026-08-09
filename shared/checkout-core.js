/**
 * Stripe Checkout Session をサーバー側で都度生成する共通ロジック。
 *
 * 日本語版で PayPay を使うために導入した。Payment Link 側で
 * アダプティブプライシング（自動通貨換算）が有効だと PayPay が選べないため、
 * 日本語版だけ Payment Link をやめてこのエンドポイント経由に切り替えている。
 *
 * 呼び出し元:
 *   - Cloudflare Pages  → functions/api/checkout.js
 *   - 単体 Worker       → worker/index.js
 *
 * 必要な環境変数（Cloudflare の Secret として設定。コードには絶対に書かない）:
 *   STRIPE_SECRET_KEY  … Stripe のシークレットキー（sk_live_... / sk_test_...）
 * 任意:
 *   SITE_ORIGIN        … 既定 https://www.jibunmatrix.com
 *   PAYMENT_METHODS    … 既定 "card,paypay"（カンマ区切り）
 *   UNIT_AMOUNT_JPY    … 既定 980
 */

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

const DEFAULT_ORIGIN = 'https://www.jibunmatrix.com';
const DEFAULT_UNIT_AMOUNT = 980;
const DEFAULT_PAYMENT_METHODS = ['card', 'paypay'];

/** 受け付ける才能タイプ（ホワイトリスト）。これ以外は 400 で弾く。 */
const TALENT_TYPES = {
  linguistic:    '言語型',
  logical:       '論理型',
  spatial:       '空間型',
  musical:       '音楽型',
  bodily:        '身体型',
  interpersonal: '対人型',
  intrapersonal: '内省型',
  naturalist:    '博物型'
};

/** このエンドポイントを使う言語（現状は日本語のみ）。 */
const ALLOWED_LANGS = ['ja'];

/** 計測用の source。未知の値は 'unknown' に丸める。 */
const ALLOWED_SOURCES = ['main_cta', 'sticky_bar', 'paid_lock', 'unknown'];

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/**
 * Stripe は application/x-www-form-urlencoded を受け取る。
 * ネストしたオブジェクト/配列を Stripe 形式（a[b][0][c]）に平坦化する。
 */
function toFormBody(obj, prefix, out) {
  out = out || [];
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (value === undefined || value === null) return;
    const name = prefix ? prefix + '[' + key + ']' : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          toFormBody(item, name + '[' + i + ']', out);
        } else {
          out.push(encodeURIComponent(name + '[' + i + ']') + '=' + encodeURIComponent(String(item)));
        }
      });
    } else if (typeof value === 'object') {
      toFormBody(value, name, out);
    } else {
      out.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(value)));
    }
  });
  return out;
}

/** リクエストの Origin が自サイトかを確認する（Origin ヘッダが無い場合は許可）。 */
function originAllowed(request, siteOrigin) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // 同一オリジンの POST では送られないことがある
  if (origin === siteOrigin) return true;
  try {
    const host = new URL(origin).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    // 独自ドメインの www 有無や Pages のプレビュー環境を許容する
    if (host === new URL(siteOrigin).hostname.replace(/^www\./, '')) return true;
    if (/\.pages\.dev$/.test(host)) return true;
  } catch (e) { /* 不正な Origin は拒否 */ }
  return false;
}

async function readBody(request) {
  const ctype = request.headers.get('Content-Type') || '';
  if (ctype.indexOf('application/json') !== -1) {
    try { return await request.json(); } catch (e) { return {}; }
  }
  try {
    const form = await request.formData();
    const out = {};
    form.forEach((v, k) => { out[k] = v; });
    return out;
  } catch (e) { return {}; }
}

/** Stripe にセッション生成を投げる。失敗時は {ok:false, status, error} を返す。 */
async function postSession(params, secretKey) {
  const res = await fetch(STRIPE_API, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + secretKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: toFormBody(params).join('&')
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (res.ok && data && data.url) return { ok: true, data: data };
  return {
    ok: false,
    status: res.status,
    error: (data && data.error) || { message: 'Unexpected Stripe response' }
  };
}

/**
 * Stripe 側の設定・API バージョン差で弾かれうるパラメータを、
 * エラー内容を見て 1 つずつ外しながら再試行する。
 * 決済そのものが止まるより、PayPay が一時的に出ないほうがマシという判断。
 */
function degradeParams(params, error) {
  const hint = ((error && (error.param || '')) + ' ' + (error && error.message || '')).toLowerCase();

  if (params.adaptive_pricing && hint.indexOf('adaptive_pricing') !== -1) {
    const next = Object.assign({}, params);
    delete next.adaptive_pricing;
    return { params: next, dropped: 'adaptive_pricing' };
  }
  if (params.payment_method_types &&
      params.payment_method_types.length > 1 &&
      (hint.indexOf('payment_method_types') !== -1 || hint.indexOf('paypay') !== -1)) {
    const next = Object.assign({}, params);
    next.payment_method_types = ['card'];
    return { params: next, dropped: 'paypay' };
  }
  return null;
}

export async function handleCheckout(request, env) {
  const siteOrigin = (env && env.SITE_ORIGIN) || DEFAULT_ORIGIN;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Allow': 'POST, OPTIONS' } });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }
  if (!originAllowed(request, siteOrigin)) {
    return jsonResponse({ error: 'forbidden_origin' }, 403);
  }

  const secretKey = env && env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    // 未設定なら Payment Link へフォールバックさせる（クライアント側で処理）
    return jsonResponse({ error: 'not_configured' }, 503);
  }

  const body = await readBody(request);
  const type = typeof body.type === 'string' ? body.type : '';
  if (!Object.prototype.hasOwnProperty.call(TALENT_TYPES, type)) {
    return jsonResponse({ error: 'invalid_type' }, 400);
  }
  const lang = ALLOWED_LANGS.indexOf(body.lang) !== -1 ? body.lang : 'ja';
  const source = ALLOWED_SOURCES.indexOf(body.source) !== -1 ? body.source : 'unknown';

  // 金額は必ずサーバー側で固定する（クライアントからは一切受け取らない）
  const unitAmount = parseInt((env && env.UNIT_AMOUNT_JPY) || DEFAULT_UNIT_AMOUNT, 10) || DEFAULT_UNIT_AMOUNT;
  const methods = (env && env.PAYMENT_METHODS)
    ? String(env.PAYMENT_METHODS).split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_PAYMENT_METHODS.slice();

  const typeNameJa = TALENT_TYPES[type];

  let params = {
    mode: 'payment',
    locale: 'ja',
    payment_method_types: methods,
    // PayPay はアダプティブプライシング（自動通貨換算）と併用できないため明示的に無効化する
    adaptive_pricing: { enabled: 'false' },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'jpy',
        unit_amount: unitAmount,
        product_data: {
          name: '「' + typeNameJa + '」専用 才能活用ガイド（PDF）',
          description: 'じぶんマトリクスの才能診断結果にもとづく、' + typeNameJa + '向けの活用ガイド。買い切り・税込。'
        }
      }
    }],
    success_url: siteOrigin + '/thanks.html?type=' + encodeURIComponent(type) + '&lang=' + encodeURIComponent(lang),
    cancel_url: siteOrigin + '/?checkout=canceled',
    metadata: { talent_type: type, lang: lang, source: source },
    payment_intent_data: {
      description: '「' + typeNameJa + '」専用 才能活用ガイド（PDF）',
      metadata: { talent_type: type, lang: lang, source: source }
    }
  };

  const droppedParams = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await postSession(params, secretKey);
    if (result.ok) {
      return jsonResponse({
        url: result.data.url,
        id: result.data.id,
        degraded: droppedParams.length ? droppedParams : undefined
      }, 200);
    }

    const fallback = degradeParams(params, result.error);
    if (!fallback) {
      // 原因をクライアントに晒さない（Payment Link へフォールバックさせる）
      console.error('[checkout] stripe error', result.status, JSON.stringify(result.error));
      return jsonResponse({ error: 'stripe_error' }, 502);
    }
    console.warn('[checkout] retrying without', fallback.dropped, '-', (result.error && result.error.message) || '');
    droppedParams.push(fallback.dropped);
    params = fallback.params;
  }

  return jsonResponse({ error: 'stripe_error' }, 502);
}

export { TALENT_TYPES };
