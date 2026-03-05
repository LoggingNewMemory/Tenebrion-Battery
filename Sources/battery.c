#include "tenebrion_core.h"
#include <sys/system_properties.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>

int main(int argc, char *argv[]) {
    TenebrionStateConfig cfg;
    load_state_config(&cfg);

    system("cmd power set-adaptive-power-saver-enabled true >/dev/null 2>&1");
    system("cmd power set-fixed-performance-mode-enabled false >/dev/null 2>&1");
    system("settings put secure high_priority 0 >/dev/null 2>&1");
    system("settings put secure low_priority 1 >/dev/null 2>&1");
    system("cmd looper_stats enable >/dev/null 2>&1");

    // 2. Core Kernel Powersave Tweaks
    sysfs_write("/sys/module/battery_saver/parameters/enabled", "Y");
    sysfs_write("/proc/sys/kernel/split_lock_mitigate", "1");
    sysfs_write("/proc/sys/vm/vfs_cache_pressure", "100");
    sysfs_write("/sys/kernel/debug/sched_features", "NEXT_BUDDY");
    sysfs_write("/sys/kernel/debug/sched_features", "NO_TTWU_QUEUE");

    // EAS / Schedtune Powersave
    sysfs_write("/dev/stune/top-app/schedtune.prefer_idle", "0");
    sysfs_write("/dev/stune/top-app/schedtune.boost", "0");

    // 3. Block I/O Powersave Tuning
    DIR *blk = opendir("/sys/block");
    if (blk) {
        struct dirent *bdir;
        char blk_path[256];
        while ((bdir = readdir(blk)) != NULL) {
            if (bdir->d_name[0] == '.') continue;
            
            snprintf(blk_path, sizeof(blk_path), "/sys/block/%s/queue/scheduler", bdir->d_name);
            sysfs_write(blk_path, "deadline");

            snprintf(blk_path, sizeof(blk_path), "/sys/block/%s/queue/rq_affinity", bdir->d_name);
            sysfs_write(blk_path, "2"); 
        }
        closedir(blk);
    }

    // CPU Hinting (Powersave static target)
    __system_property_set("debug.hwui.use_hint_manager", "true");
    __system_property_set("debug.sf.enable_adpf_cpu_hint", "true");
    __system_property_set("debug.hwui.target_cpu_time_percent", "40");

    // 4. CPU Frequency setup
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