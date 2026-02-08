# Деплой Backup Control на сервер

## Рекомендований спосіб: GitHub + Portainer

Схема роботи:
```
Push на GitHub → GitHub Actions збирає Docker image → Portainer тягне image → Done!
```

Для оновлення: push зміни на GitHub → в Portainer натисни "Update" → готово.

---

## Перший деплой (покроково)

### Крок 1: GitHub Actions зберуть image автоматично

Після push на GitHub, перейди на:
**https://github.com/artem-levchenko-2/backup-control** → вкладка **Actions**

Там побачиш workflow "Build & Push Docker Image" — він автоматично:
1. Збирає Docker image з Dockerfile
2. Пушить його в GitHub Container Registry (`ghcr.io/artem-levchenko-2/backup-control:latest`)

Зачекай поки workflow стане зеленим (2-3 хвилини).

### Крок 2: Зроби package публічним (один раз)

Після першого успішного build:

1. Відкрий: **https://github.com/artem-levchenko-2?tab=packages**
2. Натисни на `backup-control`
3. Справа: **Package settings**
4. Внизу: **Change visibility** → **Public** → підтверди
5. Збережи

> Це потрібно один раз, щоб Portainer міг тягнути image без аутентифікації.

### Крок 3: Створи Stack у Portainer

1. Відкрий Portainer: **http://192.168.3.200:9000** (або твій порт)
2. Перейди: **Stacks** → **+ Add stack**
3. Заповни:
   - **Name**: `backup-control`
   - **Build method**: вибери **Repository**
   - **Repository URL**: `https://github.com/artem-levchenko-2/backup-control`
   - **Repository reference**: `refs/heads/main`
   - **Compose path**: `portainer-stack.yml`
4. Натисни **Deploy the stack**

Portainer скачає `portainer-stack.yml` з GitHub та запустить контейнер.

### Крок 4: Налаштуй DNS та Reverse Proxy

#### Pi-hole (http://192.168.3.200:8081/admin):
1. Local DNS → DNS Records
2. Додай: `backup.home.arpa` → `192.168.3.200`

#### Nginx Proxy Manager (http://192.168.3.200:81):
1. Proxy Hosts → Add Proxy Host
2. **Domain Names**: `backup.home.arpa`
3. **Scheme**: `http`
4. **Forward Hostname / IP**: `192.168.3.200`
5. **Forward Port**: `3100`
6. **Websockets Support**: ON
7. Save

### Результат

Відкриваєш **http://backup.home.arpa** — панель працює!
- Вдома — через Pi-hole DNS
- Ззовні — через Tailscale (split DNS вже налаштовано)

---

## Оновлення (workflow на кожен день)

Коли ти вносиш зміни в код:

```bash
# 1. Зроби зміни в Cursor
# 2. Закоміть та запуш:
cd /Users/artemlevchenko/server-ui/app
git add .
git commit -m "опис змін"
git push
```

GitHub Actions автоматично збере новий image (2-3 хв).

Далі в Portainer:
1. Відкрий **Stacks** → `backup-control`
2. Натисни **Pull and redeploy** (або "Update the stack" з галочкою "Re-pull image")
3. Done — нова версія запущена!

---

## Альтернатива: SSH + docker compose (без GitHub)

Якщо не хочеш використовувати GitHub:

```bash
# Скопіюй на сервер
rsync -avz --exclude='node_modules' --exclude='.next' --exclude='data' \
  /Users/artemlevchenko/server-ui/app/ \
  user@192.168.3.200:/opt/backup-control/

# Збери та запусти
ssh user@192.168.3.200 "cd /opt/backup-control && docker compose up -d --build"
```

---

## Корисні команди на сервері

```bash
# Статус
docker ps | grep backup-control

# Логи
docker logs --tail 50 backup-control
docker logs -f backup-control    # в реальному часі

# Перезапуск
docker restart backup-control

# Зупинка (через Portainer або CLI)
docker stop backup-control
```

## Порти

Backup Control працює на порту **3100** (вільний, не конфліктує з іншими сервісами).
