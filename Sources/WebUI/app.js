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
            MODDIR=$(find /data/adb/modules -maxdepth 2 -name "service.sh" | grep -i "tenebrion" | head -n 1)
            if [ -n "$MODDIR" ]; then
                sh "$MODDIR" &
            else
                sh /data/adb/modules/Tenebrion/service.sh &
            fi
        `);
        
        setTimeout(() => {
            btnRestart.innerText = "Restart Tenebrion";
            btnRestart.style.opacity = "1";
            btnRestart.style.pointerEvents = "auto";
            loadMainData(); 
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

    // === 6. SAVING TOGGLES ===
    async function saveToggles() {
        const half = toggleHalf.checked ? 1 : 0;
        const forgive = toggleForgive.checked ? 1 : 0;
        
        const cmd = `
        FILE="/data/Tenebrion/tenebrion.txt"
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
        `;
        await execRoot(cmd);
    }

    toggleHalf.addEventListener('change', saveToggles);
    toggleForgive.addEventListener('change', saveToggles);

    // === 7. DATA FETCHING (CPU CUSTOMIZATION WITH DROPDOWNS) ===
    async function loadCPUData() {
        const container = document.getElementById('cluster-container');
        container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">Scanning CPU Clusters...</div>';

        // Added AVAIL extraction to grab safe kernel frequencies
        const bashPayload = `
        for policy in /sys/devices/system/cpu/cpufreq/policy*; do
            [ ! -d "$policy" ] && continue
            IDX=$(basename $policy | sed 's/policy//')
            MIN=$(cat $policy/cpuinfo_min_freq 2>/dev/null || echo "0")
            MAX=$(cat $policy/cpuinfo_max_freq 2>/dev/null || echo "0")
            AVAIL=$(cat $policy/scaling_available_frequencies 2>/dev/null || echo "")
            SMIN=$(grep "TENEBRION_CUST_FREQ_\${IDX}_MIN=" /data/Tenebrion/tenebrion.txt 2>/dev/null | cut -d= -f2 || echo "")
            SMID=$(grep "TENEBRION_CUST_FREQ_\${IDX}_MID=" /data/Tenebrion/tenebrion.txt 2>/dev/null | cut -d= -f2 || echo "")
            SMAX=$(grep "TENEBRION_CUST_FREQ_\${IDX}_MAX=" /data/Tenebrion/tenebrion.txt 2>/dev/null | cut -d= -f2 || echo "")
            
            echo "\${IDX}|\${MIN}|\${MAX}|\${SMIN}|\${SMID}|\${SMAX}|\${AVAIL}"
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
                const parts = line.split('|');
                const idxStr = parts[0];
                const minStr = parts[1];
                const maxStr = parts[2];
                const sMinStr = parts[3];
                const sMidStr = parts[4];
                const sMaxStr = parts[5];
                const availStr = parts[6] || "";
                
                let idx = parseInt(idxStr);
                let name = "Cluster " + idx;
                if (idx === 0) name = "Normal Cluster";
                if (idx === 4 || idx === 6) name = "Big Cluster";
                if (idx === 7) name = "Prime Cluster";

                let min = parseInt(minStr) || 0;
                let max = parseInt(maxStr) || 0;

                // Parse available freqs or fallback to min/max range
                let availFreqs = [];
                if (availStr.trim()) {
                    availFreqs = availStr.trim().split(/\s+/).map(Number);
                } else {
                    availFreqs = [min, Math.floor((min + max) / 2), max];
                }
                
                // Ensure array is unique & sorted ascending
                availFreqs = [...new Set(availFreqs)].sort((a, b) => a - b);

                // Helper to snap arbitrary numbers to the closest valid frequency
                function getClosestFreq(target) {
                    return availFreqs.reduce((prev, curr) => 
                        Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev
                    );
                }

                let actualMin = sMinStr ? parseInt(sMinStr) : min;
                let actualMax = sMaxStr ? parseInt(sMaxStr) : max;
                let actualMid = sMidStr ? parseInt(sMidStr) : Math.floor((min + max) / 2);

                // Snap values to available list (prevents invalid old saves from breaking UI)
                actualMin = getClosestFreq(actualMin);
                actualMid = getClosestFreq(actualMid);
                actualMax = getClosestFreq(actualMax);

                let minMhz = Math.floor(actualMin / 1000);
                let midMhz = Math.floor(actualMid / 1000);
                let maxMhz = Math.floor(actualMax / 1000);

                // Helper to build dropdown options
                function buildOptions(targetMhz) {
                    return availFreqs.map(f => {
                        let mhz = Math.floor(f / 1000);
                        return `<option value="${mhz}" ${mhz === targetMhz ? 'selected' : ''}>${mhz}</option>`;
                    }).join('');
                }

                container.innerHTML += `
                    <div class="cluster-title">- ${name}</div>
                    <div class="card list-card">
                        <div class="list-item">
                            <span class="item-label">Min Freq</span>
                            <div class="input-wrapper">
                                <select class="freq-select" data-policy="${idx}" data-type="min">
                                    ${buildOptions(minMhz)}
                                </select>
                                <span>Mhz</span>
                            </div>
                        </div>
                        <div class="list-item">
                            <span class="item-label">Mid Freq</span>
                            <div class="input-wrapper">
                                <select class="freq-select" data-policy="${idx}" data-type="mid">
                                    ${buildOptions(midMhz)}
                                </select>
                                <span>Mhz</span>
                            </div>
                        </div>
                        <div class="list-item">
                            <span class="item-label">Max Freq</span>
                            <div class="input-wrapper">
                                <select class="freq-select" data-policy="${idx}" data-type="max">
                                    ${buildOptions(maxMhz)}
                                </select>
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
        FILE="/data/Tenebrion/tenebrion.txt"
        
        [ -n "$(tail -c 1 $FILE 2>/dev/null)" ] && echo "" >> $FILE

        if grep -q "^TENEBRION_CUST_FREQ=" $FILE; then
            sed -i "s/^TENEBRION_CUST_FREQ=.*/TENEBRION_CUST_FREQ=1/" $FILE
        else
            echo "TENEBRION_CUST_FREQ=1" >> $FILE
        fi

        sed -i '/^TENEBRION_CUST_FREQ_[0-9]*_/d' $FILE
        `;
        
        // Target the new select tags
        const inputs = document.querySelectorAll('.freq-select');
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

    loadMainData();
    startPolling();
});