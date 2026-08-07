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

Then drop one of your own `.asm` files onto the page, or click
**load example** (the scene boots with the example loaded so it isn't
empty). The local server also runs the multiplayer relay on `/ws`, so
two browser tabs on localhost can see each other.

## Controls

- **Click** the page to lock the mouse and look around
- **WASD** — move, **Space / Shift** — up / down
- **Click an instruction** — select it and open the detail panel
- **Click empty space or F** — shoot, **R** — reload
- **Esc** — release the mouse

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
public/
  index.html         UI shell, side panel, HUD, built-in example
  engine.js          Three.js scene, controls, combat, multiplayer client
  parser.js          .asm → instruction list (labels, sections, jump targets)
  vendor/three.min.js
```
