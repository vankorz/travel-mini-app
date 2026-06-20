# Telegram Mini App — Турагентство

Форма заявки на подбор тура, запускается внутри Telegram как Mini App.

## Структура

```
travel_mini_app/
├── webapp/
│   └── index.html      # Фронтенд (работает в Telegram WebView)
├── server/
│   └── index.js        # Express-сервер, отправляет заявку в группу менеджеров
├── package.json
├── .env.example
└── README.md
```

## Быстрый старт

### 1. Установить зависимости

```bash
npm install
```

### 2. Создать .env

```bash
cp .env.example .env
```

Открыть `.env` и заполнить:

| Переменная | Как получить |
|---|---|
| `BOT_TOKEN` | Написать `@BotFather` → `/newbot` или `/mybots` |
| `MANAGER_CHAT_ID` | Добавить бота в группу → написать `/start` → открыть `https://api.telegram.org/bot<TOKEN>/getUpdates` и найти `chat.id` |

> ID супергрупп начинается с `-100`, например `-1001234567890`.

### 3. Запустить сервер

```bash
npm start
```

Сервер запустится на `http://localhost:3000`.

### 4. Зарегистрировать Mini App в BotFather

1. Написать `@BotFather` → `/newapp`
2. Выбрать своего бота
3. Указать URL — это должен быть **HTTPS**-адрес, где доступен `webapp/index.html`

Для локального тестирования используйте ngrok:
```bash
npx ngrok http 3000
```
Полученный HTTPS-URL вставить в BotFather.

### 5. Добавить кнопку запуска Mini App в бота

Через BotFather: `/setmenubutton` → выбрать бота → вставить URL вашего Mini App.

---

## Как работает

```
Пользователь → Telegram → WebView (webapp/index.html)
                                  ↓ POST /api/lead
                           Express-сервер
                                  ↓ sendMessage
                           Группа менеджеров в Telegram
```

1. Пользователь открывает Mini App через кнопку в боте
2. Заполняет форму (9 шагов)
3. Данные отправляются POST-запросом на `/api/lead`
4. Сервер форматирует заявку и отправляет в группу менеджеров через Bot API
5. Перед отправкой заявка сохраняется в `data/leads.jsonl`, чтобы она не потерялась при сбое Telegram API

---

## Дополнительно

- **Dev-режим с авторелоадом:** `npm run dev` (требует `nodemon`)
- **Health check:** `GET /health` → `{"status":"ok"}`
- **CORS:** настраивается через `WEBAPP_ORIGIN` в `.env`
- **Проверка Telegram:** по умолчанию сервер требует валидный `initData` от Telegram WebApp. Для локального теста в обычном браузере можно временно поставить `REQUIRE_TELEGRAM_AUTH=false` в `.env`.
- **Журнал заявок:** заявки пишутся в `data/leads.jsonl` в формате JSON Lines.

---

## Что добавить в production

- [x] Верификация `initData` от Telegram (защита от подделки)
- [x] Локальный журнал заявок перед отправкой в Telegram
- [ ] SQLite или PostgreSQL вместо JSONL-журнала для хранения заявок
- [ ] Inline-кнопки под заявкой (Взять в работу / Продано / Отказ)
- [ ] Уведомление клиенту через бота после приёма заявки
- [ ] Деплой на VPS + nginx + certbot (HTTPS обязателен для Mini Apps)
