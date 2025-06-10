# Assembly Code Game

A giant locally hosted npm assembly program that imports .asm files and transforms assembly code into an interactive 3D game experience.

## Features

- **3D Visualization**: Assembly instructions rendered as interactive 3D objects
- **Color-Coded Instructions**: Different instruction types have unique colors and shapes
- **Interactive Navigation**: Click, drag, and explore your assembly code in 3D space
- **File Import**: Upload .asm files or drag & drop them into the application
- **Real-time Editing**: Edit assembly code in the built-in editor
- **Visual Effects**: Animations, glowing effects, and particle systems
- **Instruction Details**: Click on any instruction to see detailed information
- **Data Flow Visualization**: See how data flows between instructions

## Installation & Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm run dev
```

3. Open your browser and navigate to `http://localhost:3000`

## Controls

- **Mouse**: Look around and rotate the view
- **WASD**: Move the camera
- **Space**: Trigger instruction animations
- **Click**: Select and inspect instructions
- **Scroll**: Zoom in/out
- **Drag & Drop**: Drop .asm files directly into the browser

## How It Works

1. **Assembly Parser**: Parses .asm files and identifies different instruction types
2. **3D Engine**: Uses Three.js to render instructions as 3D objects in space
3. **Game Logic**: Provides interactive navigation and visual feedback
4. **Visual Effects**: Adds animations, glow effects, and particle systems

## Instruction Types & Colors

- **Move Instructions** (mov, lea, push, pop): Green
- **Arithmetic** (add, sub, mul, div): Orange  
- **Comparison** (cmp, test): Blue
- **Jump/Control** (jmp, je, call, ret): Red
- **System Calls** (int, syscall): Purple
- **Sections**: Yellow
- **Labels**: Blue Grey

## File Structure

```
Assembly/
├── server.js           # Express server
├── package.json        # Dependencies
├── sample.asm         # Example assembly file
├── public/
│   ├── index.html     # Main HTML interface
│   ├── gameEngine.js  # 3D game engine
│   ├── assemblyParser.js  # Assembly code parser
│   └── syntaxHighlighter.js  # Syntax highlighting
└── uploads/           # Uploaded files directory
```

## Example Usage

1. Load the example assembly code by clicking "Load Example Code"
2. Or upload your own .asm file using the file upload button
3. Navigate around the 3D space to explore your code
4. Click on instructions to see detailed information
5. Use the Space key to trigger animations
6. Edit code in the editor and click "Compile & Visualize"

## Dependencies

- **Express.js**: Web server framework
- **Multer**: File upload handling
- **Three.js**: 3D graphics library
- **Cannon.js**: Physics engine
- **Prism.js**: Syntax highlighting

## Browser Compatibility

- Chrome (recommended)
- Firefox
- Safari
- Edge

Requires WebGL support for 3D rendering.

## Contributing

Feel free to contribute additional features like:
- More instruction types
- Additional visual effects
- Assembly language variants
- Performance optimizations
- Virtual machine simulation

## License

MIT License