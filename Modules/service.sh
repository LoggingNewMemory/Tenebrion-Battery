#!/system/bin/sh
MODDIR=${0%/*}

# Wait until Android fully completes booting
while [ -z "$(getprop sys.boot_completed)" ]; do
    sleep 10
done

# Dirty Fix, Prevent Daemon to run twice -_- [DO NOT REMOVE FOR NOW]
killall TenebrionDaemon_arm64 2>/dev/null

$MODDIR/Binaries/TenebrionDaemon_arm64 &