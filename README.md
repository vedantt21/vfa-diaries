# VFA Diaries

A simple food diary for saving restaurants, cuisine, what you ate, typed ratings out of 10, comments, and whether you would buy again. No macros.

## Requirements

- Python 3.10 or newer
- No extra packages required

The app uses Python's built-in web server tools, SQLite, and vendored React files in `vendor/`. The database file is `vfa_diaries.sqlite3`, and each user signs in with their own verified email and password.

After signing in, use the `Diary` tab to browse saved entries and the `Add food` tab to add a new restaurant note.

## Run The App

From this folder:

```bash
python3 server.py
```

The server automatically loads `.env` if it exists. If SMTP is not configured, email verification codes print in the terminal.

For Gmail verification setup, see [EMAIL_SETUP.md](EMAIL_SETUP.md).

Open:

```text
http://127.0.0.1:8000
```

Keep the terminal open while using the app. Stop the server with `Ctrl+C`.

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

- Users and diary entries are stored in `vfa_diaries.sqlite3`.
- Passwords are stored as salted PBKDF2 hashes, not plain text.
- Email verification codes are stored as salted PBKDF2 hashes and expire after 15 minutes.
- `.env` and the local SQLite database are ignored by git.

## Deploy

This project is ready for simple Python app hosts that support a `Procfile`.

Before deploying:

- Commit the code, `vendor/` React files, `.env.example`, `Procfile`, and `requirements.txt`.
- Do not commit `.env` or `vfa_diaries.sqlite3`.
- In the host dashboard, set `HOST=0.0.0.0`.
- Set `PORT` only if your host does not set it automatically.
- Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`, and `SMTP_SSL` as environment variables.

SQLite works for a small single-server deployment. If your host has an ephemeral filesystem, add persistent disk storage or move the database to a managed database before real users rely on it.

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
