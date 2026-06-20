import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// No hardcoded fallbacks — secrets must be in env vars
const BOT_TOKEN   = Deno.env.get('BOT_TOKEN');
const SB_URL      = Deno.env.get('SUPABASE_URL')!;
const SB_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GAME_URL    = 'https://youngsanifone.github.io/snake/';
const GAME_ORIGIN = 'https://youngsanifone.github.io';

const CORS = {
  'Access-Control-Allow-Origin': GAME_ORIGIN,
  'Access-Control-Allow-Headers': 'content-type',
  'Content-Type': 'application/json',
};

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyInitData(initData: string): Promise<Record<string, string> | null> {
  if (!BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secretKey = await crypto.subtle.sign('HMAC', baseKey, enc.encode(BOT_TOKEN));
  const verifyKey = await crypto.subtle.importKey('raw', secretKey,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', verifyKey, enc.encode(dataCheckString));
  const computed = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  if (!timingSafeEqual(computed, hash)) return null;

  const authDate = parseInt(params.get('auth_date') ?? '0');
  if (isNaN(authDate) || Date.now() / 1000 - authDate > 86400) return null;

  const userStr = params.get('user');
  if (!userStr) return null;
  try {
    const user = JSON.parse(userStr);
    if (!user.id || isNaN(parseInt(user.id))) return null;
    return user;
  } catch { return null; }
}

async function tgApi(method: string, body: Record<string, unknown>) {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function sendWelcome(telegram_id: number, first_name: string) {
  await tgApi('setChatMenuButton', {
    chat_id: telegram_id,
    menu_button: { type: 'commands' }
  });
  const safeName = escHtml(first_name);
  const n = safeName ? `, <b>${safeName}</b>` : '';
  await tgApi('sendMessage', {
    chat_id: telegram_id,
    parse_mode: 'HTML',
    text: `🐍 Привет${n}!\n\nТы открыл игру — теперь бот будет сообщать тебе когда кто-то побьёт твой рекорд.\n\nГотов к игре?`,
    reply_markup: {
      inline_keyboard: [
        [{ text: '🐍 Играть', web_app: { url: GAME_URL } }]
      ]
    }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!BOT_TOKEN) {
    return new Response(JSON.stringify({ error: 'BOT_TOKEN not configured' }), { status: 500, headers: CORS });
  }

  try {
    const { init_data } = await req.json();
    if (!init_data || typeof init_data !== 'string') {
      return new Response(JSON.stringify({ error: 'missing init_data' }), { status: 400, headers: CORS });
    }

    const user = await verifyInitData(init_data);
    if (!user) {
      return new Response(JSON.stringify({ error: 'invalid_init_data' }), { status: 401, headers: CORS });
    }

    const supabase = createClient(SB_URL, SB_KEY);
    const telegram_id = parseInt(user.id);

    const { data: existing } = await supabase
      .from('players')
      .select('player_id')
      .eq('telegram_id', telegram_id)
      .maybeSingle();
    const isNewPlayer = !existing;

    const { data: playerId, error: rpcError } = await supabase.rpc('upsert_telegram_player', {
      p_telegram_id:   telegram_id,
      p_first_name:    user.first_name ?? 'Player',
      p_username:      user.username ?? null,
      p_language_code: user.language_code ?? 'en',
      p_photo_url:     user.photo_url ?? null,
    });
    if (rpcError) throw rpcError;

    const { data: profile, error: profileError } = await supabase
      .from('players')
      .select(`
        player_id, nick, coins, best, best_level, games_played, total_score,
        skin_idx, difficulty, theme, lang, music_on, sfx_on, saved_level,
        achievements, bought_skins, quests, photo_url, telegram_id
      `)
      .eq('player_id', playerId)
      .single();
    if (profileError) throw profileError;

    if (isNewPlayer) {
      sendWelcome(telegram_id, user.first_name ?? '').catch(() => {});
    }

    return new Response(JSON.stringify({
      ok: true,
      player_id: playerId,
      telegram_user: {
        id:         user.id,
        first_name: user.first_name,
        username:   user.username,
        photo_url:  user.photo_url ?? profile?.photo_url ?? null,
      },
      profile,
    }), { headers: CORS });

  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    const msg = err?.message || String(e);
    console.error('[telegram-auth] error:', msg);
    return new Response(JSON.stringify({ error: msg, code: err?.code }), { status: 500, headers: CORS });
  }
});
