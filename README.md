# Backup Control — Homelab Panel

**Homelab Backup & Import Control Plane** — веб-панель для управління бекапами та імпортами на твоєму домашньому сервері.

## Що це таке?

Це MVP версія Control Plane для твого homelab. Панель дозволяє:

- **Dashboard** — бачити стан всіх бекапів одним поглядом (що працює, що зламалось, скільки даних перенесено)
- **Jobs** — керувати backup job'ами (rclone copy у Google Drive, Immich DB backup)
- **Run History** — переглядати історію всіх запусків з логами та статистикою
- **Settings** — налаштувати Telegram сповіщення, rclone конфіг, blackout window

---

## Як запустити (покроково для новачка)

### Крок 1: Переконайся, що у тебе є Node.js

Відкрий термінал (Terminal) і виконай:

```bash
node --version
```

Має показати щось на кшталт `v20.x.x` або `v22.x.x`. Якщо команда не знайдена — встанови Node.js:
- **macOS**: `brew install node` (якщо є Homebrew) або скачай з https://nodejs.org
- **Linux (Debian/Ubuntu)**: `sudo apt update && sudo apt install nodejs npm`
- **Windows**: Скачай з https://nodejs.org

### Крок 2: Перейди в папку проєкту

```bash
cd /Users/artemlevchenko/server-ui/app
```

> Якщо ти перенесеш проєкт в іншу папку — просто `cd` до тієї папки.

### Крок 3: Встанови залежності

```bash
npm install
```

Це встановить всі потрібні пакети. Може зайняти 1-2 хвилини.

### Крок 4: Запусти dev-сервер

```bash
npm run dev
```

Побачиш щось таке:

```
▲ Next.js 16.x
- Local:    http://localhost:3000
✓ Ready in 800ms
```

### Крок 5: Відкрий у браузері

Перейди на **http://localhost:3000** — і ти побачиш Dashboard!

---

## Як користуватись

### Dashboard (Головна)

На головній сторінці ти бачиш:
- **Active Jobs** — скільки бекап-задач активних
- **Success Rate** — відсоток успішних запусків
- **Failed** — скільки задач потребують уваги
- **Data Backed Up** — скільки даних вже забекаплено
- **Job Status Overview** — кожна задача зі статусом (зелений = ок, червоний = помилка)
- **Recent Runs** — останні запуски
- **Disk Usage** — скільки місця на кожному диску

### Jobs (Задачі)

Тут ти можеш:
1. **Переглянути** всі задачі — вони відповідають твоїм реальним бекапам (Nextcloud → Google Drive, Immich → Google Drive тощо)
2. **Увімкнути/Вимкнути** задачу — toggle switch справа
3. **Run Now** — запустити задачу прямо зараз (в MVP симулює виконання)
4. **Редагувати** — натисни олівець, зміни source/destination/schedule
5. **Видалити** — натисни кошик
6. **New Job** — створити нову задачу

### Run History (Історія)

Тут ти бачиш:
- Список всіх запусків (найновіші зверху)
- Фільтр по статусу (All / Success / Failed / Running)
- Натисни на будь-який запуск — побачиш деталі: тривалість, кількість файлів, логи

### Settings (Налаштування)

Тут налаштовуєш:
- **Telegram** — бот-токен, chat ID, які події сповіщати
- **Rclone** — шлях до конфіг-файлу, ліміт швидкості
- **Scheduling** — max concurrent jobs, blackout window (коли не робити бекапи, щоб не заважати Jellyfin)

Не забудь натиснути **Save All** після змін!

---

## Що вже працює (MVP Phase A)

| Функція | Статус |
|---------|--------|
| Dashboard зі статистикою | ✅ Працює |
| Job Status Overview | ✅ Працює |
| Disk Usage моніторинг | ✅ Працює (demo дані з твого серверу) |
| Список Jobs з CRUD | ✅ Працює |
| Run Now (запуск вручну) | ✅ Працює (симуляція) |
| Run History з деталями/логами | ✅ Працює |
| Settings (Telegram, rclone, scheduling) | ✅ Працює |
| SQLite State Store | ✅ Працює |
| Dark theme | ✅ Працює |
| Responsive (mobile + desktop) | ✅ Працює |

## Що буде далі (Phase B & C)

- [ ] Реальне виконання rclone через subprocess на сервері
- [ ] Telegram нотифікації (відправка повідомлень)
- [ ] Реальний disk usage через `df` на сервері
- [ ] Systemd timer integration
- [ ] Immich-go Import Wizard
- [ ] Uptime Kuma integration
- [ ] Docker deployment (docker-compose для серверу)

---

## Технічний стек

- **Next.js 16** — React framework з API routes
- **shadcn/ui** — beautiful UI components
- **Tailwind CSS 4** — стилізація
- **SQLite** (better-sqlite3) — база даних (файл `data/backup-control.db`)
- **TypeScript** — type-safe код

## Структура проєкту

```
app/
├── src/
│   ├── app/
│   │   ├── page.tsx          ← Dashboard
│   │   ├── layout.tsx        ← Головний layout з sidebar
│   │   ├── jobs/page.tsx     ← Сторінка Jobs
│   │   ├── runs/page.tsx     ← Сторінка Run History
│   │   ├── settings/page.tsx ← Сторінка Settings
│   │   └── api/              ← API routes (backend)
│   │       ├── stats/        ← Dashboard статистика
│   │       ├── jobs/         ← CRUD для jobs
│   │       ├── runs/         ← Список runs
│   │       └── settings/     ← Settings CRUD
│   ├── components/
│   │   ├── ui/               ← shadcn компоненти
│   │   ├── sidebar-nav.tsx   ← Бокове меню
│   │   └── mobile-nav.tsx    ← Мобільне меню
│   └── lib/
│       ├── db.ts             ← SQLite database layer
│       ├── types.ts          ← TypeScript типи
│       └── utils.ts          ← Утиліти
├── data/
│   └── backup-control.db    ← SQLite база (створюється автоматично)
└── package.json
```

## FAQ

**Q: Де зберігається база даних?**
A: У файлі `data/backup-control.db`. Він створюється автоматично при першому запуску.

**Q: Як скинути всі дані?**
A: Видали файл `data/backup-control.db` і перезапусти сервер.

**Q: Чому "Run Now" симулює виконання?**
A: Це MVP. В Phase B підключимо реальний rclone та immich-go через subprocess.

**Q: Як деплоїти на сервер (Docker VM)?**
A: У наступній фазі створимо `docker-compose.yml`. Поки можна запустити через `npm run dev` або `npm run build && npm start`.

**Q: Як зупинити сервер?**
A: Натисни `Ctrl+C` у терміналі де запущено `npm run dev`.
