from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

import server


class SocialApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="food-diary-test-")
        self.db_path = Path(self.temp_dir.name) / "test.sqlite3"
        os.environ["DATABASE_PATH"] = str(self.db_path)
        os.environ.pop("DATABASE_URL", None)
        server.init_db()
        self.ids = self._seed_database()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()
        os.environ.pop("DATABASE_PATH", None)

    def test_seeded_social_graph_exposes_counts_friends_and_feed(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            counts = server.social_counts(conn, self.ids["owner"])
            self.assertEqual(counts["followersCount"], 1)
            self.assertEqual(counts["followingCount"], 1)
            self.assertEqual(counts["friendsCount"], 1)

            friends, summary = server.social_follow_list(conn, self.ids["owner"], "friends")
            self.assertEqual(summary["friendsCount"], 1)
            self.assertEqual([user["username"] for user in friends], ["friend_test"])

            feed = server.social_feed_entries(conn, self.ids["owner"])
            self.assertEqual(len(feed), 2)
            self.assertEqual(
                sorted(entry["visibility"] for entry in feed),
                ["friends_only", "public"],
            )

    def test_follow_back_turns_pending_request_into_friendship(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row

            pending = server.apply_follow_action(
                conn,
                self.ids["owner"],
                self.ids["sasha"],
                "follow",
            )
            self.assertEqual(pending["status"], "pending")
            self.assertFalse(pending["isFriend"])

            reciprocal = server.apply_follow_action(
                conn,
                self.ids["sasha"],
                self.ids["owner"],
                "follow",
            )
            self.assertEqual(reciprocal["status"], "accepted")
            self.assertTrue(reciprocal["isFriend"])

            counts = server.social_counts(conn, self.ids["owner"])
            self.assertEqual(counts["followersCount"], 2)
            self.assertEqual(counts["followingCount"], 2)
            self.assertEqual(counts["friendsCount"], 2)

            friends, _ = server.social_follow_list(conn, self.ids["owner"], "friends")
            self.assertEqual(
                sorted(user["username"] for user in friends),
                ["friend_test", "sasha_pending"],
            )

    def _seed_database(self) -> dict[str, int]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")

            owner_id = self._ensure_user(
                conn,
                "Owner Tester",
                "owner_test",
                "owner@test.local",
                "OwnerPass123",
            )
            friend_id = self._ensure_user(
                conn,
                "Friend Tester",
                "friend_test",
                "friend@test.local",
                "FriendPass123",
            )
            sasha_id = self._ensure_user(
                conn,
                "Sasha Pending",
                "sasha_pending",
                "sasha@test.local",
                "SashaPass123",
            )

            self._ensure_follow(conn, owner_id, friend_id)
            self._ensure_follow(conn, friend_id, owner_id)

            self._ensure_entry(
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
            self._ensure_entry(
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

        return {"owner": owner_id, "friend": friend_id, "sasha": sasha_id}

    def _ensure_user(
        self,
        conn: sqlite3.Connection,
        display_name: str,
        username: str,
        email: str,
        password: str,
    ) -> int:
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

    def _ensure_follow(self, conn: sqlite3.Connection, follower_id: int, following_id: int) -> None:
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

    def _ensure_entry(
        self,
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


if __name__ == "__main__":
    unittest.main()
