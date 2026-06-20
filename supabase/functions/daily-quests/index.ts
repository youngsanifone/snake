import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// No hardcoded fallbacks — secrets must be in env vars
const BOT_TOKEN   = Deno.env.get('BOT_TOKEN');
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const GAME_URL    = 'https://youngsanifone.github.io/snake/';
const SB_URL      = Deno.env.get('SUPABASE_URL')!;
const SB_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,authorization','Content-Type':'application/json' };

const DAILY_MSGS = [
  { emoji: '🎯', text: 'Сегодня цель — побить свой рекорд. Идёшь?' },
  { emoji: '🔥', text: 'Собери <b>5 комбо</b> в одной игре — змейка разразится.' },
  { emoji: '⏱', text: 'Попробуй <b>60-секундный режим</b>. Много еды — много очков.' },
  { emoji: '💀', text: 'Режим Выживание — как долго протянешь?' },
  { emoji: '🏆', text: 'Проверь таблицу лидеров — есть место для тебя.' },
  { emoji: '⭐', text: 'Поймай золотую еду — она даёт <b>бонусные очки</b>.' },
  { emoji: '🪞', text: 'Режим Зеркало — всё наоборот. Попробуй!' },
];

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function sendTg(chat_id: number, text: string) {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🐍 Играть', web_app: { url: GAME_URL } }]] } })
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!BOT_TOKEN || !CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing required env vars' }), { status: 500, headers: CORS });
  }

  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  try {
    const sb = createClient(SB_URL, SB_KEY);
    const today = new Date().toISOString().slice(0, 10);
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const msg = DAILY_MSGS[dayOfYear % DAILY_MSGS.length];

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: players } = await sb.from('players')
      .select('telegram_id, nick, player_id')
      .not('telegram_id', 'is', null)
      .gte('last_seen', since)
      .or(`last_daily_sent.is.null,last_daily_sent.lt.${today}`)
      .limit(500);

    if (!players || players.length === 0)
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'all_sent_today' }), { headers: CORS });

    const todayDate = new Date().toLocaleDateString('ru', { day: 'numeric', month: 'long' });
    let sent = 0;

    for (const p of players) {
      if (!p.telegram_id) continue;
      const safeNick = p.nick ? escHtml(String(p.nick).slice(0, 20)) : null;
      const greeting = safeNick ? `Привет, <b>${safeNick}</b>!` : 'Привет!';
      await sendTg(p.telegram_id, `${msg.emoji} ${greeting}\n\n${msg.text}\n\n📅 ${todayDate}`);
      await sb.from('players').update({ last_daily_sent: today }).eq('player_id', p.player_id);
      sent++;
      if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1100));
    }

    return new Response(JSON.stringify({ ok: true, sent }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: CORS });
  }
});
