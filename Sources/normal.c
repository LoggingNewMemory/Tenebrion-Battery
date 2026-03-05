#include "tenebrion_core.h"
#include <sys/system_properties.h>

int main() {
    TenebrionStateConfig cfg;
    load_state_config(&cfg);

    // 1. Balanced/Performance Tweaks
    sysfs_write("/sys/module/battery_saver/parameters/enabled", "N");
    sysfs_write("/proc/sys/kernel/split_lock_mitigate", "1");
    sysfs_write("/proc/sys/vm/vfs_cache_pressure", "120");

    // Apply generic block tweaks based on Balanced Profile
    DIR *blk = opendir("/sys/block");
    if (blk) {
        struct dirent *bdir;
        char blk_path[256];
        while ((bdir = readdir(blk)) != NULL) {
            if (bdir->d_name[0] == '.') continue;
            snprintf(blk_path, sizeof(blk_path), "/sys/block/%s/queue/read_ahead_kb", bdir->d_name);
            sysfs_write(blk_path, "128");
        }
        closedir(blk);
    }

    // CPU Hinting (Balanced static target)
    __system_property_set("debug.hwui.use_hint_manager", "true");
    __system_property_set("debug.sf.enable_adpf_cpu_hint", "true");
    __system_property_set("debug.hwui.target_cpu_time_percent", "60");

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
        sysfs_write(gov_path, "schedutil");

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

        // 3. Apply Tenebrion Constraints (HALF Logic evaluates here)
        if (target_node != NULL && target_node->max[0] != '\0') {
            sysfs_write(min_path, target_node->min);
            
            // TENEBRION_HALF Implementation
            if (cfg.half_freq) {
                sysfs_write(max_path, target_node->mid);
            } else {
                sysfs_write(max_path, target_node->max);
            }
        } else {
            char target_min[32] = {0}, target_max[32] = {0};
            
            get_freq_from_list(path, "MIN", target_min);
            sysfs_write(min_path, target_min);

            // TENEBRION_HALF Dynamic Implementation
            if (cfg.half_freq) {
                get_freq_from_list(path, "MID", target_max);
            } else {
                get_freq_from_list(path, "MAX", target_max);
            }
            sysfs_write(max_path, target_max);
        }
    }
    
    closedir(d);
    free_state_config(&cfg); 
    return 0;
}