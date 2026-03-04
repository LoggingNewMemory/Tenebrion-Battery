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

    const mainScreen = document.getElementById('main-screen');
    const cpuScreen = document.getElementById('cpu-screen');
    const btnCustomize = document.getElementById('btn-customize');
    const btnBack = document.getElementById('btn-back');
    const btnSave = document.getElementById('btn-save');
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

    // === 3. NAVIGATION ===
    btnCustomize.addEventListener('click', () => {
        mainScreen.classList.remove('active');
        cpuScreen.classList.add('active');
        clearInterval(pollingInterval); 
        loadCPUData();
    });

    btnBack.addEventListener('click', () => {
        cpuScreen.classList.remove('active');
        mainScreen.classList.add('active');
        loadMainData();
        startPolling(); 
    });

    // === 4. RESTART DAEMON EVENT ===
    btnRestart.addEventListener('click', async () => {
        btnRestart.innerText = "Restarting...";
        btnRestart.style.opacity = "0.5";
        btnRestart.style.pointerEvents = "none";
        
        await execRoot(`
            killall TenebrionDaemon_arm64 2>/dev/null
            # Locate the module dir dynamically and run the startup script
            MODDIR=$(find /data/adb/modules -maxdepth 2 -name "service.sh" | grep -i "tenebrion" | head -n 1)
            if [ -n "$MODDIR" ]; then
                sh "$MODDIR" &
            else
                # Fallback path
                sh /data/adb/modules/Tenebrion/service.sh &
            fi
        `);
        
        setTimeout(() => {
            btnRestart.innerText = "Restart Tenebrion";
            btnRestart.style.opacity = "1";
            btnRestart.style.pointerEvents = "auto";
            loadMainData(); // Refresh state
        }, 2000);
    });

    // === 5. DATA FETCHING (MAIN DASHBOARD) ===
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

        # Detect Endfield Engine / Project Raco
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
            
            // Status and Endfield Engine UI Logic
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

    // === 6. SAVING TOGGLES ===
    async function saveToggles() {
        const half = toggleHalf.checked ? 1 : 0;
        const forgive = toggleForgive.checked ? 1 : 0;
        
        const cmd = `
        mkdir -p /data/Tenebrion
        touch /data/Tenebrion/tenebrion.txt
        
        if grep -q "^TENEBRION_HALF=" /data/Tenebrion/tenebrion.txt; then
            sed -i "s/^TENEBRION_HALF=.*/TENEBRION_HALF=${half}/" /data/Tenebrion/tenebrion.txt
        else
            echo "TENEBRION_HALF=${half}" >> /data/Tenebrion/tenebrion.txt
        fi

        if grep -q "^TENEBRION_FORGIVE=" /data/Tenebrion/tenebrion.txt; then
            sed -i "s/^TENEBRION_FORGIVE=.*/TENEBRION_FORGIVE=${forgive}/" /data/Tenebrion/tenebrion.txt
        else
            echo "TENEBRION_FORGIVE=${forgive}" >> /data/Tenebrion/tenebrion.txt
        fi
        `;
        await execRoot(cmd);
    }

    toggleHalf.addEventListener('change', saveToggles);
    toggleForgive.addEventListener('change', saveToggles);

    // === 7. DATA FETCHING (CPU CUSTOMIZATION) ===
    async function loadCPUData() {
        const container = document.getElementById('cluster-container');
        container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">Scanning CPU Clusters...</div>';

        const bashPayload = `
        for policy in /sys/devices/system/cpu/cpufreq/policy*; do
            [ ! -d "$policy" ] && continue
            IDX=$(basename $policy | sed 's/policy//')
            MIN=$(cat $policy/cpuinfo_min_freq 2>/dev/null || echo "0")
            MAX=$(cat $policy/cpuinfo_max_freq 2>/dev/null || echo "0")
            SMIN=$(grep "TENEBRION_CUST_FREQ_\${IDX}_MIN=" /data/Tenebrion/tenebrion.txt 2>/dev/null | cut -d= -f2 || echo "")
            SMID=$(grep "TENEBRION_CUST_FREQ_\${IDX}_MID=" /data/Tenebrion/tenebrion.txt 2>/dev/null | cut -d= -f2 || echo "")
            SMAX=$(grep "TENEBRION_CUST_FREQ_\${IDX}_MAX=" /data/Tenebrion/tenebrion.txt 2>/dev/null | cut -d= -f2 || echo "")
            
            echo "\${IDX}|\${MIN}|\${MAX}|\${SMIN}|\${SMID}|\${SMAX}"
        done
        `;

        const responseText = await execRoot(bashPayload);

        try {
            container.innerHTML = '';
            const lines = responseText.trim().split('\n');
            
            if (!responseText.trim() || lines.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding: 20px;">No CPU Policies Found</div>';
                return;
            }

            lines.forEach(line => {
                if (!line.includes('|')) return;
                const [idxStr, minStr, maxStr, sMinStr, sMidStr, sMaxStr] = line.split('|');
                
                let idx = parseInt(idxStr);
                let name = "Cluster " + idx;
                if (idx === 0) name = "Normal Cluster";
                if (idx === 4 || idx === 6) name = "Big Cluster";
                if (idx === 7) name = "Prime Cluster";

                let min = parseInt(minStr) || 0;
                let max = parseInt(maxStr) || 0;
                let mid = Math.floor((min + max) / 2);

                if (sMinStr) min = parseInt(sMinStr);
                if (sMidStr) mid = parseInt(sMidStr);
                if (sMaxStr) max = parseInt(sMaxStr);

                let minMhz = Math.floor(min / 1000);
                let midMhz = Math.floor(mid / 1000);
                let maxMhz = Math.floor(max / 1000);

                container.innerHTML += `
                    <div class="cluster-title">- ${name}</div>
                    <div class="card list-card">
                        <div class="list-item">
                            <span class="item-label">Min Freq</span>
                            <div class="input-wrapper">
                                <input type="number" class="freq-input" data-policy="${idx}" data-type="min" value="${minMhz}">
                                <span>Mhz</span>
                            </div>
                        </div>
                        <div class="list-item">
                            <span class="item-label">Mid Freq</span>
                            <div class="input-wrapper">
                                <input type="number" class="freq-input" data-policy="${idx}" data-type="mid" value="${midMhz}">
                                <span>Mhz</span>
                            </div>
                        </div>
                        <div class="list-item">
                            <span class="item-label">Max Freq</span>
                            <div class="input-wrapper">
                                <input type="number" class="freq-input" data-policy="${idx}" data-type="max" value="${maxMhz}">
                                <span>Mhz</span>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            if (container.innerHTML === '') {
                container.innerHTML = '<div style="text-align:center; padding: 20px;">No CPU Policies Found</div>';
            }
        } catch (err) {
            console.error("Failed to parse CPU data:", err);
            container.innerHTML = '<div style="text-align:center; padding: 20px; color: #D32F2F;">Failed to read hardware sysfs.</div>';
        }
    }

    // === 8. SAVING CPU DATA ===
    btnSave.addEventListener('click', async () => {
        btnSave.innerText = "Saving...";
        btnSave.style.opacity = "0.5";
        btnSave.style.pointerEvents = "none";
        
        let cmd = `
        if grep -q "^TENEBRION_CUST_FREQ=" /data/Tenebrion/tenebrion.txt; then
            sed -i "s/^TENEBRION_CUST_FREQ=.*/TENEBRION_CUST_FREQ=1/" /data/Tenebrion/tenebrion.txt
        else
            echo "TENEBRION_CUST_FREQ=1" >> /data/Tenebrion/tenebrion.txt
        fi

        sed -i '/^TENEBRION_CUST_FREQ_[0-9]*_/d' /data/Tenebrion/tenebrion.txt
        `;
        
        const inputs = document.querySelectorAll('.freq-input');
        inputs.forEach(input => {
            const khz = parseInt(input.value) * 1000; 
            const type = input.dataset.type.toUpperCase();
            cmd += `echo "TENEBRION_CUST_FREQ_${input.dataset.policy}_${type}=${khz}" >> /data/Tenebrion/tenebrion.txt\n`;
        });

        await execRoot(cmd);
        
        btnSave.innerText = "Saved!";
        btnSave.style.color = "#4CAF50"; 
        
        setTimeout(() => {
            btnSave.innerText = "Save";
            btnSave.style.color = "var(--blue-accent)";
            btnSave.style.opacity = "1";
            btnSave.style.pointerEvents = "auto";
        }, 2000);
    });

    // === 9. LIVE POLLING ===
    function startPolling() {
        pollingInterval = setInterval(loadMainData, 5000); 
    }

    // Init
    loadMainData();
    startPolling();
});