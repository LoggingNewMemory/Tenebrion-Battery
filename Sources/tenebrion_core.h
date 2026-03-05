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

typedef struct {
    int half_freq;
    int forgive_freq;
    int cust_freq_enabled;
    CustFreqNode *custom_freqs;
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

void load_state_config(TenebrionStateConfig *cfg) {
    memset(cfg, 0, sizeof(TenebrionStateConfig));
    cfg->custom_freqs = NULL; 

    FILE *file = fopen("/data/Tenebrion/tenebrion.txt", "r");
    if (!file) return;

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

void get_freq_from_list(const char* policy_path, const char* target, char* out_freq) {
    char avail_path[256];
    char buf[2048];
    snprintf(avail_path, sizeof(avail_path), "%s/scaling_available_frequencies", policy_path);
    
    memset(buf, 0, sizeof(buf));
    if (asm_read_file(avail_path, buf, sizeof(buf) - 1) <= 0) return;

    int freqs[64];
    int count = 0;
    char *token = strtok(buf, " \t\n");
    while (token && count < 64) {
        freqs[count++] = atoi(token);
        token = strtok(NULL, " \t\n");
    }

    if (count == 0) return;

    for (int i = 0; i < count - 1; i++) {
        for (int j = 0; j < count - i - 1; j++) {
            if (freqs[j] > freqs[j+1]) {
                int temp = freqs[j];
                freqs[j] = freqs[j+1];
                freqs[j+1] = temp;
            }
        }
    }

    if (strcmp(target, "MIN") == 0) {
        snprintf(out_freq, 32, "%d", freqs[0]);
    } else if (strcmp(target, "MAX") == 0) {
        snprintf(out_freq, 32, "%d", freqs[count - 1]);
    } else if (strcmp(target, "MID") == 0) {
        snprintf(out_freq, 32, "%d", freqs[count / 2]);
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