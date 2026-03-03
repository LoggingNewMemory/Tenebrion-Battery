.global check_file_exists_asm
.text
.align 2

// int check_file_exists_asm(const char *pathname)
// x0 = pathname string pointer
check_file_exists_asm:
    mov x1, x0          // Move pathname to x1 (arg1 for faccessat)
    mov x0, #-100       // AT_FDCWD (-100) to x0 (arg0 for faccessat)
    mov x2, #0          // F_OK (0) to x2 (arg2 for mode)
    mov x3, #0          // flags (0) to x3 (arg3)
    mov x8, #48         // syscall number 48 is faccessat on arm64
    svc #0              // trigger syscall

    cmp x0, #0          // check if syscall returned 0 (success)
    cset w0, eq         // if equal (exists), return 1. Else return 0.
    ret