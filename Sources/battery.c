#include "tenebrion_core.h"
#include <sys/system_properties.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>

int main(int argc, char *argv[]) {
    // Read the passed argument from the daemon (TENEBRION_FORGIVE state)
    int is_forgive_active = 0;
    if (argc > 1) {
        is_forgive_active = atoi(argv[1]);
    }

    TenebrionStateConfig cfg;
    load_state_config(&cfg);

    // 1. Powersave Tweaks
    sysfs_write("/sys/module/battery_saver/parameters/enabled", "Y");
    sysfs_write("/proc/sys/kernel/split_lock_mitigate", "1");
    sysfs_write("/proc/sys/vm/vfs_cache_pressure", "100");
    sysfs_write("/sys/kernel/debug/sched_features", "NEXT_BUDDY");
    sysfs_write("/sys/kernel/debug/sched_features", "NO_TTWU_QUEUE");

    // CPU Hinting (Powersave static target)
    __system_property_set("debug.hwui.use_hint_manager", "true");
    __system_property_set("debug.sf.enable_adpf_cpu_hint", "true");
    __system_property_set("debug.hwui.target_cpu_time_percent", "40");

    // 2. CPU Governor setup
    DIR *d = opendir("/sys/devices/system/cpu/cpufreq");
    if (!d) {
        free_state_config(&cfg);
        return 1;
    }

    struct dirent *dir;
    char path[256], gov_path[256], min_path[256], max_path[256];

    while ((dir = readdir(d)) != NULL) {
        if (strncmp(dir->d_name, "policy", 6) != 0) continue;
        
        int policy_idx = atoi(&dir->d_name[6]);
        snprintf(path, sizeof(path), "/sys/devices/system/cpu/cpufreq/%s", dir->d_name);
        
        reset_cpu_limits(path);

        snprintf(gov_path, sizeof(gov_path), "%s/scaling_governor", path);
        sysfs_write(gov_path, "powersave");

        snprintf(min_path, sizeof(min_path), "%s/scaling_min_freq", path);
        snprintf(max_path, sizeof(max_path), "%s/scaling_max_freq", path);

        CustFreqNode *target_node = NULL;
        if (cfg.cust_freq_enabled) {
            CustFreqNode *curr = cfg.custom_freqs;
            while (curr != NULL) {
                if (curr->policy_idx == policy_idx) {
                    target_node = curr;
                    break;
                }
                curr = curr->next;
            }
        }

        // 3. Apply Tenebrion Constraints (FORGIVE logic) via RAM Cache
        if (target_node != NULL && target_node->min[0] != '\0') {
            sysfs_write(min_path, target_node->min);
            
            if (is_forgive_active) {
                sysfs_write(max_path, target_node->mid);
            } else {
                sysfs_write(max_path, target_node->min); // Lock to absolute min
            }
        } else {
            char target_min[32] = {0}, target_max[32] = {0};
            
            get_cached_hw_freq(&cfg, policy_idx, "MIN", target_min);
            sysfs_write(min_path, target_min);

            if (is_forgive_active) {
                get_cached_hw_freq(&cfg, policy_idx, "MID", target_max);
            } else {
                get_cached_hw_freq(&cfg, policy_idx, "MIN", target_max); 
            }
            sysfs_write(max_path, target_max);
        }
    }
    
    closedir(d);
    free_state_config(&cfg); 
    return 0;
}