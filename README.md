# Assembly FPS

Drop an `.asm` file into the browser and walk around your code in 3D.
Instructions become a tower of pills you can fly through — and shoot,
because at some point this turned back into a game. If someone else is
on the page at the same time, it's multiplayer: you can see each other
flying around and trade shots.

Live at [j4den.com/assembly](https://j4den.com/assembly).

## Running it locally

```bash
npm install
npm run dev         # http://localhost:3001
```

`npm test` runs the parser tests. Then drop one of your own `.asm` files onto the page, or click
**load example** (the scene boots with the example loaded so it isn't
empty). The local server also runs the multiplayer relay on `/ws`, so
two browser tabs on localhost can see each other.

## Controls

- **Click** the page to lock the mouse and look around (or **drag** to look
  if your browser blocks mouse lock)
- **WASD** — move, **arrow keys** — look, **Space / Shift** — up / down,
  **Ctrl or E** — run
- **Click an instruction** — select it and open the detail panel
- **Click empty space or F** — shoot, **R** — reload
- **Esc** — release the mouse, **H** — show / hide the controls panel
- On a phone: drag to look, tap a block to inspect, and use the on-screen
  pad to walk, fly and shoot

Files you open or drop are read in the browser with `FileReader` and never
uploaded. NASM-style `.asm` and GAS-style `.s` (e.g. `gcc -S` output) both
work; files over 3000 lines are cut off so the view stays smooth.

## How the layout works

Instructions are grouped by section (`.text`, `.data`, …) and each
section spirals around its own column so you can walk between them.
Jumps are drawn as arcs from the `jmp` to the label it targets, so you
can see control flow at a glance. Color roughly means instruction
category: data movement (`mov`, `push`, …), arithmetic, compares,
jumps/calls, and system instructions (`int`, `syscall`) each get their
own color, and section markers are their own thing.

## Multiplayer

The client speaks a small JSON wire format over WebSocket: position
updates, shots, and hits. Locally that's handled by the relay in
`server.js`; on the live site the same protocol is served by a
Cloudflare Durable Object worker, so the client connects to whichever
one matches the host it's on. The server is authoritative for damage —
remote projectiles are visual-only on your end, which keeps hits from
being double-counted.

## Files

```
server.js            Static file server + WebSocket relay (plain node:http + ws)
sample.asm           Example input
test/                Parser tests (node --test)
public/
  index.html         UI shell, side panel, HUD, built-in example
  engine.js          Three.js scene, controls, combat, multiplayer client
  parser.js          .asm → instruction list (labels, sections, jump targets)
  vendor/three.min.js
```
