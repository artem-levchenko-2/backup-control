#!/bin/sh
# ============================================================
# Backup Control — Docker Entrypoint
# Copies rclone config to a writable location (for OAuth
# token refresh) and runs the app as root for full file access.
# ============================================================

# Copy rclone config to writable location (source is :ro bind mount)
if [ -f /etc/rclone/rclone.conf ]; then
  cp /etc/rclone/rclone.conf /tmp/rclone.conf
  export RCLONE_CONFIG=/tmp/rclone.conf
fi

exec "$@"
