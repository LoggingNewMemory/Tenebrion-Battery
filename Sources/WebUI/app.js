// === 1. KERNELSU EXECUTION ENGINE ===
function execRoot(command) {
    return new Promise((resolve) => {
        if (typeof ksu === 'undefined' || !ksu.exec) {
            console.warn("KSU API not available.");
            resolve(""); 
            return;
        }
        
        const cbName = `exec_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        
        window[cbName] = (errno, stdout, stderr) => {
            delete window[cbName];
            if (errno !== 0) {
                console.error("KSU Exec Error:", stderr);
                resolve(""); 
                return;
            }
            resolve(stdout.trim());
        };
        
        try {
            ksu.exec(command, "{}", cbName);
        } catch (err) {
            delete window[cbName];
            resolve("");
        }
    });
}

// === 2. DOM LOAD & SETUP ===
document.addEventListener('DOMContentLoaded', () => {

    const btnRestart = document.getElementById('btn-restart');
    const toggleHalf = document.getElementById('toggle-half');
    const toggleForgive = document.getElementById('toggle-forgive');

    let pollingInterval;
    let liveUptimeInterval;
    let currentUptimeSec = 0;

    // Live Uptime Clock Function
    function startLiveUptime() {
        if (liveUptimeInterval) clearInterval(liveUptimeInterval);
        liveUptimeInterval = setInterval(() => {
            currentUptimeSec++;
            let h = Math.floor(currentUptimeSec / 3600);
            let m = Math.floor((currentUptimeSec % 3600) / 60);
            let s = currentUptimeSec % 60;
            document.getElementById('service-uptime').innerText =
                `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }, 1000); 
    }

    btnRestart.addEventListener('click', async () => {
        btnRestart.innerText = "Restarting...";
        btnRestart.style.opacity = "0.5";
        btnRestart.style.pointerEvents = "none";
        
        await execRoot(`
            killall TenebrionDaemon_arm64 2>/dev/null
            /data/adb/modules/TenebrionBattery/Binaries/TenebrionDaemon_arm64 &
        `);
        
        setTimeout(() => {
            btnRestart.innerText = "Restart Tenebrion";
            btnRestart.style.opacity = "1";
            btnRestart.style.pointerEvents = "auto";
            loadMainData(); 
        }, 2000);
    });

    // === 4. DATA FETCHING (MAIN DASHBOARD) ===
    async function loadMainData() {
        const bashPayload = `
        DEVICE=$(getprop ro.product.vendor.model)
        [ -z "$DEVICE" ] && DEVICE=$(getprop ro.product.model)
        
        CAPACITY=$(cat /sys/class/power_supply/battery/charge_full_design 2>/dev/null || cat /sys/class/power_supply/battery/charge_full 2>/dev/null)
        [ -z "$CAPACITY" ] && CAPACITY="5000000"
        
        CURRENT=$(cat /sys/class/power_supply/battery/capacity 2>/dev/null)
        [ -z "$CURRENT" ] && CURRENT="0"
        
        UPTIME_SEC=$(cat /proc/uptime 2>/dev/null | cut -d. -f1)
        [ -z "$UPTIME_SEC" ] && UPTIME_SEC="0"

        if pgrep -f TenebrionDaemon >/dev/null 2>&1; then STATUS="Running"; else STATUS="Stopped"; fi

        if pgrep -i -f "endfield" >/dev/null 2>&1 || pgrep -i -f "raco" >/dev/null 2>&1; then
            ENDFIELD="1"
        else
            ENDFIELD="0"
        fi

        HALF=$(grep "TENEBRION_HALF=" /data/Tenebrion/tenebrion.txt 2>/dev/null | cut -d= -f2)
        FORGIVE=$(grep "TENEBRION_FORGIVE=" /data/Tenebrion/tenebrion.txt 2>/dev/null | cut -d= -f2)
        
        printf '{"device": "%s", "capacity": "%s", "status": "%s", "uptime_sec": "%s", "current_batt": "%s", "half": "%s", "forgive": "%s", "endfield": "%s"}' "$DEVICE" "$CAPACITY" "$STATUS" "$UPTIME_SEC" "$CURRENT" "$HALF" "$FORGIVE" "$ENDFIELD"
        `;

        const responseText = await execRoot(bashPayload);
        if (!responseText) return;

        try {
            const data = JSON.parse(responseText);
            
            document.getElementById('device-model').innerText = data.device || "Unknown";
            document.getElementById('current-battery').innerText = (data.current_batt || "--") + "%";
            
            currentUptimeSec = parseInt(data.uptime_sec) || 0;
            startLiveUptime(); 

            let cap = parseInt(data.capacity) || 5000000;
            if (cap > 100000) cap = Math.floor(cap / 1000);
            else if (cap > 10000) cap = Math.floor(cap / 10);
            if (cap > 0 && cap < 1000) cap = cap * 10; 
            
            document.getElementById('battery-capacity').innerText = cap + " mAh";
            
            const elStatus = document.getElementById('service-status');
            const endfieldWarning = document.getElementById('endfield-warning');

            if (data.status === "Running") {
                elStatus.innerText = "Running";
                elStatus.style.color = "#4CAF50"; 
                endfieldWarning.style.display = "none";
            } else {
                if (data.endfield === "1") {
                    elStatus.innerText = "Blocked";
                    elStatus.style.color = "var(--red-accent)";
                    endfieldWarning.style.display = "flex";
                } else {
                    elStatus.innerText = "Stopped";
                    elStatus.style.color = "var(--text-muted)";
                    endfieldWarning.style.display = "none";
                }
            }
            
            if (document.activeElement !== toggleHalf && document.activeElement !== toggleForgive) {
                toggleHalf.checked = data.half === "1";
                toggleForgive.checked = data.forgive === "1";
            }
        } catch (err) {
            console.error("JSON Parse Error:", err);
        }
    }

    // === 5. SAVING TOGGLES & RESTARTING DAEMON ===
    async function saveToggles() {
        // Disable toggles briefly to prevent spamming the restart command
        toggleHalf.disabled = true;
        toggleForgive.disabled = true;

        const half = toggleHalf.checked ? 1 : 0;
        const forgive = toggleForgive.checked ? 1 : 0;
        
        const cmd = `
        FILE="/data/Tenebrion/tenebrion.txt"
        LOG="/data/Tenebrion/tenebrion.log"
        mkdir -p /data/Tenebrion
        touch $FILE
        
        [ -n "$(tail -c 1 $FILE 2>/dev/null)" ] && echo "" >> $FILE
        
        if grep -q "^TENEBRION_HALF=" $FILE; then
            sed -i "s/^TENEBRION_HALF=.*/TENEBRION_HALF=${half}/" $FILE
        else
            echo "TENEBRION_HALF=${half}" >> $FILE
        fi

        if grep -q "^TENEBRION_FORGIVE=" $FILE; then
            sed -i "s/^TENEBRION_FORGIVE=.*/TENEBRION_FORGIVE=${forgive}/" $FILE
        else
            echo "TENEBRION_FORGIVE=${forgive}" >> $FILE
        fi

        # 1. Log the update intention
        NOW=$(date +'%Y-%m-%d %H:%M:%S')
        echo "[$NOW] Configuration Has Been Updated, Restarting Tenebrion Daemon..." >> $LOG

        # 2. Restart the Daemon directly from WebUI
        killall TenebrionDaemon_arm64 2>/dev/null
        /data/adb/modules/TenebrionBattery/Binaries/TenebrionDaemon_arm64 &

        # 3. Log the success
        NOW=$(date +'%Y-%m-%d %H:%M:%S')
        echo "[$NOW] Restarted Successfully with new configuration" >> $LOG
        `;
        
        await execRoot(cmd);

        // Re-enable toggles and refresh dashboard
        setTimeout(() => {
            toggleHalf.disabled = false;
            toggleForgive.disabled = false;
            loadMainData();
        }, 1000);
    }

    toggleHalf.addEventListener('change', saveToggles);
    toggleForgive.addEventListener('change', saveToggles);

    // === 6. LIVE POLLING ===
    function startPolling() {
        pollingInterval = setInterval(loadMainData, 5000); 
    }

    loadMainData();
    startPolling();
});