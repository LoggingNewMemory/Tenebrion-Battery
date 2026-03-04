# Set variables
LATESTARTSERVICE=true

ui_print "------------------------------------"
ui_print "          TENEBRION BATTERY         "
ui_print "------------------------------------"
ui_print "         By: Kanagawa Yamada        "
ui_print "------------------------------------"
ui_print " "
sleep 0.5

ui_print "------------------------------------"
ui_print "            DEVICE INFO             "
ui_print "------------------------------------"
ui_print "DEVICE : $(getprop ro.build.product) "
ui_print "MODEL : $(getprop ro.product.model) "
ui_print "MANUFACTURE : $(getprop ro.product.system.manufacturer) "
ui_print "PROC : $(getprop ro.product.board) "
ui_print "CPU : $(getprop ro.hardware) "
ui_print "ANDROID VER : $(getprop ro.build.version.release) "
ui_print "KERNEL : $(uname -r) "
ui_print "RAM : $(free | grep Mem |  awk '{print $2}') "
ui_print " "
sleep 0.5

ui_print "------------------------------------"
ui_print "           INSTALLATION             "
ui_print "------------------------------------"

# 1. Setup Persistent Config Environment
ui_print "- Creating Tenebrion Config Environment..."
mkdir -p /data/Tenebrion

# 2. Set Binary Permissions (Directly in Module Path)
ui_print "- Setting Native C Binaries permissions..."
chmod -R 755 $MODPATH/Binaries

# 3. Hardware Screen Path Detection
ui_print "- Detecting Optimal Screen State Path..."
COMMON_PATH=0
SECOND_PATH=0
COMPAT_PATH=0

if [ -f "/sys/class/drm/card0-DSI-1/dpms" ]; then
    ui_print "  -> Found Native DRM Path"
    COMMON_PATH=1
elif [ -f "/sys/class/leds/lcd-backlight/brightness" ]; then
    ui_print "  -> Found Backlight Path"
    SECOND_PATH=1
else
    ui_print "  -> Using CMD Compatibility"
    COMPAT_PATH=1
fi

# 4. Handle Configuration File
CONFIG_FILE="/data/Tenebrion/tenebrion.txt"

# Copy base template and apply detected hardware paths ONLY on Fresh Install
if [ ! -f "$CONFIG_FILE" ]; then
    ui_print "- Deploying base configuration..."
    cp -f $MODPATH/tenebrion.txt $CONFIG_FILE
    
    # Write the detected hardware paths to the new config
    sed -i "s/^TENEBRION_COMMON_PATH=.*/TENEBRION_COMMON_PATH=$COMMON_PATH/" $CONFIG_FILE
    sed -i "s/^TENEBRION_SECOND_PATH=.*/TENEBRION_SECOND_PATH=$SECOND_PATH/" $CONFIG_FILE
    sed -i "s/^TENEBRION_COMPABILITY=.*/TENEBRION_COMPABILITY=$COMPAT_PATH/" $CONFIG_FILE
else
    ui_print "- Existing configuration found. SKIPPING"
fi

ui_print " "
sleep 0.5
ui_print "      Install Done. That's it       "