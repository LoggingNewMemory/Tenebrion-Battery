#ifndef TENEBRION_CORE_H
#define TENEBRION_CORE_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <dirent.h>

extern int asm_read_file(const char* path, char* buffer, int max_len);
extern int asm_write_file(const char* path, const char* buffer, int len);

typedef struct CustFreqNode {
    int policy_idx;
    char min[32];
    char mid[32];
    char max[32];
    struct CustFreqNode *next;
} CustFreqNode;

// Structure for our cached hardware frequencies
typedef struct {
    int policy_idx; // -1 if inactive
    char min[32];
    char mid[32];
    char max[32];
} HwFreqCache;

typedef struct {
    int half_freq;
    int forgive_freq;
    int cust_freq_enabled;
    CustFreqNode *custom_freqs;
    HwFreqCache hw_freqs[8]; // Cache for up to 8 CPU policies
} TenebrionStateConfig;

void sysfs_write(const char* path, const char* val) {
    if (val != NULL) {
        asm_write_file(path, val, strlen(val));
    }
}

CustFreqNode* get_or_create_node(TenebrionStateConfig *cfg, int policy_idx) {
    CustFreqNode *curr = cfg->custom_freqs;
    while (curr != NULL) {
        if (curr->policy_idx == policy_idx) return curr;
        curr = curr->next;
    }
    
    CustFreqNode *new_node = (CustFreqNode*)malloc(sizeof(CustFreqNode));
    new_node->policy_idx = policy_idx;
    memset(new_node->min, 0, 32);
    memset(new_node->mid, 0, 32);
    memset(new_node->max, 0, 32);
    new_node->next = cfg->custom_freqs;
    cfg->custom_freqs = new_node;
    return new_node;
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
        } else {
            // Fallback if available_frequencies is empty/missing
            char hw_min_path[256], hw_max_path[256];
            snprintf(hw_min_path, sizeof(hw_min_path), "/sys/devices/system/cpu/cpufreq/%s/cpuinfo_min_freq", dir->d_name);
            snprintf(hw_max_path, sizeof(hw_max_path), "/sys/devices/system/cpu/cpufreq/%s/cpuinfo_max_freq", dir->d_name);
            
            long min_f = 0, max_f = 0;
            f = fopen(hw_min_path, "r"); if (f) { fscanf(f, "%ld", &min_f); fclose(f); }
            f = fopen(hw_max_path, "r"); if (f) { fscanf(f, "%ld", &max_f); fclose(f); }
            
            fprintf(cache, "%d %ld %ld %ld\n", policy_idx, min_f, max_f, max_f);
        }
    }
    closedir(d);
    fclose(cache);
}

void load_state_config(TenebrionStateConfig *cfg) {
    memset(cfg, 0, sizeof(TenebrionStateConfig));
    cfg->custom_freqs = NULL; 
    
    // Initialize HW cache array to empty
    for (int i = 0; i < 8; i++) cfg->hw_freqs[i].policy_idx = -1;

    // 1. Read User Config
    FILE *file = fopen("/data/Tenebrion/tenebrion.txt", "r");
    if (file) {
        char line[256];
        while (fgets(line, sizeof(line), file)) {
            if (strncmp(line, "TENEBRION_HALF=1", 16) == 0) cfg->half_freq = 1;
            if (strncmp(line, "TENEBRION_FORGIVE=1", 19) == 0) cfg->forgive_freq = 1;
            if (strncmp(line, "TENEBRION_CUST_FREQ=1", 21) == 0) cfg->cust_freq_enabled = 1;
            
            if (strncmp(line, "TENEBRION_CUST_FREQ_", 20) == 0) {
                int policy_idx;
                char type[4];
                char val[32];
                if (sscanf(line, "TENEBRION_CUST_FREQ_%d_%3[A-Z]=%31s", &policy_idx, type, val) == 3) {
                    CustFreqNode *node = get_or_create_node(cfg, policy_idx);
                    if (strcmp(type, "MIN") == 0) strcpy(node->min, val);
                    else if (strcmp(type, "MID") == 0) strcpy(node->mid, val);
                    else if (strcmp(type, "MAX") == 0) strcpy(node->max, val);
                }
            }
        }
        fclose(file);
    }

    // 2. Read HW Freq Cache (Self-healing mechanism)
    FILE *cache = fopen("/dev/tenebrion_hw_freq.cache", "r");
    if (!cache) {
        build_hw_freq_cache();
        cache = fopen("/dev/tenebrion_hw_freq.cache", "r");
    }
    
    if (cache) {
        int p_idx;
        long min_f, mid_f, max_f;
        while (fscanf(cache, "%d %ld %ld %ld", &p_idx, &min_f, &mid_f, &max_f) == 4) {
            if (p_idx >= 0 && p_idx < 8) {
                cfg->hw_freqs[p_idx].policy_idx = p_idx;
                snprintf(cfg->hw_freqs[p_idx].min, 32, "%ld", min_f);
                snprintf(cfg->hw_freqs[p_idx].mid, 32, "%ld", mid_f);
                snprintf(cfg->hw_freqs[p_idx].max, 32, "%ld", max_f);
            }
        }
        fclose(cache);
    }
}

void free_state_config(TenebrionStateConfig *cfg) {
    CustFreqNode *curr = cfg->custom_freqs;
    while (curr != NULL) {
        CustFreqNode *next = curr->next;
        free(curr);
        curr = next;
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

// Retrieves instantly from O(1) memory cache.
void get_cached_hw_freq(TenebrionStateConfig *cfg, int policy_idx, const char* target, char* out_freq) {
    out_freq[0] = '\0'; 
    if (policy_idx < 0 || policy_idx >= 8) return;
    
    if (cfg->hw_freqs[policy_idx].policy_idx == policy_idx) {
        if (strcmp(target, "MIN") == 0) strcpy(out_freq, cfg->hw_freqs[policy_idx].min);
        else if (strcmp(target, "MID") == 0) strcpy(out_freq, cfg->hw_freqs[policy_idx].mid);
        else if (strcmp(target, "MAX") == 0) strcpy(out_freq, cfg->hw_freqs[policy_idx].max);
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