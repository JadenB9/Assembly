section .data
    hello_msg db 'Hello, Assembly Game World!', 0xA, 0
    hello_len equ $ - hello_msg
    number1 dd 42
    number2 dd 24
    result dd 0

section .bss
    buffer resb 64

section .text
    global _start

_start:
    ; Display hello message
    mov eax, 4          ; sys_write system call
    mov ebx, 1          ; stdout file descriptor
    mov ecx, hello_msg  ; message to write
    mov edx, hello_len  ; message length
    int 0x80            ; call kernel

    ; Add two numbers
    mov eax, [number1]  ; load first number
    add eax, [number2]  ; add second number
    mov [result], eax   ; store result

    ; Compare result with 100
    cmp eax, 100
    jg greater_than_100 ; jump if greater
    jmp less_or_equal   ; otherwise jump here

greater_than_100:
    ; Handle case where result > 100
    mov ebx, 2          ; set exit code to 2
    jmp exit_program

less_or_equal:
    ; Handle case where result <= 100
    mov ebx, 1          ; set exit code to 1

exit_program:
    ; Exit the program
    mov eax, 1          ; sys_exit system call
    int 0x80            ; call kernel

; Function to multiply two numbers
multiply:
    push ebp            ; save base pointer
    mov ebp, esp        ; set up stack frame
    
    mov eax, [ebp+8]    ; first parameter
    mov ebx, [ebp+12]   ; second parameter
    mul ebx             ; multiply eax by ebx
    
    pop ebp             ; restore base pointer
    ret                 ; return to caller