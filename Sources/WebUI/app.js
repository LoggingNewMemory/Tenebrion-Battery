document.addEventListener('DOMContentLoaded', () => {

    const ksuInsets = document.createElement('link');
    ksuInsets.rel = 'stylesheet';
    ksuInsets.href = '/internal/insets.css';
    document.head.appendChild(ksuInsets);
    // -----------------------------------------
    // 1. KernelSU Root Execution Bridge
    // -----------------------------------------
    async function execRoot(cmd) {
        try {
            // Check if we are running inside the KernelSU Manager WebUI environment
            if (typeof window.ksu !== 'undefined' && typeof window.ksu.exec === 'function') {
                // Native KSU call: synchronous execution returning a stringified JSON
                const responseStr = window.ksu.exec(cmd);
                const response = JSON.parse(responseStr);
                
                if (response.errno === 0) {
                    return response.stdout;
                } else {
                    console.error("KSU Command Failed:", response.stderr);
                    return "";
                }
            } else {
                // Fallback for local PC debugging (e.g., node.js local server)
                console.warn("KernelSU native interface not detected. Falling back to /exec.");
                const res = await fetch('/exec', { method: 'POST', body: cmd });
                return await res.text();
            }
        } catch (e) {
            console.error("KSU Exec exception:", e);
            return "";
        }
    }

    // Native KernelSU Toast API
    function showToast(message) {
        if (typeof window.ksu !== 'undefined' && typeof window.ksu.toast === 'function') {
            window.ksu.toast(message);
        } else {
            console.log("Toast:", message);
        }
    }

    // -----------------------------------------
    // 2. DOM Elements
    // -----------------------------------------
    const mainScreen = document.getElementById('main-screen');
    const cpuScreen = document.getElementById('cpu-screen');
    const btnCustomize = document.getElementById('btn-customize');
    const btnBack = document.getElementById('btn-back');
    const btnSave = document.getElementById('btn-save');

    const elDevice = document.getElementById('device-model');
    const elCapacity = document.getElementById('battery-capacity');
    const elStatus = document.getElementById('service-status');
    const elUptime = document.getElementById('service-uptime');
    const elCurrent = document.getElementById('current-battery');
    
    const toggleHalf = document.getElementById('toggle-half');
    const toggleForgive = document.getElementById('toggle-forgive');

    let pollingInterval;

    // -----------------------------------------
    // 3. Navigation Logic
    // -----------------------------------------
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

    // -----------------------------------------
    // 4. Main Dashboard Data (KSU Read)
    // -----------------------------------------
    const loadMainData = async () => {
        const bashPayload = `
        DEVICE=$(getprop ro.product.model | tr -d '\r\n')
        CAPACITY=$(cat /sys/class/power_supply/battery/charge_full_design 2>/dev/null | tr -d '\r\n')
        [ -z "$CAPACITY" ] && CAPACITY="5000000"
        CURRENT=$(cat /sys/class/power_supply/battery/capacity 2>/dev/null | tr -d '\r\n')
        UPTIME=$(awk '{print int($1/3600)":"int(($1%3600)/60)":"int($1%60)}' /proc/uptime 2>/dev/null | tr -d '\r\n')
        pgrep -f TenebrionDaemon >/dev/null 2>&1 && STATUS="Running" || STATUS="Stopped"
        HALF=$(grep "TENEBRION_HALF=" /data/Tenebrion/tenebrion.txt 2>/dev/null | cut -d= -f2 | tr -d '\r\n')
        FORGIVE=$(grep "TENEBRION_FORGIVE=" /data/Tenebrion/tenebrion.txt 2>/dev/null | cut -d= -f2 | tr -d '\r\n')
        
        printf '{"device": "%s", "capacity": "%s", "status": "%s", "uptime": "%s", "current_batt": "%s", "half": "%s", "forgive": "%s"}' "$DEVICE" "$((CAPACITY/1000))" "$STATUS" "$UPTIME" "$CURRENT" "$HALF" "$FORGIVE"
        `;

        const responseText = await execRoot(bashPayload);
        
        try {
            const data = JSON.parse(responseText);
            elDevice.innerText = data.device || "Unknown Device";
            elCapacity.innerText = (data.capacity || "--") + " mAh";
            elUptime.innerText = data.uptime || "--:--:--";
            elCurrent.innerText = (data.current_batt || "--") + "%";
            
            if (data.status === "Running") {
                elStatus.innerText = "Running";
                elStatus.style.color = "#4CAF50"; 
            } else {
                elStatus.innerText = data.status || "Stopped";
                elStatus.style.color = "var(--red-accent)";
            }
            
            if (document.activeElement !== toggleHalf && document.activeElement !== toggleForgive) {
                toggleHalf.checked = data.half === "1";
                toggleForgive.checked = data.forgive === "1";
            }
        } catch (err) {
            console.error("JSON Parse Error:", err);
            elStatus.innerText = "x`";
            elStatus.style.color = "var(--red-accent)";
        }
    };

    // -----------------------------------------
    // 5. Dashboard Toggles (KSU Write)
    // -----------------------------------------
    const saveToggles = async () => {
        const half = toggleHalf.checked ? 1 : 0;
        const forgive = toggleForgive.checked ? 1 : 0;
        
        const cmd = `
        sed -i "s/^TENEBRION_HALF=.*/TENEBRION_HALF=${half}/" /data/Tenebrion/tenebrion.txt
        sed -i "s/^TENEBRION_FORGIVE=.*/TENEBRION_FORGIVE=${forgive}/" /data/Tenebrion/tenebrion.txt
        `;
        await execRoot(cmd);
    };

    toggleHalf.addEventListener('change', saveToggles);
    toggleForgive.addEventListener('change', saveToggles);

    // -----------------------------------------
    // 6. CPU Customization Data (KSU Read)
    // -----------------------------------------
    const loadCPUData = async () => {
        const container = document.getElementById('cluster-container');
        container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">Scanning Hardware Clusters...</div>';

        const bashPayload = `
        printf "["
        FIRST=true
        for policy in /sys/devices/system/cpu/cpufreq/policy*; do
            [ ! -d "$policy" ] && continue
            [ "$FIRST" = true ] && FIRST=false || printf ","
            
            IDX=$(basename $policy | sed 's/policy//')
            NAME="Cluster $IDX"
            [ "$IDX" = "0" ] && NAME="Normal Cluster"
            [ "$IDX" = "4" ] || [ "$IDX" = "6" ] && NAME="Big Cluster"
            [ "$IDX" = "7" ] && NAME="Prime Cluster"

            MIN=$(cat $policy/cpuinfo_min_freq 2>/dev/null | tr -d '\r\n')
            MAX=$(cat $policy/cpuinfo_max_freq 2>/dev/null | tr -d '\r\n')
            [ -z "$MIN" ] && MIN=0
            [ -z "$MAX" ] && MAX=0
            MID=$(( (MIN + MAX) / 2 ))
            
            printf '{"name": "%s", "policy_idx": "%s", "min_mhz": "%s", "mid_mhz": "%s", "max_mhz": "%s"}' "$NAME" "$IDX" "$((MIN/1000))" "$((MID/1000))" "$((MAX/1000))"
        done
        printf "]"
        `;

        const responseText = await execRoot(bashPayload);

        try {
            const clusters = JSON.parse(responseText);
            container.innerHTML = '';
            
            if (clusters.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">No CPU Policies Found</div>';
                return;
            }

            clusters.forEach(cluster => {
                const html = `
                    <div class="cluster-title">- ${cluster.name}</div>
                    <div class="card list-card">
                        <div class="list-item">
                            <span>Min Freq</span>
                            <div class="input-wrapper">
                                <input type="number" class="freq-input" data-policy="${cluster.policy_idx}" data-type="min" value="${cluster.min_mhz}">
                                <span>Mhz</span>
                            </div>
                        </div>
                        <div class="list-item">
                            <span>Mid Freq</span>
                            <div class="input-wrapper">
                                <input type="number" class="freq-input" data-policy="${cluster.policy_idx}" data-type="mid" value="${cluster.mid_mhz}">
                                <span>Mhz</span>
                            </div>
                        </div>
                        <div class="list-item">
                            <span>Max Freq</span>
                            <div class="input-wrapper">
                                <input type="number" class="freq-input" data-policy="${cluster.policy_idx}" data-type="max" value="${cluster.max_mhz}">
                                <span>Mhz</span>
                            </div>
                        </div>
                    </div>
                `;
                container.innerHTML += html;
            });
        } catch (err) {
            console.error("Failed to load CPU data:", err);
            container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--red-accent);">Error loading CPU data. Check KSU backend.</div>';
        }
    };

    // -----------------------------------------
    // 7. CPU Customization Data (KSU Write)
    // -----------------------------------------
    btnSave.addEventListener('click', async () => {
        btnSave.innerText = "Saving...";
        btnSave.style.opacity = "0.5";
        btnSave.style.pointerEvents = "none";
        
        let cmd = `
        sed -i "s/^TENEBRION_CUST_FREQ=.*/TENEBRION_CUST_FREQ=1/" /data/Tenebrion/tenebrion.txt
        sed -i '/^TENEBRION_CUST_FREQ_[0-9]*_/d' /data/Tenebrion/tenebrion.txt\n`;
        
        const inputs = document.querySelectorAll('.freq-input');
        inputs.forEach(input => {
            const khz = parseInt(input.value) * 1000;
            const type = input.dataset.type.toUpperCase();
            cmd += `echo "TENEBRION_CUST_FREQ_${input.dataset.policy}_${type}=${khz}" >> /data/Tenebrion/tenebrion.txt\n`;
        });

        await execRoot(cmd);
        
        // Trigger native Android toast for user feedback
        showToast("CPU Frequencies successfully saved!");
        
        btnSave.innerText = "Saved!";
        btnSave.style.color = "#4CAF50"; 
        
        setTimeout(() => {
            btnSave.innerText = "Save";
            btnSave.style.color = "var(--blue-accent)";
            btnSave.style.opacity = "1";
            btnSave.style.pointerEvents = "auto";
        }, 2000);
    });

    // -----------------------------------------
    // 8. Initialization & Live Polling
    // -----------------------------------------
    const startPolling = () => {
        pollingInterval = setInterval(loadMainData, 5000); // 5 seconds
    };

    loadMainData();
    startPolling();
});