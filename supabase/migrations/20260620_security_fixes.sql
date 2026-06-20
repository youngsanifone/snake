-- Security fixes applied 2026-06-20

-- 1. Prevent telegram_id/player_id hijack via anon PATCH
CREATE OR REPLACE FUNCTION public.guard_player_protected_fields()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'anon' THEN
    NEW.player_id   := OLD.player_id;
    NEW.telegram_id := OLD.telegram_id;
    NEW.created_at  := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_player_protected_fields
  BEFORE UPDATE ON players FOR EACH ROW
  EXECUTE FUNCTION guard_player_protected_fields();

-- 2. players_update: add WITH CHECK (validate new values)
DROP POLICY IF EXISTS players_update ON players;
CREATE POLICY players_update ON players FOR UPDATE
  USING (player_id IS NOT NULL)
  WITH CHECK (
    player_id IS NOT NULL
    AND (nick IS NULL OR (length(trim(nick)) >= 1 AND length(trim(nick)) <= 20))
    AND (coins IS NULL OR (coins >= 0 AND coins <= 99999))
    AND (best IS NULL OR (best >= 0 AND best <= 99999))
    AND (games_played IS NULL OR games_played >= 0)
    AND (total_score IS NULL OR total_score >= 0)
  );

-- 3. Guard bought_skins and achievements from being zeroed
-- (see guard_player_coins function update in app)

-- 4. Drop dead/dangerous function
DROP FUNCTION IF EXISTS public.sync_player_stats_on_game();

-- Index to support referral prefix lookup
CREATE INDEX IF NOT EXISTS idx_players_player_id_prefix ON players (player_id text_pattern_ops);
