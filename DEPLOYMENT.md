# Production Deployment

VFA Diaries can run as a small production app with SQLite as long as the SQLite file lives on persistent storage.

## Required Environment Variables

Set these in your hosting provider's dashboard:

```env
HOST=0.0.0.0
DATABASE_PATH=/var/data/vfa_diaries.sqlite3
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_STARTTLS=true
SMTP_SSL=false
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-16-character-app-password
SMTP_FROM=your-email@gmail.com
```

Do not set `PORT` unless your hosting provider asks you to. Most providers set it automatically.

## Persistent Database Storage

1. Create a persistent disk, volume, or storage mount in your host.
2. Mount it at a stable path, such as `/var/data`.
3. Set `DATABASE_PATH` to a file inside that mount:

```env
DATABASE_PATH=/var/data/vfa_diaries.sqlite3
```

The app creates the parent directory if needed and initializes the SQLite database automatically.

## Runtime Command

Hosts that support `Procfile` should use:

```text
web: HOST=0.0.0.0 python3 server.py
```

That command is already in `Procfile`.

## SQLite Production Limits

SQLite is fine for one small web instance and a persistent disk. Do not run multiple app instances against the same SQLite file. If you need multiple instances or higher traffic, move the data to managed Postgres.

## Keep Out Of Git

These must stay local or in host-managed storage:

```text
.env
vfa_diaries.sqlite3
data/
uploads/
```
