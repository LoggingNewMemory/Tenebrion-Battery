#!/system/bin/sh
MODDIR=${0%/*}

# 1. Kill any existing instances to prevent port collisions
killall busybox httpd 2>/dev/null

# 2. Start the lightweight web server pointing to our webroot
busybox httpd -p 8080 -h "$MODDIR/webroot"

# 3. Launch the Android web browser directly to the dashboard
am start -a android.intent.action.VIEW -d "http://127.0.0.1:8080" >/dev/null 2>&1

exit 0