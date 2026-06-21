# Admin API — контракт для админ-панели (zx7k-tools)

Этот файл — **единый источник правды** о том, как админ-панель общается с базой.
Здесь **нет секретов**: пароль (`ADMIN_PASS_HASH`) хранится только в переменных
окружения Supabase и сюда никогда не записывается.

> Правило координации: **базу/SQL меняет только сессия репозитория `snake`.**
> Панель (`zx7k-tools`) лишь шлёт готовые запросы из этого файла. Если нужен новый
> запрос или колонка — он добавляется здесь, потом используется в панели.

---

## Эндпоинт

```
POST https://wopvlulqfzecujmfoezr.supabase.co/functions/v1/admin-sql
Content-Type: application/json
```

- JWT/apikey **не нужны** (`verify_jwt = false`).
- Тело запроса:

```json
{ "query": "<SQL>", "auth": "<пароль из поля ввода панели>" }
```

- `auth` — пароль, который вводит админ. На сервере он сравнивается
  константно-временным методом с секретом `ADMIN_PASS_HASH`. Должны совпасть.
- Ответ при успехе: `{ "data": [ ... ] }`
- Ответ при ошибке: `{ "error": "..." }`
  - `401` — неверный пароль
  - `429` — слишком много запросов (лимит 60/мин на IP)
  - `400` — ошибка SQL / нет полей

Панель **не должна** ходить напрямую в `/rest/v1/players` или `/rest/v1/game_results`
анонимным ключом — поле `telegram_id` скрыто от `anon`, счётчики будут нулевыми.
Вся статистика — только через этот эндпоинт.

---

## Разрешённые запросы (read-only)

```sql
-- Игроки, пришедшие из Telegram
select count(*)::int as telegram_users from players where telegram_id is not null;

-- Сейчас онлайн (активность за 5 минут)
select count(*)::int as online from players where last_seen > now() - interval '5 minutes';

-- Всего сыграно игр
select coalesce(sum(games_played),0)::int as total_games from players;

-- Топ лидерборда
select nick, best, best_level from players order by best desc limit 10;

-- Последние результаты игр
select name, score, level, mode, created_at
from game_results order by created_at desc limit 20;
```

---

## Схема (справочно)

- `players`: `telegram_id, nick, best, best_level, coins, games_played,
  last_seen, last_daily_sent, write_token, referred_by, is_online, …`
- `game_results`: `name, score, level, mode, player_id, created_at`
- `player_events`
- Вьюхи: `players_public`, `leaderboard_top`, `leaderboard_best`

## Рассылки

- `/broadcast <текст>` в Telegram-боте — только для админа `id = 1618832636`.
- Edge-функция `broadcast` — по service-key (тело: `message`, `only_active`,
  `button`, `test_chat_id`).
- `daily-quests` — по `CRON_SECRET` (ежедневные задания + сообщения).
