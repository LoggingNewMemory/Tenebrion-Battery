#include "tenebrion_core.h"
#include <sys/system_properties.h>

int main() {
    TenebrionStateConfig cfg;
    load_state_config(&cfg);

    // 1. Raco Balanced/Performance Tweaks
    sysfs_write("/sys/module/battery_saver/parameters/enabled", "N");
    sysfs_write("/proc/sys/kernel/split_lock_mitigate", "1");
    sysfs_write("/proc/sys/vm/vfs_cache_pressure", "120");

    // Apply generic block tweaks based on Raco Balanced Profile
    DIR *blk = opendir("/sys/block");
    if (blk) {
        struct dirent *bdir;
        char blk_path[256];
        while ((bdir = readdir(blk)) != NULL) {
            if (bdir->d_name[0] == '.') continue;
            snprintf(blk_path, sizeof(blk_path), "/sys/block/%s/queue/read_ahead_kb", bdir->d_name);
            sysfs_write(blk_path, "128"); // Raco's default balanced read_ahead
        }
        closedir(blk);
    }

    // Carlotta CPU Hinting (Balanced static target)
    __system_property_set("debug.hwui.use_hint_manager", "true");
    __system_property_set("debug.sf.enable_adpf_cpu_hint", "true");
    __system_property_set("debug.hwui.target_cpu_time_percent", "60");

    // 2. CPU Governor setup
    DIR *d = opendir("/sys/devices/system/cpu/cpufreq");
    if (!d) return 1;

    struct dirent *dir;
    char path[256], gov_path[256], min_path[256], max_path[256];

    while ((dir = readdir(d)) != NULL) {
        if (strncmp(dir->d_name, "policy", 6) != 0) continue;
        
        int policy_idx = atoi(&dir->d_name[6]);
        snprintf(path, sizeof(path), "/sys/devices/system/cpu/cpufreq/%s", dir->d_name);
        
        // Reset to prevent write errors
        reset_cpu_limits(path);

        // Apply Governor
        snprintf(gov_path, sizeof(gov_path), "%s/scaling_governor", path);
        sysfs_write(gov_path, "schedutil");

        snprintf(min_path, sizeof(min_path), "%s/scaling_min_freq", path);
        snprintf(max_path, sizeof(max_path), "%s/scaling_max_freq", path);

        // 3. Apply Tenebrion Constraints [cite: 2]
        if (cfg.cust_freq_enabled && cfg.cust_max[policy_idx][0] != '\0') {
            sysfs_write(min_path, cfg.cust_min[policy_idx]);
            
            if (cfg.half_freq) {
                sysfs_write(max_path, cfg.cust_mid[policy_idx]);
            } else {
                sysfs_write(max_path, cfg.cust_max[policy_idx]);
            }
        } else {
            // Dynamic generation if custom frequencies aren't mapped
            char target_min[32] = {0}, target_max[32] = {0};
            
            get_freq_from_list(path, "MIN", target_min);
            sysfs_write(min_path, target_min);

            if (cfg.half_freq) {
                get_freq_from_list(path, "MID", target_max);
            } else {
                get_freq_from_list(path, "MAX", target_max);
            }
            sysfs_write(max_path, target_max);
        }
    }
    closedir(d);
    return 0;
}