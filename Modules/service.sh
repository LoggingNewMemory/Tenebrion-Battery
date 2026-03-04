#!/system/bin/sh
MODDIR=${0%/*}

# Wait until Android fully completes booting
while [ -z "$(getprop sys.boot_completed)" ]; do
    sleep 10
done

su -c $MODDIR/Binaries/TenebrionDaemon_arm64 &