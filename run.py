#!/usr/bin/env python3
"""Load environment variables from .env and start the VFA Diaries server."""

import os
import sys
from pathlib import Path

def load_env_file():
    """Load variables from .env file if it exists."""
    env_path = Path(__file__).parent / ".env"
    
    if not env_path.exists():
        print("No .env file found. Email verification codes will print to terminal.")
        print("See EMAIL_SETUP.md for real Gmail verification setup.")
        return
    
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            # Skip empty lines and comments
            if not line or line.startswith("#"):
                continue
            # Parse KEY=VALUE
            if "=" in line:
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if key and value:
                    os.environ[key] = value
                    print(f"Loaded {key}")

if __name__ == "__main__":
    print("VFA Diaries Server")
    print("=" * 40)
    
    load_env_file()
    
    print("=" * 40)
    print()
    
    # Import and run the server
    import server
    server.run()
