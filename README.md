# VFA Diaries

A simple food diary for saving restaurants, suburbs, cuisine, what you ate, typed ratings out of 10, comments, and whether you would buy again. No macros.

## Requirements

- Python 3.10 or newer
- Python packages from `requirements.txt`
- Node.js 20 or newer for `npm run build` and `npm test`

The app uses Python's built-in web server tools, SQLite for local development, optional Neon/Postgres for production, and vendored React files in `vendor/`. The default local database file is `vfa_diaries.sqlite3`, and each user signs in with their own verified email and password.

The frontend source lives in `app.tsx`. Run `npm run build` to compile it into `app.js`, which is what `index.html` serves in the browser.

After signing in, use the `Diary` tab to browse saved entries and the `Add food` tab to add a new restaurant note.

## Run The App

From this folder:

```bash
pip install -r requirements.txt
npm install
npm run build
python3 server.py
```

The server automatically loads `.env` if it exists. If SMTP is not configured, email verification codes print in the terminal.

For Gmail verification setup, see [EMAIL_SETUP.md](EMAIL_SETUP.md).

Open:

```text
http://127.0.0.1:8000
```

Keep the terminal open while using the app. Stop the server with `Ctrl+C`.

## Tests

Build the frontend TypeScript and run the integration tests with:

```bash
npm test
```

## If Port 8000 Is Busy

If you see a message that the port is already in use, another copy of the server is probably still running.

Use one of these:

```bash
# Stop the old server in its terminal with Ctrl+C
```

```bash
# Or run this app on another port
PORT=8001 python3 server.py
```

Then open:

```text
http://127.0.0.1:8001
```

## Data

- Users and diary entries are stored in SQLite locally, or Postgres when `DATABASE_URL` is set.
- By default, the local database file is `vfa_diaries.sqlite3`.
- Set `DATABASE_PATH` to move the SQLite file onto a persistent disk or volume.
- Set `DATABASE_URL` to use Neon/Postgres instead of SQLite.
- Passwords are stored as salted PBKDF2 hashes, not plain text.
- Email verification codes are stored as salted PBKDF2 hashes and expire after 15 minutes.
- `.env` and the local SQLite database are ignored by git.

## Deploy

For the easiest free production setup, use Render for the web app and Neon for the Postgres database.

### Render + Neon

1. In Neon, create a project and click `Connect`.
2. Copy the Postgres connection string. It should look like `postgresql://...neon.tech/...?...sslmode=require`.
3. In Render, create a Python web service from this repo.
4. Use build command `pip install -r requirements.txt`.
5. Use start command `python3 server.py`.
6. In Render's environment variables, add `DATABASE_URL` with the Neon connection string.
7. Also add the SMTP variables from your local `.env`.

Render sets `RENDER=true` and `PORT` automatically, so the server binds to `0.0.0.0` on Render. If you set `DATABASE_URL`, the app creates the Postgres tables automatically on startup.

Production environment example:

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

SQLite also works for one small web instance if your host provides a persistent disk. In that setup, set `DATABASE_PATH=/var/data/vfa_diaries.sqlite3` instead of `DATABASE_URL`.

## Email Verification

Registration requires an email address. The user cannot log in until they enter the 6-digit verification code.

For local development, if SMTP is not configured, the server prints the code in the terminal:

```text
[VFA Diaries] Verification code for you@example.com: 123456
```

To send real emails, run the app with SMTP settings:

```bash
SMTP_HOST=smtp.example.com \
SMTP_PORT=587 \
SMTP_USERNAME=your_username \
SMTP_PASSWORD=your_password \
SMTP_FROM=no-reply@example.com \
python3 server.py
```

Optional SMTP flags:

```bash
SMTP_STARTTLS=true
SMTP_SSL=false
```
