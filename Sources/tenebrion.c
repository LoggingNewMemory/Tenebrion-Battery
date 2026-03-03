#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <dirent.h>

// Link to the ASM function
extern int check_file_exists_asm(const char *pathname);

const char *ENDFIELD_PATH = "/data/adb/modules/ProjectRaco/Binaries/Endfield";
const char *CONFIG_PATH = "/data/Tenebrion/tenebrion.txt";
const char *SCRIPT_NORMAL = "/data/Tenebrion/normal.sh";
const char *SCRIPT_BATTERY = "/data/Tenebrion/battery.sh";

// State Tracker (In-memory as per constraints)
// -1 = Uninitialized, 0 = Screen Off, 1 = Screen On
static int tenebrion_state = -1;

int get_screen_state() {
    char buf[32];
    int fd;
    ssize_t n;

    // Method 1: Common Path (DRM)
    fd = open("/sys/class/drm/card0-DSI-1/dpms", O_RDONLY);
    if (fd >= 0) {
        n = read(fd, buf, sizeof(buf) - 1);
        close(fd);
        if (n > 0) {
            buf[n] = '\0';
            if (strstr(buf, "On")) return 1;
            if (strstr(buf, "Off")) return 0;
        }
    }

    // Method 2: Second Path (Backlight)
    fd = open("/sys/class/leds/lcd-backlight/brightness", O_RDONLY);
    if (fd >= 0) {
        n = read(fd, buf, sizeof(buf) - 1);
        close(fd);
        if (n > 0) {
            buf[n] = '\0';
            int brightness = atoi(buf);
            return brightness > 0 ? 1 : 0;
        }
    }

    // Method 3: Compatibility via cmd
    FILE *fp = popen("cmd deviceidle get screen", "r");
    if (fp) {
        if (fgets(buf, sizeof(buf), fp)) {
            if (strstr(buf, "true")) { pclose(fp); return 1; }
            if (strstr(buf, "false")) { pclose(fp); return 0; }
        }
        pclose(fp);
    }

    return -1; // Fallback if all fail
}

int get_config_val(const char *key) {
    FILE *fp = fopen(CONFIG_PATH, "r");
    if (!fp) return -1;

    char line[256];
    int val = -1;
    while (fgets(line, sizeof(line), fp)) {
        if (strncmp(line, key, strlen(key)) == 0) {
            char *eq = strchr(line, '=');
            if (eq) {
                val = atoi(eq + 1);
                break;
            }
        }
    }
    fclose(fp);
    return val;
}

void apply_cpu_frequencies(int screen_on) {
    int cust_freq = get_config_val("TENEBRION_CUST_FREQ");
    if (cust_freq != 1) return;

    DIR *dir = opendir("/sys/devices/system/cpu/cpufreq");
    if (!dir) return;

    struct dirent *entry;
    char path[256];
    char key_min[64], key_max[64];

    // Dynamically poll policy* (e.g., policy0, policy6)
    while ((entry = readdir(dir)) != NULL) {
        if (strncmp(entry->d_name, "policy", 6) == 0) {
            int policy_id = atoi(&entry->d_name[6]);
            
            snprintf(key_min, sizeof(key_min), "TENEBRION_CUST_FREQ_%d_MIN", policy_id);
            snprintf(key_max, sizeof(key_max), "TENEBRION_CUST_FREQ_%d_MAX", policy_id);
            
            int target_min = get_config_val(key_min);
            int target_max = get_config_val(key_max);
            
            // If screen is off, you might want to force the MAX to equal the MIN 
            // or apply the TENEBRION_FORGIVE/HALF logic here based on your config parser
            if (!screen_on && target_min > 0) {
                target_max = target_min; // Aggressive battery saving
            }

            if (target_max > 0) {
                snprintf(path, sizeof(path), "/sys/devices/system/cpu/cpufreq/%s/scaling_max_freq", entry->d_name);
                FILE *f_max = fopen(path, "w");
                if (f_max) { fprintf(f_max, "%d", target_max); fclose(f_max); }
            }
        }
    }
    closedir(dir);
}

void handle_state_change(int new_state) {
    if (new_state == tenebrion_state) return; // Prevent loop execution
    
    tenebrion_state = new_state;
    printf("[Tenebrion] State changed to: %s\n", new_state == 1 ? "Screen On" : "Screen Off");

    int is_enabled = get_config_val("0"); // 0=Disable, 1=Enable at top of txt
    // Assuming you want the daemon to halt tweaks if the main toggle is 0

    if (new_state == 1) {
        // Screen On -> Normal
        apply_cpu_frequencies(1);
        if (access(SCRIPT_NORMAL, F_OK) == 0) {
            system(SCRIPT_NORMAL);
        }
    } else if (new_state == 0) {
        // Screen Off -> Battery
        apply_cpu_frequencies(0);
        if (access(SCRIPT_BATTERY, F_OK) == 0) {
            system(SCRIPT_BATTERY);
        }
    }
}

int main() {
    printf("Starting Tenebrion Core (ARM64)\n");

    while (1) {
        // 1. Detect Endfield Engine via ASM Syscall
        if (check_file_exists_asm(ENDFIELD_PATH)) {
            printf("Tenebrion Blocked, Please Disable Endfield Engine\n");
            exit(0);
        }

        // 2. Detect Screen State
        int current_screen = get_screen_state();
        
        // 3. Process State Change
        if (current_screen != -1) {
            handle_state_change(current_screen);
        }

        // 4. Sleep to prevent overhead
        sleep(3);
    }

    return 0;
}