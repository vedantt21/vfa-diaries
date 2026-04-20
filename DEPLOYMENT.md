# Production Deployment

VFA Diaries is ready for Render. The best free production setup is Render for the Python web service plus Neon for managed Postgres.

## Best Free Setup: Render + Neon

Use Neon for the database so your data survives Render restarts and redeploys without paying for a Render persistent disk.

### 1. Create The Neon Database

1. Open Neon and create a project.
2. Click `Connect` in the project dashboard.
3. Copy the Postgres connection string.
4. Make sure the string includes SSL, usually `sslmode=require`.

It should look like this:

```text
postgresql://user:password@host/database?sslmode=require
```

You do not need the `npx neonctl@latest init` flow for this app.

### 2. Create The Render Web Service

In Render:

1. Click `New` then `Web Service`.
2. Connect `https://github.com/vedantt21/vfa-diaries`.
3. Choose the Python runtime.
4. Set the build command:

```bash
pip install -r requirements.txt
```

5. Set the start command:

```bash
python3 server.py
```

Render automatically provides `RENDER=true` and `PORT`. The server uses those to bind to `0.0.0.0`, which is required for Render to detect the app.

### 3. Add Render Environment Variables

Set these in the Render service's `Environment` page:

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_STARTTLS=true
SMTP_SSL=false
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-16-character-app-password
SMTP_FROM=your-email@gmail.com
```

Do not paste your local `.env` into git. Add those values in Render's dashboard only.

## What The Render Error Meant

This log:

```text
Unsupported method ('HEAD')
No open ports detected on 0.0.0.0
```

meant two things:

- Render sent `HEAD /` as a health check, but the server only handled `GET`.
- The server was listening on `127.0.0.1`, which is private inside the container. Render needs the app to listen on `0.0.0.0`.

Both are fixed in `server.py`.

## Alternative: SQLite With A Persistent Disk

SQLite is okay for one small web instance, but the SQLite file must live on persistent storage. Render persistent disks are not part of the free web service setup, so Neon is usually better here.

If you use a paid persistent disk, set:

```env
DATABASE_PATH=/var/data/vfa_diaries.sqlite3
```

Do not set `DATABASE_URL` in that setup.

## Keep Out Of Git

These must stay local or in host-managed storage:

```text
.env
vfa_diaries.sqlite3
data/
uploads/
```
