class AssemblyParser {
    constructor() {
        this.instructions = [];
        this.labels = {};
        this.sections = {};
        this.currentSection = null;
    }

    parse(asmCode) {
        const lines = asmCode.split('\n');
        this.instructions = [];
        this.labels = {};
        this.sections = {};
        
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(';')) return;
            
            const instruction = this.parseLine(trimmed, index);
            if (instruction) {
                this.instructions.push(instruction);
            }
        });
        
        return {
            instructions: this.instructions,
            labels: this.labels,
            sections: this.sections
        };
    }
    
    parseLine(line, lineNumber) {
        if (line.startsWith('section ')) {
            const sectionName = line.substring(8);
            this.currentSection = sectionName;
            this.sections[sectionName] = [];
            return {
                type: 'section',
                name: sectionName,
                line: lineNumber,
                original: line,
                position: { x: 0, y: lineNumber * 2, z: 0 }
            };
        }
        
        if (line.endsWith(':')) {
            const labelName = line.slice(0, -1);
            this.labels[labelName] = lineNumber;
            return {
                type: 'label',
                name: labelName,
                line: lineNumber,
                original: line,
                position: { x: -5, y: lineNumber * 2, z: 0 }
            };
        }
        
        const parts = line.split(/\s+/);
        const opcode = parts[0];
        const operands = parts.slice(1).join(' ').split(',').map(op => op.trim());
        
        const instructionType = this.getInstructionType(opcode);
        
        return {
            type: 'instruction',
            opcode: opcode,
            operands: operands,
            instructionType: instructionType,
            line: lineNumber,
            original: line,
            section: this.currentSection,
            position: { 
                x: Math.random() * 10 - 5, 
                y: lineNumber * 2, 
                z: Math.random() * 10 - 5 
            }
        };
    }
    
    getInstructionType(opcode) {
        const moveInstructions = ['mov', 'lea', 'push', 'pop'];
        const arithmeticInstructions = ['add', 'sub', 'mul', 'div', 'inc', 'dec'];
        const comparisonInstructions = ['cmp', 'test'];
        const jumpInstructions = ['jmp', 'je', 'jne', 'jl', 'jg', 'jle', 'jge', 'call', 'ret'];
        const systemInstructions = ['int', 'syscall'];
        
        if (moveInstructions.includes(opcode)) return 'move';
        if (arithmeticInstructions.includes(opcode)) return 'arithmetic';
        if (comparisonInstructions.includes(opcode)) return 'comparison';
        if (jumpInstructions.includes(opcode)) return 'jump';
        if (systemInstructions.includes(opcode)) return 'system';
        
        return 'other';
    }
    
    getInstructionColor(instructionType) {
        const colors = {
            'move': 0x4CAF50,      // Green
            'arithmetic': 0xFF9800, // Orange
            'comparison': 0x2196F3, // Blue
            'jump': 0xF44336,       // Red
            'system': 0x9C27B0,     // Purple
            'section': 0xFFEB3B,    // Yellow
            'label': 0x607D8B,      // Blue Grey
            'other': 0x9E9E9E       // Grey
        };
        return colors[instructionType] || colors.other;
    }
}

window.AssemblyParser = AssemblyParser;