#!/bin/bash
# Emergency password reset utility.
# Use this if you are locked out of the admin account.
#
# Usage:
#   ./init.sh <email> <new_password>
#
# Example:
#   ./init.sh admin@example.com MyNewP@ssword1
#
# The container must be running: docker compose up -d

set -e

if [ $# -ne 2 ]; then
    echo "Usage: $0 <email> <new_password>"
    exit 1
fi

EMAIL="$1"
NEW_PW="$2"

docker exec ham-shack-navigator-app python3 -c "
import sqlite3, bcrypt, sys
new_pw = sys.argv[1].encode()
email  = sys.argv[2]
hashed = bcrypt.hashpw(new_pw, bcrypt.gensalt()).decode()
conn = sqlite3.connect('/data/shack_weather.db')
cur  = conn.execute('UPDATE users SET hashed_pw = ? WHERE email = ?', (hashed, email))
conn.commit()
conn.close()
if cur.rowcount == 0:
    print(f'No user found with email: {email}')
    sys.exit(1)
print(f'Password updated for {email}.')
" "$NEW_PW" "$EMAIL"
