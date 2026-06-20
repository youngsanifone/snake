import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REFERRAL_BONUS = 20;
const MAX_REFERRAL_AGE_HOURS = 48;
const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Content-Type':'application/json' };

// Rate limit: max 5 referral credits per referrer per hour (prevents fake-account farming)
const referrerHits = new Map<string, { count: number; resetAt: number }>();
function checkReferrerRateLimit(referrer_id: string): boolean {
  const now = Date.now();
  const entry = referrerHits.get(referrer_id);
  if (!entry || now > entry.resetAt) {
    referrerHits.set(referrer_id, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { new_player_id, ref_code } = await req.json();
    if (!new_player_id || !ref_code) {
      return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: CORS });
    }
    if (typeof new_player_id !== 'string' || new_player_id.length < 32 || new_player_id.length > 36) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_player_id' }), { status: 400, headers: CORS });
    }

    const supabase = createClient(SB_URL, SB_KEY);

    const { data: newPlayer, error: npErr } = await supabase
      .from('players').select('referred_by, created_at').eq('player_id', new_player_id).single();
    if (npErr || !newPlayer) return new Response(JSON.stringify({ ok: false, error: 'player_not_found' }), { headers: CORS });
    if (newPlayer.referred_by) return new Response(JSON.stringify({ ok: false, error: 'already_processed' }), { headers: CORS });

    const registeredAt = new Date(newPlayer.created_at).getTime();
    if (Date.now() - registeredAt > MAX_REFERRAL_AGE_HOURS * 3_600_000) {
      return new Response(JSON.stringify({ ok: false, error: 'referral_expired' }), { headers: CORS });
    }

    const normalizedPrefix = ref_code.replace(/-/g, '').toLowerCase().slice(0, 8);
    if (normalizedPrefix.length < 8 || !/^[0-9a-f]{8}$/.test(normalizedPrefix)) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_ref_code' }), { headers: CORS });
    }

    const { data: referrers, error: findErr } = await supabase
      .from('players').select('player_id, coins, nick')
      .like('player_id', normalizedPrefix + '%')
      .neq('player_id', new_player_id).limit(1);
    if (findErr) throw findErr;
    const referrer = referrers?.[0];
    if (!referrer) return new Response(JSON.stringify({ ok: false, error: 'referrer_not_found' }), { headers: CORS });

    if (!checkReferrerRateLimit(referrer.player_id)) {
      return new Response(JSON.stringify({ ok: false, error: 'referral_rate_limit' }), { headers: CORS });
    }

    const { error: updateErr } = await supabase.from('players')
      .update({ coins: (referrer.coins || 0) + REFERRAL_BONUS }).eq('player_id', referrer.player_id);
    if (updateErr) throw updateErr;

    await supabase.from('players').update({ referred_by: referrer.player_id }).eq('player_id', new_player_id);

    return new Response(JSON.stringify({ ok: true, referrer_nick: referrer.nick, bonus: REFERRAL_BONUS }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
