-- ============================================
-- Snake Game - Supabase Setup Script
-- Запусти это в: Supabase → SQL Editor → New query
-- ============================================

-- 1. Включить RLS на таблице leaderboard
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;

-- 2. Политика: все могут ЧИТАТЬ рекорды (публичный лидерборд)
CREATE POLICY "Anyone can read leaderboard"
  ON leaderboard
  FOR SELECT
  USING (true);

-- 3. Политика: любой может ДОБАВИТЬ свой результат (включая анонимов)
CREATE POLICY "Anyone can insert score"
  ON leaderboard
  FOR INSERT
  WITH CHECK (true);

-- 4. Запретить UPDATE и DELETE с клиента (безопасность)
-- (без политик UPDATE/DELETE они уже заблокированы при включённом RLS)

-- 5. Включить Realtime на leaderboard (live-обновление таблицы рекордов)
ALTER PUBLICATION supabase_realtime ADD TABLE leaderboard;

-- 6. Индекс для быстрой сортировки по очкам
CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard (score DESC);

-- 7. Индекс по режиму игры
CREATE INDEX IF NOT EXISTS idx_leaderboard_mode ON leaderboard (mode);

-- Проверка — покажет настройки RLS
SELECT
  relname AS table_name,
  relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname = 'leaderboard';
