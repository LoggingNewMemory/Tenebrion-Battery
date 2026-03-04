.global asm_read_file
.global asm_write_file

.text
.align 2

// ------------------------------------------------------------------
// int asm_read_file(const char* path, char* buffer, int max_len)
// ------------------------------------------------------------------
asm_read_file:
    stp x29, x30, [sp, -48]!
    mov x29, sp
    
    str x0, [sp, 16] // path
    str x1, [sp, 24] // buffer
    str w2, [sp, 32] // max_len

    mov w0, -100      // AT_FDCWD
    ldr x1, [sp, 16]  
    mov x2, 0         // O_RDONLY
    mov x3, 0         
    mov x8, 56        // __NR_openat
    svc 0

    cmp w0, 0
    blt .Lread_error
    mov w4, w0        

    mov w0, w4
    ldr x1, [sp, 24]
    ldr w2, [sp, 32]
    mov x8, 63        // __NR_read
    svc 0
    mov w5, w0        

    mov w0, w4
    mov x8, 57        // __NR_close
    svc 0

    mov w0, w5
    b .Lread_done

.Lread_error:
    mov w0, -1        

.Lread_done:
    ldp x29, x30, [sp], 48
    ret

// ------------------------------------------------------------------
// int asm_write_file(const char* path, const char* buffer, int len)
// ------------------------------------------------------------------
asm_write_file:
    stp x29, x30, [sp, -48]!
    mov x29, sp
    
    str x0, [sp, 16] // path
    str x1, [sp, 24] // buffer
    str w2, [sp, 32] // len

    mov w0, -100      // AT_FDCWD
    ldr x1, [sp, 16]  
    mov x2, 0x241     // O_WRONLY | O_CREAT | O_TRUNC
    mov x3, 0x1A4     // 0644 octal
    mov x8, 56        // __NR_openat
    svc 0

    cmp w0, 0
    blt .Lwrite_error
    mov w4, w0        

    mov w0, w4
    ldr x1, [sp, 24]
    ldr w2, [sp, 32]
    mov x8, 64        // __NR_write
    svc 0
    mov w5, w0        

    mov w0, w4
    mov x8, 57        // __NR_close
    svc 0

    mov w0, w5
    b .Lwrite_done

.Lwrite_error:
    mov w0, -1

.Lwrite_done:
    ldp x29, x30, [sp], 48
    ret