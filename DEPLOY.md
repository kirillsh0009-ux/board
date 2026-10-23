# Деплой на бесплатный хостинг

Архитектура продакшена: **один** Node-сервис (Render Free) = Next.js (UI + REST API) + socket.io (`/socket.io`, тот же домен) + облачная PostgreSQL (Neon Free). Данные переживают перезапуски.

Файлы:
- `prod-server.mjs` — прод-сервер (порт WS-логики из `mini-services/board-ws/index.ts` + Next)
- `prisma/schema.prod.prisma` — схема для PostgreSQL (песочница использует `schema.prisma`/SQLite — модели держать синхронно!)
- `render.yaml` — Blueprint для Render

## Вариант A — «сделает Z.ai» (нужны 3 ключа от тебя)

Создай (всё бесплатно, без карты) и пришли в чат:

1. **GitHub** → пустой приватный репозиторий, например `coop-board`
   → Settings → Developer settings → Fine-grained tokens → Generate:
   - Repository access: только этот репозиторий
   - Permissions: Contents + Administration = **Read and write**
   → пришли токен (и ник/имя репо)
2. **Neon** (neon.tech) → New Project → скопируй **Connection string** (`postgresql://...neon.tech/neondb?sslmode=require`) → пришли
3. **Render** (render.com, вход через GitHub) → Account Settings → API Keys → Create → пришли ключ

Я: запушу код → создам схему в Neon → создам сервис через Render API → дождусь деплоя → прогоню E2E на живом URL → дам ссылку.
После настройки токены можно отозвать (я скажу когда).

## Вариант B — ручками (~5 минут, только клики)

1. GitHub: создай пустой приватный репо → загрузить файлы проекта (без node_modules/.next/db — они в .gitignore)
2. Neon: проект → скопировать connection string
3. Render: New + → Blueprint → выбрать репо (разрешить доступ) → в поле `DATABASE_URL` вставить строку Neon → Apply → ждать ~5 мин
4. Готово: URL вида `https://coop-board-xxxx.onrender.com`

## Замечания по Free-тарифам

- Render Free **засыпает** после 15 мин без запросов; первый заход после сна ~30–60 с (позже — мгновенно). Пока кто-то на доске — не засыпает.
- Neon Free усыпляет БД после ~5 мин простоя: первый запрос +0.5–1 с. Данные не стираются.
- socket.io ходит по тому же домену (`/socket.io`) — upgrade WebSocket через прокси Render поддерживается.
- Если Neon потребует карту — альтернатива: Supabase (без карты) или Turso; `DATABASE_URL` любого PostgreSQL-провайдера совместим.
