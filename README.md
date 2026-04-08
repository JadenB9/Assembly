# Assembly 3D Viewer

An experiment in visualizing x86 assembly in 3D. You drop an `.asm` file
into the browser and it lays out the instructions as a tower of pills
you can fly around with WASD.

I originally built this as a silly game where you'd shoot the opcodes,
but that got in the way of actually reading the code, so I ripped out
the game parts and turned it into a plain code viewer.

## Running it

```bash
npm install
npm run dev         # serves on http://localhost:3000
```

Then drop one of your own `.asm` files onto the page, or click "Load
Example" to see `sample.asm`.

## Controls

- **WASD** — move
- **Mouse** — look
- **Space / Ctrl** — up/down
- **Click an instruction** — open a detail panel
- **Scroll** — zoom

## How the layout works

Instructions are grouped by section (`.text`, `.data`, …) and each
section spirals out from its own origin. Jumps are drawn as arcs going
from the `jmp` instruction to the label it targets, so it's easy to see
control flow at a glance.

Color tells you roughly what kind of instruction it is:

| Color  | Instructions                    |
| ------ | ------------------------------- |
| Green  | `mov`, `lea`, `push`, `pop`     |
| Orange | `add`, `sub`, `mul`, `div`      |
| Blue   | `cmp`, `test`, labels           |
| Red    | `jmp`, `je`, `call`, `ret`      |
| Purple | `int`, `syscall`                |
| Yellow | section markers                 |

## Stack

Express serves the static `public/` directory. The actual rendering is
all Three.js in the browser — there's no backend logic, the server just
exists so relative imports and file uploads behave. The parser
understands labels, sections, data directives, and basic jump
resolution, which is enough for small hand-written programs.

## Files

```
server.js            Express static server
sample.asm           Example input
public/
  index.html         Canvas + drop target
  gameEngine.js      Three.js scene + camera + input
  assemblyParser.js  .asm → instruction list
  syntaxHighlighter.js
```
