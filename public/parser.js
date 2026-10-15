// x86 assembly parser.
// Not a real assembler — just enough to group instructions, find labels,
// and classify opcodes so the 3D view can color and connect them.
// Handles NASM-style (.asm) and GAS-style (.s, e.g. gcc -S output) sources.

const MOVE      = new Set(['mov','movsx','movsxd','movzx','movabs','lea','xchg','push','pop','pusha','popa','pushad','popad','pushf','popf','enter','leave',
                           'cbw','cwd','cwde','cdq','cdqe','cqo','cltd','cltq','cqto']);
const ARITH     = new Set(['add','sub','mul','imul','div','idiv','inc','dec','neg','adc','sbb']);
const LOGIC     = new Set(['and','or','xor','not','shl','shr','sal','sar','rol','ror']);
const CMP       = new Set(['cmp','test']);
const JUMP      = new Set([
    'jmp','je','jz','jne','jnz','jl','jle','jg','jge','ja','jae','jb','jbe',
    'jna','jnae','jnb','jnbe','jng','jnge','jnl','jnle','jpe','jpo','jcxz','jecxz','jrcxz',
    'jc','jnc','jo','jno','js','jns','jp','jnp','call','ret','retn','loop','loope','loopne','loopz','loopnz'
]);
const SYS       = new Set(['int','syscall','sysenter','sysexit','hlt','cli','sti','cld','std','clc','stc','nop','iret']);
const STR_OPS   = new Set(['movsb','movsw','movsd','stosb','stosw','stosd','lodsb','lodsw','lodsd','cmpsb','cmpsw','cmpsd','scasb','scasw','scasd']);

// "jmp eax" is an indirect jump, not a jump to a label called eax.
const REGS = new Set(('rax rbx rcx rdx rsi rdi rbp rsp eax ebx ecx edx esi edi ebp esp ' +
    'ax bx cx dx si di bp sp al bl cl dl ah bh ch dh sil dil bpl spl ' +
    'r8 r9 r10 r11 r12 r13 r14 r15 r8d r9d r10d r11d r12d r13d r14d r15d ' +
    'r8w r9w r10w r11w r12w r13w r14w r15w r8b r9b r10b r11b r12b r13b r14b r15b ' +
    'cs ds es fs gs ss rip eip ip').split(' '));

// Sections GAS lets you switch to without the "section" keyword.
const GAS_SECTIONS = new Set(['.text','.data','.bss','.rodata']);

// "db 'hi'" (NASM) or ".asciz \"hi\"" (GAS) after a label means it's data.
const DATA_DIRECTIVE = /^(db|dw|dd|dq|dt|resb|resw|resd|resq|equ|\.ascii|\.asciz|\.string|\.byte|\.short|\.word|\.long|\.int|\.quad|\.zero|\.space|\.fill)\b\s*(.*)$/i;

// Compiler debug noise that would just stack up rings in the view.
const SKIP_DIRECTIVE = /^\.(cfi_\w+|loc|file|ident|size|type)\b/i;

class Parser {
    parse(src) {
        const lines = src.split(/\r?\n/);
        const nodes = [];
        const labels = new Map();   // name -> index in nodes (locals stored as "parent.local" too)
        let section = null;
        let scope = '';             // last non-local label, for NASM ".local" labels
        let index = 0;
        const externs = new Set();  // names declared with "extern"

        for (let lineNo = 0; lineNo < lines.length; lineNo++) {
            const raw = lines[lineNo];
            const stripped = this.stripComment(raw).trim();
            if (!stripped) continue;

            // section header: "section .text", ".section .text", or GAS ".text"
            const sectionMatch = stripped.match(/^\[?\s*\.?section\s+([^\s,\]]+)/i);
            const bareSection = GAS_SECTIONS.has(stripped.toLowerCase()) ? stripped : null;
            if (sectionMatch || bareSection) {
                section = (sectionMatch ? sectionMatch[1] : bareSection).replace(/^\./, '');
                nodes.push({
                    kind: 'section',
                    name: section,
                    line: lineNo,
                    raw: stripped,
                    index: index++,
                    section
                });
                continue;
            }

            if (SKIP_DIRECTIVE.test(stripped)) continue;

            // directive like "global _start", "%define", "[bits 32]", ".globl main" — treat as ornament
            if (/^(global|extern|default|bits|cpu|org|align)\b/i.test(stripped) ||
                /^[%[]/.test(stripped) ||
                /^\.[A-Za-z_][\w.]*(\s|$)/.test(stripped)) {
                // "extern printf, puts" names symbols that live in another file,
                // so a call to one of them isn't a missing label.
                const ext = stripped.match(/^\.?extern\s+(.*)$/i);
                if (ext) for (const name of ext[1].split(',')) externs.add(name.trim());
                nodes.push({
                    kind: 'directive',
                    raw: stripped,
                    line: lineNo,
                    index: index++,
                    section
                });
                continue;
            }

            // Label. Could be "name:" on its own, or "name: mov eax, 1"
            const labelMatch = stripped.match(/^([A-Za-z_.$@?][\w.$@?]*)\s*:(.*)$/);
            if (labelMatch) {
                const name = labelMatch[1];
                const rest = labelMatch[2].trim();
                if (name.startsWith('.') && scope) {
                    labels.set(scope + name, index);
                    if (!labels.has(name)) labels.set(name, index);
                } else {
                    labels.set(name, index);
                    scope = name;
                }
                nodes.push({
                    kind: 'label',
                    name,
                    raw: `${name}:`,
                    line: lineNo,
                    index: index++,
                    section
                });
                if (rest) {
                    // "msg: db 'hi', 0" is data, anything else is an instruction
                    const dataRest = rest.match(DATA_DIRECTIVE);
                    if (dataRest) {
                        nodes.push(this.dataNode(name, dataRest[1], dataRest[2], rest, lineNo, section, index++));
                    } else {
                        const insn = this.parseInstruction(rest, lineNo, section, index++, scope);
                        if (insn) nodes.push(insn);
                    }
                }
                continue;
            }

            // Data directive: "name db 'hello', 0"
            const dataMatch = stripped.match(/^([A-Za-z_.$][\w.$]*)\s+(db|dw|dd|dq|dt|resb|resw|resd|resq|equ)\b\s*(.*)$/i);
            if (dataMatch) {
                nodes.push(this.dataNode(dataMatch[1], dataMatch[2], dataMatch[3], stripped, lineNo, section, index++));
                continue;
            }

            const insn = this.parseInstruction(stripped, lineNo, section, index++, scope);
            if (insn) nodes.push(insn);
        }

        // Resolve jump targets once we've seen every label. A target that is
        // neither a label here nor an extern (or a GAS "foo@PLT") is flagged
        // so the UI can point at the line — most likely a typo.
        for (const n of nodes) {
            if (n.kind !== 'instruction') continue;
            if (!JUMP.has(n.opcode)) continue;
            const target = this.jumpTarget(n.operands[0]);
            if (!target) continue;
            n.target = target;
            if (target.startsWith('.') && labels.has(n.scope + target)) {
                n.targetIndex = labels.get(n.scope + target);
            } else if (labels.has(target)) {
                n.targetIndex = labels.get(target);
            } else if (!externs.has(target) && !/@\w+$/.test(n.operands[0].trim())) {
                n.unresolved = true;
            }
        }

        return { nodes, labels };
    }

    dataNode(name, directive, value, raw, lineNo, section, index) {
        return {
            kind: 'data',
            name,
            directive: directive.toLowerCase(),
            value,
            raw,
            line: lineNo,
            index,
            section
        };
    }

    // "short .loop", "near foo", "printf@PLT" -> the bare label name
    jumpTarget(operand) {
        let t = (operand || '').trim();
        t = t.replace(/^(short|near|far)\s+/i, '');
        t = t.replace(/@\w+$/, '');
        if (REGS.has(t.toLowerCase())) return '';
        return /^[A-Za-z_.$@?][\w.$@?]*$/.test(t) ? t : '';
    }

    parseInstruction(line, lineNo, section, index, scope) {
        const match = line.match(/^([A-Za-z_.][\w.]*)(?:\s+(.*))?$/);
        if (!match) return null;
        let opcode = match[1].toLowerCase();
        let rest = match[2] || '';

        // Prefixes like "rep movsb" or "lock xadd" — classify the real opcode.
        if (/^(rep|repe|repz|repne|repnz|lock)$/.test(opcode) && rest) {
            const inner = rest.match(/^([A-Za-z_.][\w.]*)(?:\s+(.*))?$/);
            if (inner) {
                opcode = inner[1].toLowerCase();
                rest = inner[2] || '';
            }
        }

        return {
            kind: 'instruction',
            opcode,
            operands: rest ? this.splitOperands(rest) : [],
            category: this.categorize(opcode),
            raw: line,
            line: lineNo,
            index,
            section,
            scope: scope || ''
        };
    }

    splitOperands(rest) {
        // Commas inside brackets should not split (e.g. "[ebp+8]")
        const out = [];
        let depth = 0;
        let buf = '';
        for (const ch of rest) {
            if (ch === '[' || ch === '(') depth++;
            else if (ch === ']' || ch === ')') depth--;
            if (ch === ',' && depth === 0) {
                out.push(buf.trim());
                buf = '';
            } else {
                buf += ch;
            }
        }
        if (buf.trim()) out.push(buf.trim());
        return out;
    }

    stripComment(line) {
        // Semicolons, // and # (GAS) are comments. Ignore inside strings.
        let out = '';
        let inStr = null;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inStr) {
                out += ch;
                if (ch === inStr && line[i - 1] !== '\\') inStr = null;
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                inStr = ch;
                out += ch;
                continue;
            }
            if (ch === ';' || ch === '#') break;
            if (ch === '/' && line[i + 1] === '/') break;
            out += ch;
        }
        return out;
    }

    categorize(opcode) {
        const known = this.lookup(opcode);
        if (known) return known;
        // GAS spells the operand size onto the mnemonic: movl, pushq, cmpb.
        // Strip one size letter and try again, but only if that leaves a
        // real opcode (so "cld" doesn't turn into "cl").
        if (/^[a-z]+[bwlq]$/.test(opcode)) {
            const base = this.lookup(opcode.slice(0, -1));
            if (base) return base;
        }
        if (/^mov[sz][bwlq][wlq]$/.test(opcode)) return 'move';   // movzbl, movswq
        return 'other';
    }

    lookup(opcode) {
        if (MOVE.has(opcode)) return 'move';
        if (ARITH.has(opcode)) return 'arith';
        if (CMP.has(opcode)) return 'cmp';
        if (LOGIC.has(opcode)) return 'logic';
        if (JUMP.has(opcode)) return 'jump';
        if (SYS.has(opcode)) return 'sys';
        if (STR_OPS.has(opcode)) return 'strop';
        if (/^cmov/.test(opcode)) return 'move';
        return null;
    }
}

if (typeof window !== 'undefined') window.AssemblyParser = Parser;
if (typeof module !== 'undefined') module.exports = Parser;
