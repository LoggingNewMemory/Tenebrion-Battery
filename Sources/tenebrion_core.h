#ifndef TENEBRION_CORE_H
#define TENEBRION_CORE_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <dirent.h>

extern int asm_read_file(const char* path, char* buffer, int max_len);
extern int asm_write_file(const char* path, const char* buffer, int len);

// Structure for our cached hardware frequencies (Linked List for unlimited policies)
typedef struct HwFreqNode {
    int policy_idx; 
    char min[32];
    char mid[32];
    char max[32];
    struct HwFreqNode *next;
} HwFreqNode;

typedef struct {
    HwFreqNode *hw_freqs; // Dynamically handles any number of CPU clusters
} TenebrionStateConfig;

// Sysfs writes often require a newline '\n' to be parsed and committed by the kernel properly.
void sysfs_write(const char* path, const char* val) {
    if (val != NULL && val[0] != '\0') {
        char buf[64];
        int len = snprintf(buf, sizeof(buf), "%s\n", val);
        asm_write_file(path, buf, len);
    }
}

// Helper to add nodes dynamically to HW frequency cache
void add_hw_freq_node(TenebrionStateConfig *cfg, int policy_idx, long min_f, long mid_f, long max_f) {
    HwFreqNode *new_node = (HwFreqNode*)malloc(sizeof(HwFreqNode));
    new_node->policy_idx = policy_idx;
    snprintf(new_node->min, 32, "%ld", min_f);
    snprintf(new_node->mid, 32, "%ld", mid_f);
    snprintf(new_node->max, 32, "%ld", max_f);
    new_node->next = cfg->hw_freqs;
    cfg->hw_freqs = new_node;
}

// Builds the Cache in tmpfs (RAM) on initialization
void build_hw_freq_cache() {
    FILE *cache = fopen("/dev/tenebrion_hw_freq.cache", "w");
    if (!cache) return;

    DIR *d = opendir("/sys/devices/system/cpu/cpufreq");
    if (!d) {
        fclose(cache);
        return;
    }

    struct dirent *dir;
    long freqs[128];

    while ((dir = readdir(d)) != NULL) {
        if (strncmp(dir->d_name, "policy", 6) != 0) continue;
        int policy_idx = atoi(&dir->d_name[6]);
        
        char avail_path[256];
        snprintf(avail_path, sizeof(avail_path), "/sys/devices/system/cpu/cpufreq/%s/scaling_available_frequencies", dir->d_name);
        
        FILE *f = fopen(avail_path, "r");
        if (!f) continue;

        int count = 0;
        long freq;
        while (fscanf(f, "%ld", &freq) == 1 && count < 128) {
            freqs[count++] = freq;
        }
        fclose(f);

        if (count > 0) {
            // Sort Descending (Highest to Lowest)
            for (int i = 0; i < count - 1; i++) {
                for (int j = i + 1; j < count; j++) {
                    if (freqs[i] < freqs[j]) {
                        long temp = freqs[i];
                        freqs[i] = freqs[j];
                        freqs[j] = temp;
                    }
                }
            }
            
            long max_f = freqs[0];
            long min_f = freqs[count - 1];
            
            // MID logic replicated from Raco.sh: mid_opp = (((total_opp + 1) / 2)) - 1
            int mid_idx = ((count + 1) / 2) - 1;
            if (mid_idx < 0) mid_idx = 0;
            long mid_f = freqs[mid_idx];

            fprintf(cache, "%d %ld %ld %ld\n", policy_idx, min_f, mid_f, max_f);
        }
    }
    closedir(d);
    fclose(cache);
}

void load_state_config(TenebrionStateConfig *cfg) {
    memset(cfg, 0, sizeof(TenebrionStateConfig));
    cfg->hw_freqs = NULL; 

    // Read HW Freq Cache (Self-healing mechanism)
    FILE *cache = fopen("/dev/tenebrion_hw_freq.cache", "r");
    if (!cache) {
        build_hw_freq_cache();
        cache = fopen("/dev/tenebrion_hw_freq.cache", "r");
    }
    
    if (cache) {
        int p_idx;
        long min_f, mid_f, max_f;
        while (fscanf(cache, "%d %ld %ld %ld", &p_idx, &min_f, &mid_f, &max_f) == 4) {
            add_hw_freq_node(cfg, p_idx, min_f, mid_f, max_f);
        }
        fclose(cache);
    }
}

void free_state_config(TenebrionStateConfig *cfg) {
    // Free hw freqs list
    HwFreqNode *curr_hw = cfg->hw_freqs;
    while (curr_hw != NULL) {
        HwFreqNode *next = curr_hw->next;
        free(curr_hw);
        curr_hw = next;
    }
}

void apply_block_tweaks(const char* scheduler, const char* rq_affinity) {
    DIR *d = opendir("/sys/block");
    if (!d) return;
    struct dirent *dir;
    char path[256];

    while ((dir = readdir(d)) != NULL) {
        if (dir->d_name[0] == '.') continue;
        
        snprintf(path, sizeof(path), "/sys/block/%s/queue/scheduler", dir->d_name);
        sysfs_write(path, scheduler);
        
        snprintf(path, sizeof(path), "/sys/block/%s/queue/rq_affinity", dir->d_name);
        sysfs_write(path, rq_affinity);
    }
    closedir(d);
}

// Retrieves instantly from dynamic RAM cache mapping.
void get_cached_hw_freq(TenebrionStateConfig *cfg, int policy_idx, const char* target, char* out_freq) {
    out_freq[0] = '\0'; 
    HwFreqNode *curr = cfg->hw_freqs;
    
    while (curr != NULL) {
        if (curr->policy_idx == policy_idx) {
            if (strcmp(target, "MIN") == 0) strcpy(out_freq, curr->min);
            else if (strcmp(target, "MID") == 0) strcpy(out_freq, curr->mid);
            else if (strcmp(target, "MAX") == 0) strcpy(out_freq, curr->max);
            return;
        }
        curr = curr->next;
    }
}

void reset_cpu_limits(const char* policy_path) {
    char min_path[256], max_path[256], hw_min_path[256], hw_max_path[256];
    char hw_min[32] = {0}, hw_max[32] = {0};

    snprintf(hw_min_path, sizeof(hw_min_path), "%s/cpuinfo_min_freq", policy_path);
    snprintf(hw_max_path, sizeof(hw_max_path), "%s/cpuinfo_max_freq", policy_path);
    snprintf(min_path, sizeof(min_path), "%s/scaling_min_freq", policy_path);
    snprintf(max_path, sizeof(max_path), "%s/scaling_max_freq", policy_path);

    asm_read_file(hw_min_path, hw_min, 31);
    asm_read_file(hw_max_path, hw_max, 31);
    
    hw_min[strcspn(hw_min, "\n")] = 0;
    hw_max[strcspn(hw_max, "\n")] = 0;

    sysfs_write(min_path, hw_min);
    sysfs_write(max_path, hw_max);
}

#endif