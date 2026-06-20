import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// BOT_TOKEN must be set as env var — no hardcoded fallback
const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
const GAME_URL  = 'https://youngsanifone.github.io/snake/';
const SB_URL    = Deno.env.get('SUPABASE_URL')!;
const SB_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Content-Type':'application/json' };

// Spam protection: in-memory cooldown (resets on cold start, good enough)
const notifyCooldown = new Map<number, number>();
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours per player

// Escape HTML entities to prevent HTML-injection in Telegram messages
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendTg(chat_id: number, text: string) {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id, text, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🐍 Ответить на вызов', web_app: { url: GAME_URL } }]] }
    })
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!BOT_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'BOT_TOKEN not configured' }), { status: 500, headers: CORS });
  }

  try {
    const body = await req.json();
    const { winner_id, winner_nick, new_score } = body;

    // Input validation
    if (!winner_id || typeof winner_id !== 'string' || winner_id.length > 128) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid winner_id' }), { status: 400, headers: CORS });
    }
    if (typeof new_score !== 'number' || new_score < 1 || new_score > 99999) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid new_score' }), { status: 400, headers: CORS });
    }
    const safeNick = escHtml(String(winner_nick || 'Игрок').slice(0, 20));

    // Minimum score threshold — don't spam for low scores
    if (new_score < 10) return new Response(JSON.stringify({ ok: true, notified: 0, reason: 'score_too_low' }), { headers: CORS });

    const sb = createClient(SB_URL, SB_KEY);

    // Verify that winner_id actually has best >= new_score (prevent fake notifications)
    const { data: winner } = await sb
      .from('players')
      .select('player_id, best')
      .eq('player_id', winner_id)
      .single();

    if (!winner || winner.best < new_score) {
      return new Response(JSON.stringify({ ok: true, notified: 0, reason: 'score_not_verified' }), { headers: CORS });
    }

    // Find relevant rivals: their best is now beaten, within 40%, active in last 14 days
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: beaten } = await sb
      .from('players')
      .select('telegram_id, nick, best')
      .lt('best', new_score)
      .gt('best', new_score * 0.6)
      .not('telegram_id', 'is', null)
      .neq('player_id', winner_id)
      .gte('last_seen', since)
      .order('best', { ascending: false })
      .limit(5);

    if (!beaten || beaten.length === 0)
      return new Response(JSON.stringify({ ok: true, notified: 0 }), { headers: CORS });

    const now = Date.now();
    let notified = 0;

    for (const p of beaten) {
      if (!p.telegram_id) continue;

      const lastNotif = notifyCooldown.get(p.telegram_id) ?? 0;
      if (now - lastNotif < COOLDOWN_MS) continue;

      const msg =
        `🐍 <b>${safeNick}</b> побил твой рекорд!\n\n` +
        `Их счёт: <b>${new_score}</b> · Твой рекорд: <b>${p.best}</b>\n\n` +
        `Сможешь ответить? 😐`;

      await sendTg(p.telegram_id, msg);
      notifyCooldown.set(p.telegram_id, now);
      notified++;
    }

    return new Response(JSON.stringify({ ok: true, notified }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: CORS });
  }
});
