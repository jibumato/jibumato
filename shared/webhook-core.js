/**
 * Stripe Webhook 受け口。決済完了をサーバー間通信で受け取り、
 * ダウンロードリンクをメールで送る。
 *
 * なぜ必要か:
 *   PayPay はアプリを往復するため、決済が成功してもブラウザが
 *   success_url に戻れないことがある（実際に発生した）。
 *   その場合お客様は「支払ったのに商品が届かない」状態になる。
 *   Webhook はブラウザの状態に一切左右されないので、確実に配信できる。
 *
 * 必要な環境変数:
 *   STRIPE_WEBHOOK_SECRET … Stripe のエンドポイント署名シークレット（whsec_...）
 *   RESEND_API_KEY        … メール送信用（未設定ならログに出すだけで落とさない）
 * 任意:
 *   MAIL_FROM             … 差出人。既定 "じぶんマトリクス <noreply@jibunmatrix.com>"
 *   SITE_ORIGIN           … 既定 https://www.jibunmatrix.com
 */

import { TALENT_TYPES } from './checkout-core.js';

const RESEND_API = 'https://api.resend.com/emails';
const DEFAULT_ORIGIN = 'https://www.jibunmatrix.com';
const DEFAULT_FROM = 'じぶんマトリクス <noreply@jibunmatrix.com>';
const SIGNATURE_TOLERANCE_SEC = 300;

const encoder = new TextEncoder();

/**
 * 再送しても直らない失敗（イベントの中身が想定外）。
 * Stripe の「テストイベント」はダミーの中身で届くため必ずこれに該当する。
 * この場合に 500 を返すと Stripe が数日間再送し続け、
 * エンドポイントが常時エラーに見えてしまうので 200 で受け切る。
 */
class PermanentError extends Error {}

async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.prototype.map
    .call(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 長さと内容の比較に早期 return を使わない（タイミング差から署名を推測されないため） */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Stripe-Signature ヘッダ（t=...,v1=...）を検証する。
 * これが無いと、誰でも「決済が成功した」という偽リクエストを送れてしまう。
 */
async function verifySignature(rawBody, header, secret) {
  if (!header) return false;

  let timestamp = null;
  const signatures = [];
  header.split(',').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') signatures.push(v);
  });
  if (!timestamp || !signatures.length) return false;

  // リプレイ攻撃対策: 古い署名済みリクエストの再送を弾く
  const ts = parseInt(timestamp, 10);
  if (!isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > SIGNATURE_TOLERANCE_SEC) return false;

  const expected = await hmacSha256Hex(secret, timestamp + '.' + rawBody);
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function buildEmail(typeName, downloadUrl) {
  const safeName = escapeHTML(typeName);
  const safeUrl = escapeHTML(downloadUrl);

  const text = [
    'このたびは「' + typeName + '」専用 才能活用ガイドをご購入いただきありがとうございます。',
    '',
    '下記のページから PDF をダウンロードいただけます。',
    downloadUrl,
    '',
    'このメールはダウンロード用のリンクを含んでいます。あとから読み返せるよう保存しておいてください。',
    '',
    'じぶんマトリクス',
    'https://www.jibunmatrix.com/'
  ].join('\n');

  const html = `<!doctype html>
<html lang="ja"><body style="margin:0;padding:24px;background:#f6f3ec;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;color:#2b2620;line-height:1.8;">
  <div style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #e4dccb;border-radius:8px;padding:32px 28px;">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;color:#a08b5f;">PREMIUM GUIDE</p>
    <h1 style="margin:0 0 20px;font-size:19px;font-weight:700;">ご購入ありがとうございます</h1>
    <p style="margin:0 0 20px;font-size:15px;">
      「${safeName}」専用の才能活用ガイド（PDF）をお届けします。<br>
      下のボタンからダウンロードしてください。
    </p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${safeUrl}" style="display:inline-block;background:#8c2f2f;color:#fffdf8;text-decoration:none;padding:14px 28px;border-radius:4px;font-size:15px;font-weight:700;">PDFをダウンロードする</a>
    </p>
    <p style="margin:0 0 20px;font-size:13px;color:#6b6157;">
      ボタンが開かない場合は、次のURLをブラウザに貼り付けてください。<br>
      <span style="word-break:break-all;">${safeUrl}</span>
    </p>
    <p style="margin:0;padding-top:20px;border-top:1px solid #e4dccb;font-size:13px;color:#6b6157;">
      このメールにはダウンロード用のリンクが含まれています。あとから読み返せるよう保存しておいてください。<br>
      <a href="https://www.jibunmatrix.com/" style="color:#8c2f2f;">じぶんマトリクス</a>
    </p>
  </div>
</body></html>`;

  return { text: text, html: html };
}

async function sendDeliveryEmail(session, env) {
  const to = session.customer_details && session.customer_details.email;
  if (!to) throw new PermanentError('customer_details.email が空です');

  const meta = session.metadata || {};
  const talentType = meta.talent_type;
  if (!Object.prototype.hasOwnProperty.call(TALENT_TYPES, talentType)) {
    throw new PermanentError('metadata.talent_type が不正です: ' + talentType);
  }

  const lang = meta.lang || 'ja';
  const siteOrigin = env.SITE_ORIGIN || DEFAULT_ORIGIN;
  const downloadUrl = siteOrigin + '/thanks.html?type=' +
    encodeURIComponent(talentType) + '&lang=' + encodeURIComponent(lang);
  const typeName = TALENT_TYPES[talentType];

  // メール送信が未設定でも Webhook は成功させる。
  // ここでリンクをログに残しておけば、手動で送って救済できる。
  if (!env.RESEND_API_KEY) {
    console.error('[webhook] RESEND_API_KEY 未設定のためメール未送信 / to=' + to + ' url=' + downloadUrl);
    return;
  }

  const body = buildEmail(typeName, downloadUrl);
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || DEFAULT_FROM,
      to: [to],
      subject: '「' + typeName + '」専用 才能活用ガイドのダウンロード',
      html: body.html,
      text: body.text
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // ここで throw すると 500 を返し、Stripe が自動で再送してくれる
    throw new Error('メール送信に失敗 (' + res.status + '): ' + detail.slice(0, 300));
  }

  console.log('[webhook] 配信メール送信 / type=' + talentType + ' session=' + (session.id || ''));
}

export async function handleStripeWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('method_not_allowed', { status: 405 });
  }

  const secret = env && env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET が未設定です');
    return new Response('not_configured', { status: 503 });
  }

  // 署名検証には生のボディが必要（JSON に変換すると再現できない）
  const raw = await request.text();
  const valid = await verifySignature(raw, request.headers.get('Stripe-Signature'), secret);
  if (!valid) {
    console.error('[webhook] 署名検証に失敗しました');
    return new Response('invalid_signature', { status: 400 });
  }

  let event;
  try { event = JSON.parse(raw); } catch (e) {
    return new Response('bad_json', { status: 400 });
  }

  // checkout.session.completed … 決済が即時確定した場合（カードなど）
  // checkout.session.async_payment_succeeded … 非同期決済があとから確定した場合
  // 前者で payment_status が paid でないものは後者で拾うため、二重送信にはならない。
  if (event.type !== 'checkout.session.completed' &&
      event.type !== 'checkout.session.async_payment_succeeded') {
    return new Response('ignored', { status: 200 });
  }

  const session = event.data && event.data.object;
  if (!session || session.payment_status !== 'paid') {
    console.log('[webhook] 未確定のためスキップ / status=' + (session && session.payment_status));
    return new Response('pending', { status: 200 });
  }

  try {
    await sendDeliveryEmail(session, env);
  } catch (e) {
    if (e instanceof PermanentError) {
      // 再送しても直らないので 200 で受け切る（Stripe のテストイベントもここに来る）
      console.error('[webhook] 配信対象外のイベント: ' + e.message);
      return new Response('ignored_invalid_payload', { status: 200 });
    }
    console.error('[webhook] 配信に失敗: ' + (e && e.message));
    // 一時的な失敗。500 を返すと Stripe が指数バックオフで再送してくれる
    return new Response('delivery_failed', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}
