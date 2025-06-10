class AssemblySyntaxHighlighter {
    constructor() {
        this.keywords = [
            'section', 'global', 'extern', 'db', 'dw', 'dd', 'dq', 'resb', 'resw', 'resd', 'resq',
            'equ', 'mov', 'add', 'sub', 'mul', 'div', 'inc', 'dec', 'cmp', 'test', 'and', 'or',
            'xor', 'not', 'shl', 'shr', 'jmp', 'je', 'jne', 'jl', 'jg', 'jle', 'jge', 'call',
            'ret', 'push', 'pop', 'int', 'lea', 'nop', 'hlt'
        ];
        
        this.registers = [
            'eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'esp', 'ebp',
            'ax', 'bx', 'cx', 'dx', 'si', 'di', 'sp', 'bp',
            'al', 'ah', 'bl', 'bh', 'cl', 'ch', 'dl', 'dh'
        ];
        
        this.sections = ['.data', '.bss', '.text', '.rodata'];
    }
    
    highlight(code) {
        let highlighted = code;
        
        highlighted = highlighted.replace(/;.*$/gm, '<span class="comment">$&</span>');
        
        this.keywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            highlighted = highlighted.replace(regex, `<span class="keyword">${keyword}</span>`);
        });
        
        this.registers.forEach(register => {
            const regex = new RegExp(`\\b${register}\\b`, 'gi');
            highlighted = highlighted.replace(regex, `<span class="register">${register}</span>`);
        });
        
        this.sections.forEach(section => {
            const regex = new RegExp(`\\${section}\\b`, 'gi');
            highlighted = highlighted.replace(regex, `<span class="section">${section}</span>`);
        });
        
        highlighted = highlighted.replace(/\b\d+\b/g, '<span class="number">$&</span>');
        
        highlighted = highlighted.replace(/^(\w+):/gm, '<span class="label">$1:</span>');
        
        highlighted = highlighted.replace(/'[^']*'/g, '<span class="string">$&</span>');
        highlighted = highlighted.replace(/"[^"]*"/g, '<span class="string">$&</span>');
        
        return highlighted;
    }
    
    applySyntaxHighlighting(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            const code = element.value || element.textContent;
            const highlighted = this.highlight(code);
            
            if (element.tagName === 'TEXTAREA') {
                const wrapper = document.createElement('div');
                wrapper.className = 'syntax-wrapper';
                wrapper.innerHTML = `
                    <div class="syntax-highlight">${highlighted}</div>
                    <textarea>${code}</textarea>
                `;
                element.parentNode.replaceChild(wrapper, element);
            } else {
                element.innerHTML = highlighted;
            }
        }
    }
}

window.AssemblySyntaxHighlighter = AssemblySyntaxHighlighter;