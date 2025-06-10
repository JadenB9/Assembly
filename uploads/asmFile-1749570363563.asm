BITS 32
global main

section .text

main:

    ; Demonstrate syscall conventions

    ; syscall (shorthand for system calls) refers to a method for
    ; a program to request certain kernel functions (like reading,
    ; writing, opening, etc) as part of operation.

    ; As an example, let's try writing a string to standard out and then
    ; exiting the program

    ; syscalls utilize eax, ebx, ecx, edx, esi, edi, and potentially ebp
    ; as inputs, so we should clear out what we need
    xor eax, eax
    xor ebx, ebx
    xor ecx, ecx
    xor edx, edx

    ; Let's write a message to standard out!
    mov eax, 0x4    ; write
    mov ebx, 1      ; stdout = 1
    mov ecx, msg    ; pointer to msg
    mov edx, len    ; length of msg
    int 0x80        ; syscall = write(stdout, msg, strlen(msg))

    ; Now let's exit cleanly by calling the exit syscall
    mov eax, 0x1    ; exit
    mov ebx, 0x0    ; exit with error_code 0 to indicate success
    int 0x80        ; syscall = exit(0)

nothing:
; A whole lot of nothing so we keep the bottom of our screen clean
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop
    nop

section .data
msg:   db "Hello, World!", 0xA, 0 ; Our message to write to stdout
len:    equ $ - msg ; The length of our message