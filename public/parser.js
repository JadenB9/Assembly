// x86 assembly parser.
// Not a real assembler — just enough to group instructions, find labels,
// and classify opcodes so the 3D view can color and connect them.

const MOVE      = new Set(['mov','movsx','movzx','lea','xchg','push','pop','pushad','popad','pushf','popf']);
const ARITH     = new Set(['add','sub','mul','imul','div','idiv','inc','dec','neg','adc','sbb']);
const LOGIC     = new Set(['and','or','xor','not','shl','shr','sal','sar','rol','ror','test']);
const CMP       = new Set(['cmp','test']);
const JUMP      = new Set([
    'jmp','je','jz','jne','jnz','jl','jle','jg','jge','ja','jae','jb','jbe',
    'jc','jnc','jo','jno','js','jns','jp','jnp','call','ret','retn','loop','loope','loopne'
]);
const SYS       = new Set(['int','syscall','sysenter','sysexit','hlt','cli','sti','nop','iret']);
const STR_OPS   = new Set(['movsb','movsw','movsd','stosb','stosw','stosd','lodsb','lodsw','lodsd','cmpsb','cmpsw','cmpsd','scasb','scasw','scasd']);

class Parser {
    parse(src) {
        const lines = src.split('\n');
        const nodes = [];
        const labels = new Map();   // name -> index in nodes
        let section = null;
        let index = 0;

        for (let lineNo = 0; lineNo < lines.length; lineNo++) {
            const raw = lines[lineNo];
            const stripped = this.stripComment(raw).trim();
            if (!stripped) continue;

            // section header: "section .text" or ".section .text"
            const sectionMatch = stripped.match(/^\.?section\s+(\S+)/i);
            if (sectionMatch) {
                section = sectionMatch[1].replace(/^\./, '');
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

            // directive like "global _start" — treat as ornament
            if (/^(global|extern|default|bits|cpu|org)\b/i.test(stripped)) {
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
            const labelMatch = stripped.match(/^([A-Za-z_.$][\w.$]*)\s*:(.*)$/);
            if (labelMatch) {
                const name = labelMatch[1];
                const rest = labelMatch[2].trim();
                labels.set(name, index);
                nodes.push({
                    kind: 'label',
                    name,
                    raw: `${name}:`,
                    line: lineNo,
                    index: index++,
                    section
                });
                if (rest) {
                    const insn = this.parseInstruction(rest, lineNo, section, index++);
                    if (insn) nodes.push(insn);
                }
                continue;
            }

            // Data directive: "name db 'hello', 0"
            const dataMatch = stripped.match(/^([A-Za-z_.$][\w.$]*)\s+(db|dw|dd|dq|resb|resw|resd|resq|equ)\b\s*(.*)$/i);
            if (dataMatch) {
                nodes.push({
                    kind: 'data',
                    name: dataMatch[1],
                    directive: dataMatch[2].toLowerCase(),
                    value: dataMatch[3],
                    raw: stripped,
                    line: lineNo,
                    index: index++,
                    section
                });
                continue;
            }

            const insn = this.parseInstruction(stripped, lineNo, section, index++);
            if (insn) nodes.push(insn);
        }

        // Resolve jump targets once we've seen every label.
        for (const n of nodes) {
            if (n.kind !== 'instruction') continue;
            if (!JUMP.has(n.opcode)) continue;
            const target = (n.operands[0] || '').trim();
            if (target && labels.has(target)) {
                n.targetIndex = labels.get(target);
            }
        }

        return { nodes, labels };
    }

    parseInstruction(line, lineNo, section, index) {
        const match = line.match(/^([A-Za-z_.][\w.]*)(?:\s+(.*))?$/);
        if (!match) return null;
        const opcode = match[1].toLowerCase();
        const operands = match[2]
            ? this.splitOperands(match[2])
            : [];

        return {
            kind: 'instruction',
            opcode,
            operands,
            category: this.categorize(opcode),
            raw: line,
            line: lineNo,
            index,
            section
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
        // Semicolons and // are comments. Ignore inside strings.
        let out = '';
        let inStr = null;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inStr) {
                out += ch;
                if (ch === inStr && line[i - 1] !== '\\') inStr = null;
                continue;
            }
            if (ch === '"' || ch === "'") {
                inStr = ch;
                out += ch;
                continue;
            }
            if (ch === ';') break;
            if (ch === '/' && line[i + 1] === '/') break;
            out += ch;
        }
        return out;
    }

    categorize(opcode) {
        if (MOVE.has(opcode)) return 'move';
        if (ARITH.has(opcode)) return 'arith';
        if (CMP.has(opcode)) return 'cmp';
        if (LOGIC.has(opcode)) return 'logic';
        if (JUMP.has(opcode)) return 'jump';
        if (SYS.has(opcode)) return 'sys';
        if (STR_OPS.has(opcode)) return 'strop';
        return 'other';
    }
}

window.AssemblyParser = Parser;
