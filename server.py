from __future__ import annotations

import errno
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import smtplib
import sqlite3
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "vfa_diaries.sqlite3"
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
}
MAX_REQUEST_BYTES = 256 * 1024
PASSWORD_ITERATIONS = 210_000
VERIFICATION_TTL_MINUTES = 15
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,24}$")


FormData = dict[str, str]


class VfaServer(ThreadingHTTPServer):
    allow_reuse_address = True


def load_env_file(path: Path = ROOT / ".env", override: bool = True) -> None:
    if not path.is_file():
        return

    with path.open(encoding="utf-8") as env_file:
        for line in env_file:
            text = line.strip()
            if not text or text.startswith("#") or "=" not in text:
                continue
            if text.startswith("export "):
                text = text.removeprefix("export ").strip()

            key, value = text.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]

            if override or key not in os.environ:
                os.environ[key] = value


def now_iso() -> str:
    return now_utc().isoformat(timespec="seconds")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def verification_expires_at() -> str:
    return (now_utc() + timedelta(minutes=VERIFICATION_TTL_MINUTES)).isoformat(
        timespec="seconds"
    )


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                display_name TEXT NOT NULL,
                username TEXT,
                email TEXT,
                email_verified INTEGER NOT NULL DEFAULT 0,
                password_salt TEXT,
                password_hash TEXT,
                verification_salt TEXT,
                verification_hash TEXT,
                verification_expires_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                restaurant TEXT NOT NULL,
                dish TEXT NOT NULL,
                cuisine TEXT,
                rating REAL NOT NULL CHECK (rating >= 0 AND rating <= 10),
                comments TEXT,
                would_buy_again INTEGER NOT NULL CHECK (would_buy_again IN (0, 1)),
                price REAL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );
            """
        )
        migrate_users_display_name_not_unique(conn)
        migrate_entries_rating(conn)
        ensure_column(conn, "entries", "cuisine", "TEXT")
        ensure_column(conn, "entries", "price", "REAL")
        ensure_column(conn, "users", "username", "TEXT")
        ensure_column(conn, "users", "email", "TEXT")
        ensure_column(conn, "users", "email_verified", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "users", "password_salt", "TEXT")
        ensure_column(conn, "users", "password_hash", "TEXT")
        ensure_column(conn, "users", "verification_salt", "TEXT")
        ensure_column(conn, "users", "verification_hash", "TEXT")
        ensure_column(conn, "users", "verification_expires_at", "TEXT")
        for row in conn.execute("SELECT id, display_name FROM users WHERE email IS NULL"):
            possible_email = row["display_name"].strip().lower()
            if EMAIL_PATTERN.match(possible_email):
                conn.execute(
                    "UPDATE users SET email = ?, email_verified = 0 WHERE id = ?",
                    (possible_email, row["id"]),
                )
        backfill_usernames(conn)
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
            ON users(email)
            WHERE email IS NOT NULL
            """
        )
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
            ON users(username)
            WHERE username IS NOT NULL
            """
        )


def migrate_entries_rating(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entries'"
    ).fetchone()
    if row is None or "rating >= 0 AND rating <= 10" in row["sql"]:
        return

    conn.executescript(
        """
        ALTER TABLE entries RENAME TO entries_old;

        CREATE TABLE entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            restaurant TEXT NOT NULL,
            dish TEXT NOT NULL,
            cuisine TEXT,
            rating REAL NOT NULL CHECK (rating >= 0 AND rating <= 10),
            comments TEXT,
            would_buy_again INTEGER NOT NULL CHECK (would_buy_again IN (0, 1)),
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        );

        INSERT INTO entries (
            id,
            user_id,
            restaurant,
            dish,
            cuisine,
            rating,
            comments,
            would_buy_again,
            created_at
        )
        SELECT
            id,
            user_id,
            restaurant,
            dish,
            NULL,
            CASE
                WHEN rating <= 5 THEN rating * 2.0
                ELSE rating
            END,
            comments,
            would_buy_again,
            created_at
        FROM entries_old;

        DROP TABLE entries_old;
        """
    )


def migrate_users_display_name_not_unique(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
    ).fetchone()
    if row is None or "display_name TEXT NOT NULL UNIQUE" not in row["sql"]:
        return

    columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(users)")
    }
    target_columns = (
        "id",
        "display_name",
        "username",
        "email",
        "email_verified",
        "password_salt",
        "password_hash",
        "verification_salt",
        "verification_hash",
        "verification_expires_at",
        "created_at",
    )
    defaults = {
        "username": "NULL",
        "email": "NULL",
        "email_verified": "0",
        "password_salt": "NULL",
        "password_hash": "NULL",
        "verification_salt": "NULL",
        "verification_hash": "NULL",
        "verification_expires_at": "NULL",
        "created_at": f"'{now_iso()}'",
    }
    select_columns = [
        column if column in columns else defaults[column]
        for column in target_columns
    ]

    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("DROP TABLE IF EXISTS users_new")
    conn.execute(
        """
        CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_name TEXT NOT NULL,
            username TEXT,
            email TEXT,
            email_verified INTEGER NOT NULL DEFAULT 0,
            password_salt TEXT,
            password_hash TEXT,
            verification_salt TEXT,
            verification_hash TEXT,
            verification_expires_at TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        f"""
        INSERT INTO users_new ({", ".join(target_columns)})
        SELECT {", ".join(select_columns)}
        FROM users
        """
    )
    conn.execute("DROP TABLE users")
    conn.execute("ALTER TABLE users_new RENAME TO users")
    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def backfill_usernames(conn: sqlite3.Connection) -> None:
    existing = {
        row["username"]
        for row in conn.execute("SELECT username FROM users WHERE username IS NOT NULL")
        if row["username"]
    }
    rows = conn.execute(
        """
        SELECT id, display_name, email, username
        FROM users
        WHERE username IS NULL OR trim(username) = ''
        """
    ).fetchall()

    for row in rows:
        seed = row["email"] or row["display_name"] or f"user_{row['id']}"
        base = username_seed(seed)
        username = unique_username(base, existing, row["id"])
        conn.execute("UPDATE users SET username = ? WHERE id = ?", (username, row["id"]))
        existing.add(username)


def username_seed(value: str) -> str:
    seed = value.split("@", 1)[0].lower()
    seed = re.sub(r"[^a-z0-9_]+", "_", seed).strip("_")
    if len(seed) < 3:
        seed = "user"
    return seed[:24].strip("_") or "user"


def unique_username(base: str, existing: set[str], user_id: int) -> str:
    if base not in existing:
        return base

    suffix = f"_{user_id}"
    candidate = f"{base[: 24 - len(suffix)]}{suffix}"
    if candidate not in existing:
        return candidate

    counter = 2
    while True:
        suffix = f"_{user_id}_{counter}"
        candidate = f"{base[: 24 - len(suffix)]}{suffix}"
        if candidate not in existing:
            return candidate
        counter += 1


def hash_password(password: str, salt: str) -> str:
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PASSWORD_ITERATIONS,
    )
    return digest.hex()


def new_password_hash(password: str) -> tuple[str, str]:
    salt = secrets.token_hex(16)
    return salt, hash_password(password, salt)


def new_verification_code() -> tuple[str, str, str]:
    code = f"{secrets.randbelow(1_000_000):06d}"
    salt = secrets.token_hex(16)
    return code, salt, hash_password(code, salt)


def password_matches(password: str, salt: str, stored_hash: str) -> bool:
    candidate = hash_password(password, salt)
    return hmac.compare_digest(candidate, stored_hash)


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
        (token, user_id, now_iso()),
    )
    return token


def send_verification_email(email: str, code: str) -> str:
    smtp_host = os.environ.get("SMTP_HOST", "").strip()
    if not smtp_host:
        print(f"[VFA Diaries] Verification code for {email}: {code}", flush=True)
        return "terminal"

    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USERNAME", "").strip()
    smtp_password = os.environ.get("SMTP_PASSWORD", "")
    smtp_from = os.environ.get("SMTP_FROM", smtp_user or "no-reply@vfa-diaries.local")
    use_ssl = os.environ.get("SMTP_SSL", "").lower() in {"1", "true", "yes"}
    use_starttls = os.environ.get("SMTP_STARTTLS", "true").lower() not in {
        "0",
        "false",
        "no",
    }

    message = EmailMessage()
    message["Subject"] = "Your VFA Diaries verification code"
    message["From"] = smtp_from
    message["To"] = email
    message.set_content(
        f"Your VFA Diaries verification code is {code}.\n\n"
        f"It expires in {VERIFICATION_TTL_MINUTES} minutes."
    )

    smtp_class = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
    with smtp_class(smtp_host, smtp_port, timeout=15) as smtp:
        if not use_ssl and use_starttls:
            smtp.starttls()
        if smtp_user:
            smtp.login(smtp_user, smtp_password)
        smtp.send_message(message)

    return "email"


def public_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "displayName": row["display_name"],
        "username": row["username"],
        "email": row["email"],
        "emailVerified": bool(row["email_verified"]),
        "createdAt": row["created_at"],
    }


def row_to_entry(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "displayName": row["display_name"],
        "restaurant": row["restaurant"],
        "dish": row["dish"],
        "cuisine": row["cuisine"] or "",
        "rating": float(row["rating"]),
        "comments": row["comments"] or "",
        "wouldBuyAgain": bool(row["would_buy_again"]),
        "price": float(row["price"]) if row["price"] else None,
        "createdAt": row["created_at"],
    }


class VfaHandler(BaseHTTPRequestHandler):
    server_version = "VFADiaries/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/me":
            self.current_user()
            return
        if parsed.path == "/api/entries":
            self.list_entries(parsed.query)
            return

        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/auth/register":
            self.register_user()
            return
        if parsed.path == "/api/auth/login":
            self.login_user()
            return
        if parsed.path == "/api/auth/verify":
            self.verify_email()
            return
        if parsed.path == "/api/auth/resend":
            self.resend_verification()
            return
        if parsed.path == "/api/auth/logout":
            self.logout_user()
            return
        if parsed.path == "/api/entries":
            self.save_entry()
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/entries/"):
            self.delete_entry(parsed.path)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def current_user(self) -> None:
        user = self.require_user()
        if user is None:
            return

        self.send_json({"user": public_user(user)})

    def list_entries(self, query: str) -> None:
        user = self.require_user()
        if user is None:
            return

        sql = """
            SELECT
                entries.id,
                entries.user_id,
                users.display_name,
                entries.restaurant,
                entries.dish,
                entries.cuisine,
                entries.rating,
                entries.comments,
                entries.would_buy_again,
                entries.price,
                entries.created_at
            FROM entries
            JOIN users ON users.id = entries.user_id
            WHERE entries.user_id = ?
        """
        sql += " ORDER BY datetime(entries.created_at) DESC, entries.id DESC"

        with db() as conn:
            rows = conn.execute(sql, (user["id"],)).fetchall()

        self.send_json({"entries": [row_to_entry(row) for row in rows]})

    def register_user(self) -> None:
        try:
            payload = self.read_json()
            display_name = self.clean_text(payload.get("displayName"), 80)
            username = self.clean_username(payload.get("username"))
            email = self.clean_email(payload.get("email"))
            password = self.clean_password(payload.get("password"))
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        if len(display_name) < 2:
            self.send_json({"error": "Name must be at least 2 characters."}, HTTPStatus.BAD_REQUEST)
            return
        if len(password) < 4:
            self.send_json({"error": "Password must be at least 4 characters."}, HTTPStatus.BAD_REQUEST)
            return

        with db() as conn:
            existing_by_email = conn.execute(
                """
                SELECT id, display_name, username, email, email_verified, password_hash, created_at
                FROM users
                WHERE email = ?
                """,
                (email,),
            ).fetchone()
            existing_by_username = conn.execute(
                """
                SELECT id, display_name, username, email, email_verified, password_hash, created_at
                FROM users
                WHERE username = ?
                """,
                (username,),
            ).fetchone()

            if (
                existing_by_username is not None
                and (
                    existing_by_email is None
                    or existing_by_username["id"] != existing_by_email["id"]
                )
            ):
                self.send_json({"error": "That username is already taken."}, HTTPStatus.CONFLICT)
                return
            if existing_by_email is not None and existing_by_email["email_verified"]:
                self.send_json({"error": "That email already has an account."}, HTTPStatus.CONFLICT)
                return

            salt, password_hash = new_password_hash(password)
            code, code_salt, code_hash = new_verification_code()

            if existing_by_email is None:
                cursor = conn.execute(
                    """
                    INSERT INTO users (
                        display_name,
                        username,
                        email,
                        email_verified,
                        password_salt,
                        password_hash,
                        verification_salt,
                        verification_hash,
                        verification_expires_at,
                        created_at
                    )
                    VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        display_name,
                        username,
                        email,
                        salt,
                        password_hash,
                        code_salt,
                        code_hash,
                        verification_expires_at(),
                        now_iso(),
                    ),
                )
                user_id = cursor.lastrowid
            else:
                user_id = existing_by_email["id"]
                conn.execute(
                    """
                    UPDATE users
                    SET display_name = ?,
                        username = ?,
                        password_salt = ?,
                        password_hash = ?,
                        verification_salt = ?,
                        verification_hash = ?,
                        verification_expires_at = ?,
                        email_verified = 0
                    WHERE id = ?
                    """,
                    (
                        display_name,
                        username,
                        salt,
                        password_hash,
                        code_salt,
                        code_hash,
                        verification_expires_at(),
                        user_id,
                    ),
                )

            user = conn.execute(
                "SELECT id, display_name, username, email, email_verified, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()

        try:
            delivery_mode = send_verification_email(email, code)
        except smtplib.SMTPAuthenticationError:
            self.send_json(
                {
                    "error": (
                        "Gmail rejected the SMTP login. Use a Gmail App Password "
                        "in SMTP_PASSWORD, not your normal Gmail password."
                    )
                },
                HTTPStatus.BAD_GATEWAY,
            )
            return
        except (OSError, smtplib.SMTPException) as exc:
            self.send_json(
                {"error": f"Could not send verification email: {exc}"},
                HTTPStatus.BAD_GATEWAY,
            )
            return

        self.send_json(
            {
                "needsVerification": True,
                "deliveryMode": delivery_mode,
                "email": email,
                "user": public_user(user),
            },
            HTTPStatus.CREATED,
        )

    def login_user(self) -> None:
        try:
            payload = self.read_json()
            email = self.clean_email(payload.get("email"))
            password = self.clean_password(payload.get("password"))
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        with db() as conn:
            user = conn.execute(
                """
                SELECT
                    id,
                    display_name,
                    username,
                    email,
                    email_verified,
                    password_salt,
                    password_hash,
                    created_at
                FROM users
                WHERE email = ?
                """,
                (email,),
            ).fetchone()
            if (
                user is None
                or not user["password_salt"]
                or not user["password_hash"]
                or not password_matches(password, user["password_salt"], user["password_hash"])
            ):
                self.send_json({"error": "Email or password was wrong."}, HTTPStatus.UNAUTHORIZED)
                return
            if not user["email_verified"]:
                self.send_json(
                    {
                        "error": "Verify your email before logging in.",
                        "needsVerification": True,
                        "email": email,
                    },
                    HTTPStatus.FORBIDDEN,
                )
                return

            token = create_session(conn, user["id"])

        self.send_json({"token": token, "user": public_user(user)})

    def verify_email(self) -> None:
        try:
            payload = self.read_json()
            email = self.clean_email(payload.get("email"))
            code = self.clean_code(payload.get("code"))
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        with db() as conn:
            user = conn.execute(
                """
                SELECT
                    id,
                    display_name,
                    username,
                    email,
                    email_verified,
                    password_salt,
                    password_hash,
                    verification_salt,
                    verification_hash,
                    verification_expires_at,
                    created_at
                FROM users
                WHERE email = ?
                """,
                (email,),
            ).fetchone()

            if user is None:
                self.send_json({"error": "Verification code was wrong."}, HTTPStatus.BAD_REQUEST)
                return
            if user["email_verified"]:
                token = create_session(conn, user["id"])
                self.send_json({"token": token, "user": public_user(user)})
                return
            if (
                not user["verification_salt"]
                or not user["verification_hash"]
                or not user["verification_expires_at"]
            ):
                self.send_json({"error": "Request a new verification code."}, HTTPStatus.BAD_REQUEST)
                return

            expires_at = datetime.fromisoformat(user["verification_expires_at"])
            if expires_at < now_utc():
                self.send_json({"error": "Verification code expired."}, HTTPStatus.BAD_REQUEST)
                return

            if not password_matches(code, user["verification_salt"], user["verification_hash"]):
                self.send_json({"error": "Verification code was wrong."}, HTTPStatus.BAD_REQUEST)
                return

            conn.execute(
                """
                UPDATE users
                SET email_verified = 1,
                    verification_salt = NULL,
                    verification_hash = NULL,
                    verification_expires_at = NULL
                WHERE id = ?
                """,
                (user["id"],),
            )
            verified_user = conn.execute(
                "SELECT id, display_name, username, email, email_verified, created_at FROM users WHERE id = ?",
                (user["id"],),
            ).fetchone()
            token = create_session(conn, user["id"])

        self.send_json({"token": token, "user": public_user(verified_user)})

    def resend_verification(self) -> None:
        try:
            payload = self.read_json()
            email = self.clean_email(payload.get("email"))
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        with db() as conn:
            user = conn.execute(
                """
                SELECT id, display_name, username, email, email_verified, created_at
                FROM users
                WHERE email = ?
                """,
                (email,),
            ).fetchone()
            if user is None or user["email_verified"]:
                self.send_json({"ok": True})
                return

            code, code_salt, code_hash = new_verification_code()
            conn.execute(
                """
                UPDATE users
                SET verification_salt = ?,
                    verification_hash = ?,
                    verification_expires_at = ?
                WHERE id = ?
                """,
                (code_salt, code_hash, verification_expires_at(), user["id"]),
            )

        try:
            delivery_mode = send_verification_email(email, code)
        except smtplib.SMTPAuthenticationError:
            self.send_json(
                {
                    "error": (
                        "Gmail rejected the SMTP login. Use a Gmail App Password "
                        "in SMTP_PASSWORD, not your normal Gmail password."
                    )
                },
                HTTPStatus.BAD_GATEWAY,
            )
            return
        except (OSError, smtplib.SMTPException) as exc:
            self.send_json(
                {"error": f"Could not send verification email: {exc}"},
                HTTPStatus.BAD_GATEWAY,
            )
            return

        self.send_json({"ok": True, "deliveryMode": delivery_mode, "email": email})

    def logout_user(self) -> None:
        token = self.auth_token()
        if token:
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))

        self.send_json({"ok": True})

    def save_entry(self) -> None:
        user = self.require_user()
        if user is None:
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.send_json(
                {"error": "Entries must be submitted as multipart form data."},
                HTTPStatus.BAD_REQUEST,
            )
            return

        try:
            form = self.read_multipart_form(content_type)
            restaurant = self.clean_text(self.form_value(form, "restaurant"), 120)
            dish = self.clean_text(self.form_value(form, "dish"), 120)
            cuisine = self.clean_text(self.form_value(form, "cuisine"), 80)
            rating = self.clean_rating(self.form_value(form, "rating"))
            comments = self.clean_text(self.form_value(form, "comments"), 600)
            would_buy_again = self.form_value(form, "wouldBuyAgain") == "true"
            price_str = self.form_value(form, "price").strip()
            price = float(price_str) if price_str else None
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        if not restaurant:
            self.send_json({"error": "Restaurant is required."}, HTTPStatus.BAD_REQUEST)
            return
        if not dish:
            self.send_json({"error": "Dish is required."}, HTTPStatus.BAD_REQUEST)
            return

        with db() as conn:
            cursor = conn.execute(
                """
                INSERT INTO entries (
                    user_id,
                    restaurant,
                    dish,
                    cuisine,
                    rating,
                    comments,
                    would_buy_again,
                    price,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user["id"],
                    restaurant,
                    dish,
                    cuisine,
                    rating,
                    comments,
                    int(would_buy_again),
                    price,
                    now_iso(),
                ),
            )
            row = conn.execute(
                """
                SELECT
                    entries.id,
                    entries.user_id,
                    users.display_name,
                    entries.restaurant,
                    entries.dish,
                    entries.cuisine,
                    entries.rating,
                    entries.comments,
                    entries.would_buy_again,
                    entries.price,
                    entries.created_at
                FROM entries
                JOIN users ON users.id = entries.user_id
                WHERE entries.id = ?
                """,
                (cursor.lastrowid,),
            ).fetchone()

        self.send_json({"entry": row_to_entry(row)}, HTTPStatus.CREATED)

    def delete_entry(self, path: str) -> None:
        user = self.require_user()
        if user is None:
            return

        entry_id_text = path.removeprefix("/api/entries/")
        if not entry_id_text.isdigit():
            self.send_json({"error": "Entry id is invalid."}, HTTPStatus.BAD_REQUEST)
            return

        entry_id = int(entry_id_text)
        with db() as conn:
            row = conn.execute(
                "SELECT id FROM entries WHERE id = ? AND user_id = ?",
                (entry_id, user["id"]),
            ).fetchone()
            if row is None:
                self.send_json({"error": "Entry was not found."}, HTTPStatus.NOT_FOUND)
                return
            conn.execute("DELETE FROM entries WHERE id = ? AND user_id = ?", (entry_id, user["id"]))

        self.send_json({"ok": True})

    def read_multipart_form(self, content_type: str) -> FormData:
        content_length = self.clean_int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return {}
        if content_length > MAX_REQUEST_BYTES:
            raise ValueError("Upload request is too large.")

        body = self.rfile.read(content_length)
        raw_message = (
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
            + body
        )
        message = BytesParser(policy=policy.default).parsebytes(raw_message)
        if not message.is_multipart():
            raise ValueError("Upload form was invalid.")

        form: FormData = {}
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue

            payload = part.get_payload(decode=True) or b""
            if part.get_filename():
                continue

            charset = part.get_content_charset() or "utf-8"
            form[name] = payload.decode(charset, errors="replace")

        return form

    def serve_static(self, path: str) -> None:
        if path == "/":
            path = "/index.html"

        requested = (ROOT / path.lstrip("/")).resolve()
        if ROOT not in requested.parents and requested != ROOT:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not requested.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type = STATIC_TYPES.get(requested.suffix.lower(), "application/octet-stream")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(requested.stat().st_size))
        self.end_headers()
        with requested.open("rb") as source:
            shutil.copyfileobj(source, self.wfile)

    def read_json(self) -> dict:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length)
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError as exc:
            raise ValueError("Request body must be valid JSON.") from exc
        if not isinstance(data, dict):
            raise ValueError("Request body must be a JSON object.")
        return data

    def form_value(self, form: FormData, name: str) -> str:
        value = form.get(name, "")
        return "" if value is None else str(value)

    def clean_text(self, value: object, max_length: int) -> str:
        text = "" if value is None else str(value)
        return " ".join(text.strip().split())[:max_length]

    def clean_password(self, value: object) -> str:
        return "" if value is None else str(value)

    def clean_email(self, value: object) -> str:
        email = "" if value is None else str(value).strip().lower()
        if not EMAIL_PATTERN.match(email):
            raise ValueError("A valid email is required.")
        return email[:254]

    def clean_username(self, value: object) -> str:
        username = "" if value is None else str(value).strip().lower()
        username = username.removeprefix("@")
        if not USERNAME_PATTERN.match(username):
            raise ValueError(
                "Username must be 3-24 characters using letters, numbers, and underscores."
            )
        return username

    def clean_code(self, value: object) -> str:
        code = "" if value is None else str(value).strip()
        if not re.fullmatch(r"\d{6}", code):
            raise ValueError("Enter the 6-digit verification code.")
        return code

    def clean_int(self, value: object) -> int:
        text = "" if value is None else str(value).strip()
        if not text:
            return 0
        if not text.isdigit():
            raise ValueError("A number field was invalid.")
        return int(text)

    def clean_rating(self, value: object) -> float:
        text = "" if value is None else str(value).strip()
        try:
            rating = float(text)
        except ValueError as exc:
            raise ValueError("Rating was invalid.") from exc

        if rating < 0 or rating > 10:
            raise ValueError("Rating must be between 0 and 10.")

        return round(rating, 2)

    def auth_token(self) -> str:
        authorization = self.headers.get("Authorization", "")
        if authorization.startswith("Bearer "):
            return authorization.removeprefix("Bearer ").strip()
        return self.headers.get("X-Auth-Token", "").strip()

    def require_user(self) -> sqlite3.Row | None:
        token = self.auth_token()
        if not token:
            self.send_json({"error": "Please log in first."}, HTTPStatus.UNAUTHORIZED)
            return None

        with db() as conn:
            user = conn.execute(
                """
                SELECT
                    users.id,
                    users.display_name,
                    users.username,
                    users.email,
                    users.email_verified,
                    users.created_at
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token = ?
                """,
                (token,),
            ).fetchone()

        if user is None:
            self.send_json({"error": "Please log in again."}, HTTPStatus.UNAUTHORIZED)
            return None
        if not user["email_verified"]:
            self.send_json(
                {
                    "error": "Verify your email first.",
                    "needsVerification": True,
                    "email": user["email"],
                },
                HTTPStatus.FORBIDDEN,
            )
            return None

        return user

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run() -> None:
    load_env_file()
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "127.0.0.1").strip() or "127.0.0.1"
    try:
        server = VfaServer((host, port), VfaHandler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            raise SystemExit(
                f"Port {port} is already in use. Stop the other server with Ctrl+C, "
                f"or run this one on another port: PORT={port + 1} python3 server.py"
            )
        raise

    display_host = "127.0.0.1" if host == "0.0.0.0" else host
    print(f"VFA Diaries running at http://{display_host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nVFA Diaries stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
