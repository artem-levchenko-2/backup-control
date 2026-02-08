# Перше налаштування Backup Control

Покрокова інструкція для новачка: від "панель відкрилась" до "бекапи працюють".

---

## Крок 0: Відкрий панель

Відкрий у браузері:
- **http://backup.home.arpa** (якщо вже налаштував DNS + NPM)
- або **http://192.168.3.200:3100** (напряму)

Ти побачиш Dashboard з демо-даними — це нормально, далі налаштуємо все під реальність.

---

## Крок 1: Створи Telegram бота (5 хвилин)

Це потрібно, щоб отримувати сповіщення про статус бекапів у Telegram.

### 1.1 Створи бота

1. Відкрий Telegram, знайди **@BotFather**
2. Напиши йому: `/newbot`
3. Придумай ім'я: наприклад `Homelab Backup Bot`
4. Придумай username: наприклад `artem_homelab_backup_bot`
5. BotFather дасть тобі **токен** — щось типу:
   ```
   7123456789:AAHxyz-абвгд_12345abcdef
   ```
6. **Збережи цей токен** — він потрібен далі

### 1.2 Дізнайся свій Chat ID

1. Знайди в Telegram бота **@userinfobot**
2. Напиши йому `/start`
3. Він відповість повідомленням з твоїм **ID** — число типу `123456789`
4. **Збережи цей ID**

### 1.3 Введи в панелі

1. Відкрий панель → **Settings**
2. У секції **Telegram Notifications**:
   - **Enable Telegram**: увімкни (toggle)
   - **Bot Token**: встав токен з BotFather
   - **Chat ID**: встав свій Chat ID
   - **On Failure**: увімкнено (вже за замовчуванням)
   - **Daily Digest**: увімкнено (за замовчуванням)
3. Натисни **Save All**

---

## Крок 2: Налаштуй rclone на сервері (10 хвилин)

rclone — це програма, яка копіює файли у Google Drive. Її треба налаштувати один раз на сервері.

### 2.1 Встанови rclone (якщо ще немає)

SSH на сервер:
```bash
ssh user@192.168.3.200
```

Встанови:
```bash
sudo apt update
sudo apt install rclone -y
```

Перевір:
```bash
rclone version
```

### 2.2 Налаштуй Google Drive remote

```bash
rclone config
```

Далі по кроках:
1. Вибери `n` (new remote)
2. Name: `gdrive`
3. Storage: вибери `drive` (Google Drive) — зазвичай номер `18` або знайди в списку
4. Client ID: просто натисни Enter (пустий — використає дефолтний)
5. Client Secret: натисни Enter
6. Scope: вибери `1` (Full access)
7. Root folder ID: Enter (пустий)
8. Service account: Enter (пустий)
9. Advanced config: `n`
10. Auto config: `n` (бо ти на сервері без GUI)

rclone покаже URL — **відкрий його в браузері на своєму Mac**:
```
http://127.0.0.1:53682/auth?state=xxxxx
```

Або він дасть тобі пряму URL для авторизації — відкрий, увійди в Google, дозволь доступ, скопіюй код і встав назад у термінал.

11. Team Drive: `n`
12. Confirm: `y`
13. Quit: `q`

### 2.3 Перевір підключення

```bash
# Подивись що є на Google Drive
rclone lsd gdrive:

# Створи тестову папку
rclone mkdir gdrive:backups

# Перевір
rclone lsd gdrive:backups
```

Якщо бачиш папки/файли — rclone працює!

### 2.4 Де конфіг?

```bash
# Покаже шлях до конфігу
rclone config file
```

Зазвичай: `/home/user/.config/rclone/rclone.conf`

Цей шлях введи в панелі: **Settings** → **Rclone Configuration** → **Config Path** → **Save All**

---

## Крок 3: Зроби тестовий бекап вручну (перевірка)

Перш ніж довіряти автоматизації — перевір все вручну на сервері.

### 3.1 Тест: Nextcloud → Google Drive

```bash
# Подивись скільки даних
du -sh /mnt/toshiba/nextcloud-data
```

Зроби тестову копію (тільки перших 10 файлів, dry-run):
```bash
rclone copy /mnt/toshiba/nextcloud-data gdrive:backups/nextcloud-data \
  --dry-run \
  --progress \
  --max-transfer 100M
```

`--dry-run` означає "покажи що зробив би, але нічого не копіюй".

Якщо все виглядає правильно — запусти без dry-run:
```bash
rclone copy /mnt/toshiba/nextcloud-data gdrive:backups/nextcloud-data \
  --progress \
  --transfers 4 \
  --bwlimit 10M \
  --checksum
```

### 3.2 Тест: Immich Media → Google Drive

```bash
du -sh /srv/storage/transcend/immich

# Dry-run
rclone copy /srv/storage/transcend/immich gdrive:backups/immich-media \
  --dry-run \
  --progress \
  --exclude 'thumbs/**' \
  --exclude 'encoded-video/**'
```

Якщо ок — запусти реально (може зайняти годину+ залежно від обсягу):
```bash
rclone copy /srv/storage/transcend/immich gdrive:backups/immich-media \
  --progress \
  --transfers 4 \
  --bwlimit 10M \
  --checksum \
  --exclude 'thumbs/**' \
  --exclude 'encoded-video/**'
```

### 3.3 Тест: Immich DB dump

```bash
# Дамп бази Immich
docker exec immich_postgres pg_dump -U postgres immich \
  > /tmp/immich-db-$(date +%Y%m%d).sql

# Перевір розмір
ls -lh /tmp/immich-db-*.sql

# Скопіюй в Google Drive
rclone copy /tmp/immich-db-*.sql gdrive:backups/immich-db/ --progress
```

### 3.4 Перевір на Google Drive

```bash
# Що є в бекапах
rclone lsd gdrive:backups/
rclone ls gdrive:backups/nextcloud-data/ | head -20
rclone ls gdrive:backups/immich-media/ | head -20
rclone ls gdrive:backups/immich-db/
```

---

## Крок 4: Перевір панель

Тепер повернись до **http://backup.home.arpa** (або :3100):

### Dashboard
- Бачиш 4 job'и зі статусами
- Disk usage показує твої диски
- Recent Runs показує останні запуски

### Jobs → Run Now
- Натисни **Run Now** на будь-якому job'і
- З'явиться toast "Job started"
- Через кілька секунд — з'явиться в **Run History**
- Поки це симуляція (не реальний rclone), але працює повний цикл:
  створення run → виконання → запис результату → відображення

### Run History
- Натисни на будь-який run — побачиш деталі: тривалість, файли, логи
- Фільтруй по статусу: All / Success / Failed

### Settings
- Перевір що Telegram і rclone path збережені

---

## Крок 5: Що реально vs що демо (важливо розуміти)

| Що | Статус | Пояснення |
|---|---|---|
| UI (Dashboard, Jobs, Runs, Settings) | **Реальне** | Все зберігається в SQLite |
| Створення/редагування/видалення Jobs | **Реальне** | CRUD повністю працює |
| Run History та деталі | **Реальне** | Зберігається в базі |
| Settings (Telegram, rclone path) | **Реальне** | Зберігається в базі |
| "Run Now" виконання | **Симуляція** | Створює run з рандомним результатом |
| Telegram відправка | **Ще не підключено** | Токен зберігається, відправка — Phase B |
| Disk usage | **Демо-дані** | Показує дані з твого серверу, але статичні |
| Реальний rclone backup | **Вручну через SSH** | Підключення до Job Runner — Phase B |

### Що буде в Phase B (наступний крок розробки):
- "Run Now" реально запускатиме `rclone copy` на сервері
- Telegram бот буде відправляти повідомлення
- Disk usage буде читатися з `df` в реальному часі
- systemd timers для автоматичних нічних бекапів

---

## FAQ

**Q: Я зробив тестовий бекап вручну. Він з'явиться в панелі?**
A: Поки ні — панель ще не підключена до реального rclone. Це буде в Phase B. Зараз панель відстежує тільки run'и запущені через "Run Now" (симуляція).

**Q: Як часто робити бекапи?**
A: Рекомендовано:
- Nextcloud datadir: щодня о 02:00 (бо ~13GB, 15-20 хвилин)
- Immich media: щодня о 03:00 (incremental, тому швидко після першого разу)
- Immich DB: щодня о 04:00 (маленький, 30-50MB, за секунди)
- Media library: раз на тиждень (великий, ~59GB)

**Q: Перший бекап буде дуже довгий?**
A: Так! Перший раз rclone копіює ВСЕ. Наступні рази — тільки зміни (incremental). Тому перший запуск краще робити вночі або коли не використовуєш мережу.

**Q: А якщо Google Drive закінчиться?**
A: Безкоштовно 15GB. Якщо в тебе більше даних — потрібен Google One (100GB за ~$2/міс, 2TB за ~$10/міс). Перевірити поточне використання: `rclone about gdrive:`

**Q: Чи безпечно зберігати токени в панелі?**
A: Для домашнього використання в локальній мережі — так. Панель доступна тільки через VPN (Tailscale) і локалку. Токени зберігаються в SQLite на сервері.
