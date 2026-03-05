#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <stdbool.h>
#include <time.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <dirent.h>

// External ARM64 Assembly functions
extern int asm_read_file(const char* path, char* buffer, int max_len);
extern int asm_write_file(const char* path, const char* buffer, int len);

typedef struct {
    bool use_common_path;
    bool use_second_path;
    bool use_compatibility;
} TenebrionConfig;

void check_log_size() {
    struct stat st;
    if (stat("/data/Tenebrion/tenebrion.log", &st) == 0) {
        if (st.st_size >= 50 * 1024) { 
            remove("/data/Tenebrion/tenebrion.log");
        }
    }
}

void write_log(const char *message) {
    FILE *logfile = fopen("/data/Tenebrion/tenebrion.log", "a");
    if (logfile) {
        time_t now = time(NULL);
        struct tm *t = localtime(&now);
        fprintf(logfile, "[%04d-%02d-%02d %02d:%02d:%02d] %s\n",
                t->tm_year + 1900, t->tm_mon + 1, t->tm_mday,
                t->tm_hour, t->tm_min, t->tm_sec, message);
        fclose(logfile);
    }
}

void load_config(TenebrionConfig *config) {
    config->use_common_path = false;
    config->use_second_path = false;
    config->use_compatibility = false;

    FILE *file = fopen("/data/Tenebrion/tenebrion.txt", "r");
    if (!file) return;

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
}

time_t get_file_mtime(const char *path) {
    struct stat statbuf;
    if (stat(path, &statbuf) == -1) {
        return 0;
    }
    return statbuf.st_mtime;
}

// Replaced system("pgrep...") with pure C procfs parsing
bool detect_endfield() {
    DIR *dir = opendir("/proc");
    if (!dir) return false;
    struct dirent *ent;
    char path[256];
    char comm[256];

    while ((ent = readdir(dir)) != NULL) {
        // Check if directory name is a PID (numeric)
        if (ent->d_name[0] >= '1' && ent->d_name[0] <= '9') {
            snprintf(path, sizeof(path), "/proc/%s/comm", ent->d_name);
            FILE *f = fopen(path, "r");
            if (f) {
                if (fgets(comm, sizeof(comm), f) != NULL) {
                    comm[strcspn(comm, "\n")] = 0; // strip newline
                    if (strcmp(comm, "Endfield") == 0) {
                        fclose(f);
                        closedir(dir);
                        return true;
                    }
                }
                fclose(f);
            }
        }
    }
    closedir(dir);
    return false;
}

// Replaced system(cmd) for lower overhead execution
void execute_binary(const char* path) {
    pid_t pid = fork();
    if (pid == 0) {
        // Child process
        char *argv[] = {(char *)path, NULL};
        execv(path, argv);
        exit(1); // Exit if exec fails
    } else if (pid > 0) {
        // Parent process
        waitpid(pid, NULL, 0); // Wait for the binary to finish
    }
}

int get_screen_state(TenebrionConfig *config) {
    char buf[64];
    int len;

    if (config->use_common_path) {
        memset(buf, 0, sizeof(buf));
        len = asm_read_file("/sys/class/drm/card0-DSI-1/dpms", buf, sizeof(buf) - 1);
        if (len > 0) {
            if (strstr(buf, "On")) return 1;
            if (strstr(buf, "Off")) return 0;
        }
        return -1; 
    }

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

    if (config->use_compatibility) {
        // Replaced popen() with direct pipe/execv to avoid sh
        int link[2];
        if (pipe(link) == -1) return -1;
        
        pid_t pid = fork();
        if (pid == 0) {
            dup2(link[1], STDOUT_FILENO);
            close(link[0]);
            close(link[1]);
            char *argv[] = {"/system/bin/cmd", "deviceidle", "get", "screen", NULL};
            execv(argv[0], argv);
            exit(1);
        } else if (pid > 0) {
            close(link[1]);
            memset(buf, 0, sizeof(buf));
            read(link[0], buf, sizeof(buf) - 1);
            close(link[0]);
            waitpid(pid, NULL, 0);
            
            if (strstr(buf, "true")) return 1;
            if (strstr(buf, "false")) return 0;
        }
        return -1;
    }

    return -1; 
}

int main() {
    int current_state = -1;
    int last_state = -1;
    time_t last_mtime = 0;
    TenebrionConfig config;

    check_log_size();
    printf("[Tenebrion] Initializing daemon...\n");
    write_log("Daemon initialized and started.");

    load_config(&config);
    last_mtime = get_file_mtime("/data/Tenebrion/tenebrion.txt");
    
    printf("[Tenebrion] Active Screen Path: Common=%d, Second=%d, Compat=%d\n", 
           config.use_common_path, config.use_second_path, config.use_compatibility);

    while (1) {
        if (detect_endfield()) {
            printf("Tenebrion Blocked, Please Disable Endfield Engine\n");
            write_log("Daemon blocked due to Endfield Engine detection. Exiting.");
            exit(1);
        }

        // WebUI Hot-Reloading Logic
        time_t current_mtime = get_file_mtime("/data/Tenebrion/tenebrion.txt");
        if (current_mtime > last_mtime && last_mtime != 0) {
            write_log("Configuration Has Been Updated, Restarting Tenebrion Daemon...");
            load_config(&config);
            write_log("Restarted Successfully with new configuration");
            last_mtime = current_mtime;
            last_state = -1; // Force state re-evaluation on next loop
        } else if (last_mtime == 0) {
            last_mtime = current_mtime;
        }

        current_state = get_screen_state(&config);

        if (current_state != -1 && current_state != last_state) {
            if (current_state == 1) {
                printf("[Tenebrion] Screen On detected. Executing Normal Binary...\n");
                write_log("State Change: Screen ON -> Executing Normal Binary");
                execute_binary("/data/adb/modules/TenebrionBattery/Binaries/normal"); 
                asm_write_file("/dev/tenebrion_state", "1\n", 2); 
            } else if (current_state == 0) {
                printf("[Tenebrion] Screen Off detected. Executing Battery Binary...\n");
                write_log("State Change: Screen OFF -> Executing Battery Binary");
                execute_binary("/data/adb/modules/TenebrionBattery/Binaries/battery"); 
                asm_write_file("/dev/tenebrion_state", "0\n", 2); 
            }

            last_state = current_state;
        }

        sleep(3);
    }

    return 0;
}