const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Parser = require('../public/parser.js');

const parse = (src) => new Parser().parse(src).nodes;
const insns = (nodes) => nodes.filter(n => n.kind === 'instruction');

test('sample.asm parses into sections, labels, data and instructions', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'sample.asm'), 'utf8');
    const nodes = parse(src);
    const count = (kind) => nodes.filter(n => n.kind === kind).length;
    assert.strictEqual(count('section'), 3);
    assert.strictEqual(count('label'), 5);
    assert.strictEqual(count('data'), 6);
    assert.strictEqual(count('instruction'), 23);
});

test('jumps point at their label', () => {
    const nodes = parse('start:\n  jmp done\n  nop\ndone:\n  ret');
    const jmp = insns(nodes)[0];
    assert.strictEqual(nodes[jmp.targetIndex].name, 'done');
});

test('test is a compare, not logic', () => {
    const [n] = insns(parse('test eax, eax'));
    assert.strictEqual(n.category, 'cmp');
});

test('NASM local labels resolve inside their own function', () => {
    const src = [
        'a:', '.loop:', '  dec ecx', '  jnz .loop', '  ret',
        'b:', '.loop:', '  dec edx', '  jnz .loop', '  ret'
    ].join('\n');
    const nodes = parse(src);
    const jumps = insns(nodes).filter(n => n.opcode === 'jnz');
    assert.strictEqual(nodes[jumps[0].targetIndex].line, 1);
    assert.strictEqual(nodes[jumps[1].targetIndex].line, 6);
});

test('jmp short / near and @PLT still find the target', () => {
    const nodes = parse('f:\n  jmp short f\n  jmp near f\n  call f@PLT');
    for (const n of insns(nodes)) assert.strictEqual(nodes[n.targetIndex].name, 'f');
});

test('GAS sources: bare .text, # comments, .globl, cfi noise, label data', () => {
    const src = [
        '\t.file\t"hello.c"',
        '\t.section .rodata',
        'msg:\t.asciz "hi # not a comment"',
        '\t.text',
        '\t.globl main',
        'main:',
        '\t.cfi_startproc',
        '\tpushq %rbp   # save frame',
        '\tmovq %rsp, %rbp',
        '.L2:',
        '\tjmp .L2',
        '\t.cfi_endproc'
    ].join('\n');
    const nodes = parse(src);
    assert.deepStrictEqual(nodes.filter(n => n.kind === 'section').map(n => n.name), ['rodata', 'text']);
    const data = nodes.find(n => n.kind === 'data');
    assert.strictEqual(data.name, 'msg');
    assert.strictEqual(data.value, '"hi # not a comment"');
    assert.ok(nodes.some(n => n.kind === 'directive' && n.raw === '.globl main'));
    assert.ok(!nodes.some(n => /cfi|\.file/.test(n.raw)));
    const ops = insns(nodes);
    assert.deepStrictEqual(ops.map(n => n.opcode), ['pushq', 'movq', 'jmp']);
    assert.strictEqual(ops[0].raw, 'pushq %rbp');
    assert.strictEqual(nodes[ops[2].targetIndex].name, '.L2');
});

test('rep prefix is classified by the real opcode', () => {
    const [n] = insns(parse('rep movsb'));
    assert.strictEqual(n.opcode, 'movsb');
    assert.strictEqual(n.category, 'strop');
});

test('CRLF line endings and NASM preprocessor lines', () => {
    const nodes = parse('%define N 4\r\n[bits 32]\r\nstart:\r\n  mov eax, N\r\n');
    assert.deepStrictEqual(nodes.map(n => n.kind), ['directive', 'directive', 'label', 'instruction']);
    assert.strictEqual(nodes[2].name, 'start');
});

test('brackets keep commas together', () => {
    const [n] = insns(parse('mov eax, [ebx+ecx*4]'));
    assert.deepStrictEqual(n.operands, ['eax', '[ebx+ecx*4]']);
});
