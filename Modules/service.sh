#!/system/bin/sh
MODDIR=${0%/*}

# Wait until Android fully completes booting
while [ -z "$(getprop sys.boot_completed)" ]; do
    sleep 10
done

# Start the Tenebrion Daemon natively from the module directory
if [ -x "$MODDIR/Binaries/TenebrionDaemon_arm64" ]; then
    $MODDIR/Binaries/TenebrionDaemon_arm64 &
fi