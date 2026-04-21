#!/usr/bin/env python3
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server


DB_PATH = ROOT / "vfa_diaries.sqlite3"
TEST_USER = {
    "display_name": "Mia Chen",
    "username": "mia_foodie",
    "email": "mia.chen.test@vfadiaries.local",
    "password": "FriendPass123",
}
TEST_ENTRY = {
    "restaurant": "Night Market Kitchen",
    "suburb": "Newtown",
    "dish": "Chili dumplings",
    "cuisine": "Chinese",
    "rating": 9.1,
    "comments": "Good heat, soft wrappers, absolutely worth reordering.",
    "would_buy_again": 1,
    "price": 16.5,
    "visibility": "public",
}


def main() -> None:
    server.load_env_file()
    server.init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        user = conn.execute(
            "SELECT id, username FROM users WHERE username = ?",
            (TEST_USER["username"],),
        ).fetchone()

        if user is None:
            salt, password_hash = server.new_password_hash(TEST_USER["password"])
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
                VALUES (?, ?, ?, 1, ?, ?, NULL, NULL, NULL, ?)
                """,
                (
                    TEST_USER["display_name"],
                    TEST_USER["username"],
                    TEST_USER["email"],
                    salt,
                    password_hash,
                    server.now_iso(),
                ),
            )
            user_id = int(cursor.lastrowid)
        else:
            user_id = int(user["id"])

        verified_users = conn.execute(
            """
            SELECT id
            FROM users
            WHERE email_verified = 1 AND id != ?
            """,
            (user_id,),
        ).fetchall()

        connected_at = server.now_iso()
        for row in verified_users:
            other_user_id = int(row["id"])
            for follower_id, following_id in (
                (user_id, other_user_id),
                (other_user_id, user_id),
            ):
                conn.execute(
                    """
                    INSERT INTO follows (
                        follower_id,
                        following_id,
                        status,
                        created_at,
                        responded_at
                    )
                    VALUES (?, ?, 'accepted', ?, ?)
                    ON CONFLICT(follower_id, following_id)
                    DO UPDATE SET
                        status = 'accepted',
                        responded_at = excluded.responded_at
                    """,
                    (follower_id, following_id, connected_at, connected_at),
                )

        has_entry = conn.execute(
            "SELECT 1 FROM entries WHERE user_id = ? AND dish = ?",
            (user_id, TEST_ENTRY["dish"]),
        ).fetchone()
        if has_entry is None:
            conn.execute(
                """
                INSERT INTO entries (
                    user_id,
                    restaurant,
                    suburb,
                    dish,
                    cuisine,
                    rating,
                    comments,
                    would_buy_again,
                    price,
                    visibility,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    TEST_ENTRY["restaurant"],
                    TEST_ENTRY["suburb"],
                    TEST_ENTRY["dish"],
                    TEST_ENTRY["cuisine"],
                    TEST_ENTRY["rating"],
                    TEST_ENTRY["comments"],
                    TEST_ENTRY["would_buy_again"],
                    TEST_ENTRY["price"],
                    TEST_ENTRY["visibility"],
                    server.now_iso(),
                ),
            )

        conn.commit()
        print(f"Seeded test friend @{TEST_USER['username']}")
        print(f"Email: {TEST_USER['email']}")
        print(f"Password: {TEST_USER['password']}")
        print(f"Connected to {len(verified_users)} verified user(s).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
