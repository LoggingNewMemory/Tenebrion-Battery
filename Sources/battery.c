#include "tenebrion_core.h"
#include <sys/system_properties.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>

int main(int argc, char *argv[]) {
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

    // 2. CPU Frequency setup
    DIR *d = opendir("/sys/devices/system/cpu/cpufreq");
    if (!d) {
        free_state_config(&cfg);
        return 1;
    }

    struct dirent *dir;
    char path[256], min_path[256], max_path[256];

    while ((dir = readdir(d)) != NULL) {
        if (strncmp(dir->d_name, "policy", 6) != 0) continue;
        
        int policy_idx = atoi(&dir->d_name[6]);
        snprintf(path, sizeof(path), "/sys/devices/system/cpu/cpufreq/%s", dir->d_name);
        
        reset_cpu_limits(path);

        snprintf(min_path, sizeof(min_path), "%s/scaling_min_freq", path);
        snprintf(max_path, sizeof(max_path), "%s/scaling_max_freq", path);

        // 3. Apply Tenebrion Constraints via RAM Cache
        char target_min[32] = {0}, target_max[32] = {0};
        
        get_cached_hw_freq(&cfg, policy_idx, "MIN", target_min);
        sysfs_write(min_path, target_min);

        get_cached_hw_freq(&cfg, policy_idx, "MIN", target_max); 
        sysfs_write(max_path, target_max); // Lock to absolute min
    }
    
    closedir(d);
    free_state_config(&cfg); 
    return 0;
}