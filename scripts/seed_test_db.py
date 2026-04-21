#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server


def ensure_user(conn: sqlite3.Connection, display_name: str, username: str, email: str, password: str) -> int:
    existing = conn.execute(
        "SELECT id FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    salt, password_hash = server.new_password_hash(password)

    if existing is None:
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
            (display_name, username, email, salt, password_hash, server.now_iso()),
        )
        return int(cursor.lastrowid)

    user_id = int(existing["id"])
    conn.execute(
        """
        UPDATE users
        SET display_name = ?,
            email = ?,
            email_verified = 1,
            password_salt = ?,
            password_hash = ?
        WHERE id = ?
        """,
        (display_name, email, salt, password_hash, user_id),
    )
    return user_id


def ensure_follow(conn: sqlite3.Connection, follower_id: int, following_id: int) -> None:
    connected_at = server.now_iso()
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


def ensure_entry(
    conn: sqlite3.Connection,
    user_id: int,
    restaurant: str,
    suburb: str,
    dish: str,
    cuisine: str,
    rating: float,
    comments: str,
    would_buy_again: int,
    price: float,
    visibility: str,
) -> None:
    existing = conn.execute(
        "SELECT id FROM entries WHERE user_id = ? AND restaurant = ? AND dish = ?",
        (user_id, restaurant, dish),
    ).fetchone()
    if existing is not None:
        return

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
            restaurant,
            suburb,
            dish,
            cuisine,
            rating,
            comments,
            would_buy_again,
            price,
            visibility,
            server.now_iso(),
        ),
    )


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: seed_test_db.py <db-path>")

    db_path = Path(sys.argv[1]).resolve()
    os.environ["DATABASE_PATH"] = str(db_path)
    server.init_db()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        owner_id = ensure_user(
            conn,
            "Owner Tester",
            "owner_test",
            "owner@test.local",
            "OwnerPass123",
        )
        friend_id = ensure_user(
            conn,
            "Friend Tester",
            "friend_test",
            "friend@test.local",
            "FriendPass123",
        )
        sasha_id = ensure_user(
            conn,
            "Sasha Pending",
            "sasha_pending",
            "sasha@test.local",
            "SashaPass123",
        )

        ensure_follow(conn, owner_id, friend_id)
        ensure_follow(conn, friend_id, owner_id)

        ensure_entry(
            conn,
            friend_id,
            "Corner Grill",
            "Surry Hills",
            "Steak frites",
            "French",
            8.7,
            "Sharp sauce, crispy fries, easy recommend.",
            1,
            29.0,
            "public",
        )
        ensure_entry(
            conn,
            friend_id,
            "After Hours Ramen",
            "CBD",
            "Black garlic ramen",
            "Japanese",
            9.3,
            "Rich broth and the noodles still had bite.",
            1,
            21.0,
            "friends_only",
        )

        conn.commit()
    finally:
        conn.close()

    print(
        json.dumps(
            {
                "owner": {"email": "owner@test.local", "password": "OwnerPass123"},
                "friend": {"email": "friend@test.local", "password": "FriendPass123"},
                "sasha": {"email": "sasha@test.local", "password": "SashaPass123"},
            }
        )
    )


if __name__ == "__main__":
    main()
