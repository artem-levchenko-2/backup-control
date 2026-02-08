#!/bin/sh
# ============================================================
# Backup Control — Docker Entrypoint
# Runs as root to fix permissions, then drops to nextjs user
# ============================================================

# Copy rclone config with proper permissions (if bind-mounted)
if [ -f /etc/rclone/rclone.conf ]; then
  mkdir -p /home/nextjs/.config/rclone
  cp /etc/rclone/rclone.conf /home/nextjs/.config/rclone/rclone.conf
  chown nextjs:nodejs /home/nextjs/.config/rclone/rclone.conf
  chmod 600 /home/nextjs/.config/rclone/rclone.conf
  export RCLONE_CONFIG=/home/nextjs/.config/rclone/rclone.conf
fi

# Ensure data directory is writable by nextjs
chown -R nextjs:nodejs /app/data 2>/dev/null || true

# Drop to non-root user and execute the CMD
exec su-exec nextjs:nodejs "$@"
