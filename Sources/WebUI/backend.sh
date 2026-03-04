#!/system/bin/sh
echo "Content-type: application/json"
echo ""

CONFIG="/data/Tenebrion/tenebrion.txt"

# Helper to read query params safely
get_query() {
    echo "$QUERY_STRING" | grep -o "$1=[^&]*" | cut -d= -f2
}

ACTION=$(get_query "action")

if [ "$ACTION" = "status" ]; then
    DEVICE=$(getprop ro.product.model)
    CAPACITY=$(cat /sys/class/power_supply/battery/charge_full_design 2>/dev/null || echo "5000000")
    CAPACITY=$((CAPACITY / 1000))
    
    CURRENT=$(cat /sys/class/power_supply/battery/capacity)
    UPTIME=$(awk '{print int($1/3600)":"int(($1%3600)/60)":"int($1%60)}' /proc/uptime)
    
    if pgrep -f TenebrionDaemon >/dev/null; then
        STATUS="Running"
    else
        STATUS="Stopped"
    fi

    HALF=$(grep "TENEBRION_HALF=" $CONFIG | cut -d= -f2)
    FORGIVE=$(grep "TENEBRION_FORGIVE=" $CONFIG | cut -d= -f2)

    echo "{"
    echo "  \"device\": \"$DEVICE\","
    echo "  \"capacity\": \"$CAPACITY\","
    echo "  \"status\": \"$STATUS\","
    echo "  \"uptime\": \"$UPTIME\","
    echo "  \"current_batt\": \"$CURRENT\","
    echo "  \"half\": \"$HALF\","
    echo "  \"forgive\": \"$FORGIVE\""
    echo "}"

elif [ "$ACTION" = "save_toggles" ]; then
    HALF=$(get_query "half")
    FORGIVE=$(get_query "forgive")
    sed -i "s/^TENEBRION_HALF=.*/TENEBRION_HALF=$HALF/" $CONFIG
    sed -i "s/^TENEBRION_FORGIVE=.*/TENEBRION_FORGIVE=$FORGIVE/" $CONFIG
    echo "{\"success\": true}"

elif [ "$ACTION" = "cpufreq" ]; then
    echo "["
    FIRST=true
    for policy in /sys/devices/system/cpu/cpufreq/policy*; do
        if [ ! -d "$policy" ]; then continue; fi
        
        if [ "$FIRST" = true ]; then FIRST=false; else echo ","; fi
        
        IDX=$(basename $policy | sed 's/policy//')
        NAME="Cluster $IDX"
        if [ "$IDX" = "0" ]; then NAME="Normal Cluster"; fi
        if [ "$IDX" = "4" ] || [ "$IDX" = "6" ]; then NAME="Big Cluster"; fi
        if [ "$IDX" = "7" ]; then NAME="Prime Cluster"; fi

        MIN=$(cat $policy/cpuinfo_min_freq)
        MAX=$(cat $policy/cpuinfo_max_freq)
        MID=$(( (MIN + MAX) / 2 ))
        
        # Calculate MHz for the UI inputs
        MIN_MHZ=$((MIN / 1000))
        MID_MHZ=$((MID / 1000))
        MAX_MHZ=$((MAX / 1000))

        echo "  {"
        echo "    \"name\": \"$NAME\","
        echo "    \"policy_idx\": \"$IDX\","
        echo "    \"min_mhz\": \"$MIN_MHZ\","
        echo "    \"mid_mhz\": \"$MID_MHZ\","
        echo "    \"max_mhz\": \"$MAX_MHZ\""
        echo "  }"
    done
    echo "]"

elif [ "$ACTION" = "save_cpufreq" ]; then
    # Enable the custom frequency flag
    sed -i "s/^TENEBRION_CUST_FREQ=.*/TENEBRION_CUST_FREQ=1/" $CONFIG
    
    # Delete any existing custom frequency constraints from the file
    sed -i '/^TENEBRION_CUST_FREQ_[0-9]*_/d' $CONFIG
    
    # Iterate through active hardware policies and append the incoming overrides
    for policy in /sys/devices/system/cpu/cpufreq/policy*; do
        if [ ! -d "$policy" ]; then continue; fi
        IDX=$(basename $policy | sed 's/policy//')
        
        MIN=$(get_query "p${IDX}_min")
        MID=$(get_query "p${IDX}_mid")
        MAX=$(get_query "p${IDX}_max")
        
        if [ -n "$MIN" ]; then echo "TENEBRION_CUST_FREQ_${IDX}_MIN=$MIN" >> $CONFIG; fi
        if [ -n "$MID" ]; then echo "TENEBRION_CUST_FREQ_${IDX}_MID=$MID" >> $CONFIG; fi
        if [ -n "$MAX" ]; then echo "TENEBRION_CUST_FREQ_${IDX}_MAX=$MAX" >> $CONFIG; fi
    done
    
    echo "{\"success\": true}"
fi