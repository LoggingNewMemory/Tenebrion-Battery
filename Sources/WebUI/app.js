document.addEventListener('DOMContentLoaded', () => {
    // Navigation
    document.getElementById('btn-customize').addEventListener('click', () => {
        document.getElementById('main-screen').classList.remove('active');
        document.getElementById('cpu-screen').classList.add('active');
        loadCPUData();
    });

    document.getElementById('btn-back').addEventListener('click', () => {
        document.getElementById('cpu-screen').classList.remove('active');
        document.getElementById('main-screen').classList.add('active');
    });

    // Load Main Data
    fetch('/cgi-bin/api?action=status')
        .then(res => res.json())
        .then(data => {
            document.getElementById('device-model').innerText = data.device;
            document.getElementById('battery-capacity').innerText = data.capacity + " mAh";
            document.getElementById('service-status').innerText = data.status;
            document.getElementById('service-uptime').innerText = data.uptime;
            document.getElementById('current-battery').innerText = data.current_batt + "%";
            
            document.getElementById('toggle-half').checked = data.half == 1;
            document.getElementById('toggle-forgive').checked = data.forgive == 1;
        });

    // Toggle Saves
    const saveToggles = () => {
        const half = document.getElementById('toggle-half').checked ? 1 : 0;
        const forgive = document.getElementById('toggle-forgive').checked ? 1 : 0;
        fetch(`/cgi-bin/api?action=save_toggles&half=${half}&forgive=${forgive}`);
    };
    document.getElementById('toggle-half').addEventListener('change', saveToggles);
    document.getElementById('toggle-forgive').addEventListener('change', saveToggles);

    // Save Custom CPU Frequencies
    document.getElementById('btn-save').addEventListener('click', () => {
        const btn = document.getElementById('btn-save');
        btn.innerText = "Saving...";
        
        const inputs = document.querySelectorAll('.freq-input');
        let params = new URLSearchParams();
        params.append('action', 'save_cpufreq');
        
        inputs.forEach(input => {
            // Convert MHz back to KHz for the C daemon
            const khz = parseInt(input.value) * 1000;
            params.append(`p${input.dataset.policy}_${input.dataset.type}`, khz);
        });

        fetch(`/cgi-bin/api?${params.toString()}`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    btn.innerText = "Saved!";
                    setTimeout(() => btn.innerText = "Save", 2000);
                }
            })
            .catch(() => {
                btn.innerText = "Error";
                setTimeout(() => btn.innerText = "Save", 2000);
            });
    });
});

function loadCPUData() {
    fetch('/cgi-bin/api?action=cpufreq')
        .then(res => res.json())
        .then(clusters => {
            const container = document.getElementById('cluster-container');
            container.innerHTML = '';
            
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
        });
}