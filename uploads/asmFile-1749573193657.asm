BITS 32
global main

main:
; Zero out our registers
    xor eax, eax
    xor ebx, ebx
    xor ecx, ecx

; Demonstrate mov instruction
    mov eax, 1
    mov ebx, eax
    mov ecx, 0x2
    mov eax, ecx

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
