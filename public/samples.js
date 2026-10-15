// Built-in programs for the sample picker. Each one leans on a different
// part of the parser (local labels, string ops, GAS syntax, nested loops)
// so the scene has something to show straight away.

const ASM_SAMPLES = [
{
    name: 'hello.asm',
    title: 'hello world',
    source: `section .data
    hello_msg db 'Hello, Assembly!', 0xA, 0
    hello_len equ $ - hello_msg
    number1   dd 42
    number2   dd 24
    result    dd 0

section .bss
    buffer resb 64

section .text
    global _start

_start:
    mov eax, 4          ; sys_write
    mov ebx, 1          ; stdout
    mov ecx, hello_msg
    mov edx, hello_len
    int 0x80

    mov eax, [number1]
    add eax, [number2]
    mov [result], eax

    cmp eax, 100
    jg  greater_than_100
    jmp less_or_equal

greater_than_100:
    mov ebx, 2
    jmp exit_program

less_or_equal:
    mov ebx, 1

exit_program:
    mov eax, 1
    int 0x80

multiply:
    push ebp
    mov  ebp, esp
    mov  eax, [ebp+8]
    mov  ebx, [ebp+12]
    mul  ebx
    pop  ebp
    ret
`
},
{
    name: 'loop.asm',
    title: 'loops and local labels',
    source: `; sum the numbers 1..10, then count the set bits of the result
section .data
    total   dd 0
    bits    dd 0

section .text
    global _start

_start:
    mov  ecx, 10
    xor  eax, eax
.add:
    add  eax, ecx
    dec  ecx
    jnz  .add
    mov  [total], eax

    call popcount
    mov  [bits], eax

    mov  eax, 1
    xor  ebx, ebx
    int  0x80

; eax = number of 1 bits in eax
popcount:
    push ecx
    xor  ecx, ecx
.loop:
    test eax, eax
    jz   .done
    mov  edx, eax
    and  edx, 1
    add  ecx, edx
    shr  eax, 1
    jmp  .loop
.done:
    mov  eax, ecx
    pop  ecx
    ret
`
},
{
    name: 'strings.asm',
    title: 'string ops (64-bit)',
    source: `; strlen + reverse with the string instructions
section .data
    text    db "assembly", 0
    textlen equ $ - text - 1

section .bss
    out     resb 32

section .text
    global _start

_start:
    lea  rdi, [text]
    call strlen
    mov  rcx, rax

    lea  rsi, [text]
    lea  rdi, [out]
    call reverse

    mov  rax, 1             ; write(1, out, len)
    mov  rdi, 1
    lea  rsi, [out]
    mov  rdx, textlen
    syscall

    mov  rax, 60            ; exit(0)
    xor  rdi, rdi
    syscall

; rdi = string -> rax = length
strlen:
    push rcx
    push rdi
    xor  al, al
    mov  rcx, -1
    repne scasb
    not  rcx
    lea  rax, [rcx - 1]
    pop  rdi
    pop  rcx
    ret

; rsi = source, rdi = dest, rcx = length
reverse:
    push rsi
    add  rsi, rcx
    dec  rsi
    std
.copy:
    lodsb
    stosb
    loop .copy
    cld
    mov  byte [rdi], 0
    pop  rsi
    ret
`
},
{
    name: 'gcd.s',
    title: 'gcd (gcc -S output)',
    source: `	.file	"gcd.c"
	.text
	.globl	gcd
	.type	gcd, @function
gcd:
.LFB0:
	.cfi_startproc
	pushq	%rbp
	.cfi_def_cfa_offset 16
	movq	%rsp, %rbp
	movl	%edi, -4(%rbp)
	movl	%esi, -8(%rbp)
.L3:
	cmpl	$0, -8(%rbp)      # while (b != 0)
	je	.L2
	movl	-4(%rbp), %eax
	cltd
	idivl	-8(%rbp)
	movl	%edx, %eax        # t = a % b
	movl	-8(%rbp), %edx
	movl	%edx, -4(%rbp)    # a = b
	movl	%eax, -8(%rbp)    # b = t
	jmp	.L3
.L2:
	movl	-4(%rbp), %eax
	popq	%rbp
	.cfi_def_cfa 7, 8
	ret
	.cfi_endproc
.LFE0:
	.size	gcd, .-gcd
	.section	.rodata
.LC0:
	.string	"gcd(%d, %d) = %d\\n"
	.text
	.globl	main
	.type	main, @function
main:
.LFB1:
	.cfi_startproc
	pushq	%rbp
	movq	%rsp, %rbp
	movl	$18, %esi
	movl	$48, %edi
	call	gcd
	movl	%eax, %ecx
	movl	$18, %edx
	movl	$48, %esi
	leaq	.LC0(%rip), %rdi
	movl	$0, %eax
	call	printf@PLT
	movl	$0, %eax
	popq	%rbp
	ret
	.cfi_endproc
	.ident	"GCC: (GNU) 13.2.0"
`
},
{
    name: 'sort.asm',
    title: 'bubble sort (nested loops)',
    source: `; bubble sort an array of dwords, then print it one digit per line
section .data
    nums    dd 5, 3, 9, 1, 7, 2, 8, 6, 4, 0
    count   equ ($ - nums) / 4
    newline db 0xA

section .bss
    digit   resb 1

section .text
    global _start

_start:
    mov  esi, nums
    mov  ecx, count
    call sort
    call print_all
    mov  eax, 1
    xor  ebx, ebx
    int  0x80

; esi = array, ecx = length
sort:
    pusha
    dec  ecx
    jle  .done
.outer:
    xor  edx, edx           ; swapped flag
    xor  edi, edi           ; i = 0
.inner:
    mov  eax, [esi + edi*4]
    mov  ebx, [esi + edi*4 + 4]
    cmp  eax, ebx
    jle  .next
    mov  [esi + edi*4], ebx
    mov  [esi + edi*4 + 4], eax
    mov  edx, 1
.next:
    inc  edi
    cmp  edi, ecx
    jl   .inner
    test edx, edx
    jz   .done
    dec  ecx
    jnz  .outer
.done:
    popa
    ret

; esi = array, ecx = length
print_all:
    pusha
.each:
    mov  eax, [esi]
    add  eax, '0'
    mov  [digit], al
    push ecx
    mov  eax, 4
    mov  ebx, 1
    mov  ecx, digit
    mov  edx, 1
    int  0x80
    mov  eax, 4
    mov  ebx, 1
    mov  ecx, newline
    mov  edx, 1
    int  0x80
    pop  ecx
    add  esi, 4
    loop .each
    popa
    ret
`
}
];

if (typeof window !== 'undefined') window.ASM_SAMPLES = ASM_SAMPLES;
if (typeof module !== 'undefined') module.exports = ASM_SAMPLES;
