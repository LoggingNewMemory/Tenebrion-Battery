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
    const btnCopyLog = document.getElementById('btn-copy-log');
    const btnDeleteLog = document.getElementById('btn-delete-log');

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

    // === 3. LOG MANAGEMENT ACTIONS ===
    btnCopyLog.addEventListener('click', async () => {
        btnCopyLog.innerText = "Copying...";
        btnCopyLog.style.opacity = "0.5";
        btnCopyLog.style.pointerEvents = "none";
        
        // Single copy command
        await execRoot(`cp /data/Tenebrion/tenebrion.log /sdcard/Download/tenebrion.log`);
        
        btnCopyLog.innerText = "Copied!";
        setTimeout(() => {
            btnCopyLog.innerText = "Copy Log";
            btnCopyLog.style.opacity = "1";
            btnCopyLog.style.pointerEvents = "auto";
        }, 2000);
    });

    btnDeleteLog.addEventListener('click', async () => {
        btnDeleteLog.innerText = "Deleting...";
        btnDeleteLog.style.opacity = "0.5";
        btnDeleteLog.style.pointerEvents = "none";
        
        await execRoot(`rm -f /data/Tenebrion/tenebrion.log`);
        
        btnDeleteLog.innerText = "Deleted!";
        setTimeout(() => {
            btnDeleteLog.innerText = "Delete Log";
            btnDeleteLog.style.opacity = "1";
            btnDeleteLog.style.pointerEvents = "auto";
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

        if pgrep -i -f "endfield" >/dev/null 2>&1; then
            ENDFIELD="1"
        else
            ENDFIELD="0"
        fi

        printf '{"device": "%s", "capacity": "%s", "status": "%s", "uptime_sec": "%s", "current_batt": "%s", "endfield": "%s"}' "$DEVICE" "$CAPACITY" "$STATUS" "$UPTIME_SEC" "$CURRENT" "$ENDFIELD"
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
            
            // Dynamic Status & Warning Logic
            const elStatus = document.getElementById('service-status');
            const statusWarning = document.getElementById('status-warning');
            const warningText = document.getElementById('warning-text');

            if (data.status === "Running") {
                elStatus.innerText = "Running";
                elStatus.style.color = "#4CAF50"; 
                statusWarning.style.display = "none";
            } else {
                if (data.endfield === "1") {
                    elStatus.innerText = "Blocked";
                    elStatus.style.color = "var(--red-accent)";
                    warningText.innerText = "Endfield Engine Detected. Please stop Endfield Engine then click the button below to restart.";
                    statusWarning.style.display = "flex";
                } else {
                    elStatus.innerText = "Stopped";
                    elStatus.style.color = "var(--text-muted)";
                    warningText.innerText = "Daemon is stopped. Attempt to restart Tenebrion Daemon?";
                    statusWarning.style.display = "flex";
                }
            }
        } catch (err) {
            console.error("JSON Parse Error:", err);
        }
    }

    // === 6. LIVE POLLING ===
    function startPolling() {
        pollingInterval = setInterval(loadMainData, 5000); 
    }

    loadMainData();
    startPolling();
});