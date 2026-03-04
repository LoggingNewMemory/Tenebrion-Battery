#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <stdbool.h>

// External ARM64 Assembly functions
extern int asm_read_file(const char* path, char* buffer, int max_len);

// Configuration Structure
typedef struct {
    bool use_common_path;
    bool use_second_path;
    bool use_compatibility;
} TenebrionConfig;

// Function to load config from tenebrion.txt once at startup
void load_config(TenebrionConfig *config) {
    // Set defaults to false
    config->use_common_path = false;
    config->use_second_path = false;
    config->use_compatibility = false;

    FILE *file = fopen("/data/Tenebrion/tenebrion.txt", "r");
    if (!file) {
        printf("[Tenebrion] Warning: Config file not found. Defaulting to Compatibility mode.\n");
        config->use_compatibility = true;
        return;
    }

    char line[256];
    while (fgets(line, sizeof(line), file)) {
        if (strncmp(line, "TENEBRION_COMMON_PATH=1", 23) == 0) {
            config->use_common_path = true;
        } else if (strncmp(line, "TENEBRION_SECOND_PATH=1", 23) == 0) {
            config->use_second_path = true;
        } else if (strncmp(line, "TENEBRION_COMPABILITY=1", 23) == 0) {
            config->use_compatibility = true;
        }
    }
    fclose(file);

    // Fallback if the user or installer messed up and set none
    if (!config->use_common_path && !config->use_second_path && !config->use_compatibility) {
        printf("[Tenebrion] Warning: No valid path flag set in config. Defaulting to Compatibility mode.\n");
        config->use_compatibility = true;
    }
}

// Function to detect Endfield Engine
bool detect_endfield() {
    if (system("pgrep -x Endfield > /dev/null 2>&1") == 0) return true;
    return false;
}

// Function to get screen state based on the loaded configuration
// Returns: 1 (On), 0 (Off), -1 (Unknown)
int get_screen_state(TenebrionConfig *config) {
    char buf[64];
    int len;

    // 1. Common Path
    if (config->use_common_path) {
        memset(buf, 0, sizeof(buf));
        len = asm_read_file("/sys/class/drm/card0-DSI-1/dpms", buf, sizeof(buf) - 1);
        if (len > 0) {
            if (strstr(buf, "On")) return 1;
            if (strstr(buf, "Off")) return 0;
        }
        return -1; // Return immediately if this is the chosen path but it fails
    }

    // 2. Second Path
    if (config->use_second_path) {
        memset(buf, 0, sizeof(buf));
        len = asm_read_file("/sys/class/leds/lcd-backlight/brightness", buf, sizeof(buf) - 1);
        if (len > 0) {
            int brightness = atoi(buf);
            if (brightness > 0) return 1;
            if (brightness == 0) return 0;
        }
        return -1;
    }

    // 3. Compatibility Path
    if (config->use_compatibility) {
        FILE *fp = popen("cmd deviceidle get screen", "r");
        if (fp) {
            if (fgets(buf, sizeof(buf), fp) != NULL) {
                pclose(fp);
                if (strstr(buf, "true")) return 1;
                if (strstr(buf, "false")) return 0;
            } else {
                pclose(fp);
            }
        }
        return -1;
    }

    return -1; 
}

int main() {
    int current_state = -1;
    int last_state = -1;
    TenebrionConfig config;

    printf("[Tenebrion] Initializing daemon...\n");

    // Load configuration once to determine the correct sysfs/cmd path
    load_config(&config);
    
    printf("[Tenebrion] Active Screen Path: Common=%d, Second=%d, Compat=%d\n", 
           config.use_common_path, config.use_second_path, config.use_compatibility);

    while (1) {
        // Step 1: Detect Endfield Engine
        if (detect_endfield()) {
            printf("Tenebrion Blocked, Please Disable Endfield Engine\n");
            exit(1);
        }

        // Step 2: Detect Screen State using ONLY the configured path
        current_state = get_screen_state(&config);

        // Step 3: Check if state changed to prevent execution loops
        if (current_state != -1 && current_state != last_state) {
            
            // Execute corresponding compiled binaries based on in-memory state
            if (current_state == 1) {
                printf("[Tenebrion] Screen On detected. Executing Normal Binary...\n");
                system("/data/Tenebrion/normal"); // Direct execution, no 'sh'
                asm_write_file("/data/Tenebrion/tenebrion.txt", "TENEBRION_STATE=1\n", 18);
            } else if (current_state == 0) {
                printf("[Tenebrion] Screen Off detected. Executing Battery Binary...\n");
                system("/data/Tenebrion/battery"); // Direct execution, no 'sh'
                asm_write_file("/data/Tenebrion/tenebrion.txt", "TENEBRION_STATE=0\n", 18);
            }

            // Update state
            last_state = current_state;
        }

        // Step 4: Sleep for 3 seconds to prevent overhead
        sleep(3);
    }

    return 0;
}