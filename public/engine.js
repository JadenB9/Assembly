// 3D viewer for parsed assembly.
// OrbitControls by default, optional WASD free-fly with mouse look.
// Click an instruction to inspect it; jump instructions draw arcs to
// their target labels so you can actually see control flow.

const PALETTE = {
    section:  0x3a3a3a,
    label:    0xd4a050,  // amber — matches j4den accent
    move:     0x6a9955,  // muted green
    arith:    0xd4a050,  // amber
    cmp:      0x569cd6,  // muted blue
    logic:    0x4ec9b0,  // teal
    jump:     0xd16969,  // muted red
    sys:      0xc586c0,  // muted purple
    strop:    0xdcdcaa,  // muted yellow
    data:     0x808080,
    directive:0x404040,
    other:    0x666666
};

// How instructions are laid out in space.
const ROW_GAP  = 1.5;   // vertical space between instructions in a section
const SEC_GAP  = 4.0;   // vertical space between sections
const RADIUS   = 11;    // helix radius inside a section
const TURN     = 0.48;  // radians per instruction along the helix

class AssemblyViewer {
    constructor(canvasHost) {
        this.host = canvasHost;
        this.nodes = [];
        this.meshes = [];            // parallel to this.nodes, some entries null
        this.edges = [];             // three.js Line objects for jump arrows
        this.selected = null;
        this.hovered = null;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);
        this.scene.fog = new THREE.Fog(0x0a0a0a, 40, 160);

        const w = canvasHost.clientWidth;
        const h = canvasHost.clientHeight;
        this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 1000);
        this.camera.position.set(30, 30, 50);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(w, h);
        canvasHost.appendChild(this.renderer.domElement);

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.clock = new THREE.Clock();

        this._setupLights();
        this._setupGround();
        this._setupControls();
        this._bindEvents();

        this.onSelect = () => {};
        this.onStats = () => {};

        this._loop();
    }

    _setupLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.35);
        this.scene.add(ambient);

        const key = new THREE.DirectionalLight(0xffffff, 0.7);
        key.position.set(40, 60, 30);
        this.scene.add(key);

        const rim = new THREE.DirectionalLight(0xd4a050, 0.25);
        rim.position.set(-30, 20, -40);
        this.scene.add(rim);
    }

    _setupGround() {
        const grid = new THREE.GridHelper(400, 80, 0x1a1a1a, 0x141414);
        grid.position.y = -2;
        this.scene.add(grid);
    }

    _setupControls() {
        // Movement is WASD + mouse look in pointer lock mode. No orbit controls —
        // the point is to walk around your code, not spin it on a turntable.
        this.keys = {
            w: false, a: false, s: false, d: false,
            space: false, ctrl: false, shift: false
        };
        this.lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.pointerLocked = false;
        this.homePos = new THREE.Vector3();
        this.homeLook = new THREE.Vector3();
    }

    _bindEvents() {
        window.addEventListener('resize', () => this._resize());

        const dom = this.renderer.domElement;
        dom.addEventListener('pointermove', (e) => this._onPointerMove(e));

        // One click does double duty: if it hits an instruction mesh, select it;
        // otherwise request pointer lock so the user can walk around.
        dom.addEventListener('click', (e) => this._onClick(e));

        document.addEventListener('pointerlockchange', () => {
            this.pointerLocked = document.pointerLockElement === dom;
            this._setCrosshair(this.pointerLocked);
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.pointerLocked) return;
            this.lookEuler.setFromQuaternion(this.camera.quaternion);
            this.lookEuler.y -= e.movementX * 0.0022;
            this.lookEuler.x -= e.movementY * 0.0022;
            this.lookEuler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.lookEuler.x));
            this.camera.quaternion.setFromEuler(this.lookEuler);
        });

        const k = (e, down) => {
            switch (e.code) {
                case 'KeyW': this.keys.w = down; break;
                case 'KeyA': this.keys.a = down; break;
                case 'KeyS': this.keys.s = down; break;
                case 'KeyD': this.keys.d = down; break;
                case 'Space':
                    if (this.pointerLocked) e.preventDefault();
                    this.keys.space = down;
                    break;
                case 'ControlLeft':
                case 'ControlRight':
                    if (this.pointerLocked) e.preventDefault();
                    this.keys.ctrl = down;
                    break;
                case 'ShiftLeft':
                case 'ShiftRight': this.keys.shift = down; break;
                case 'Escape':
                    if (down && this.pointerLocked) document.exitPointerLock();
                    break;
            }
        };
        document.addEventListener('keydown', (e) => k(e, true));
        document.addEventListener('keyup', (e) => k(e, false));
    }

    _setCrosshair(on) {
        const el = document.getElementById('crosshair');
        if (el) el.style.opacity = on ? '1' : '0';
    }

    resetView() {
        if (this.pointerLocked) document.exitPointerLock();
        this.camera.position.copy(this.homePos);
        const look = this.homeLook.clone();
        this.camera.lookAt(look);
        this.lookEuler.setFromQuaternion(this.camera.quaternion);
    }

    load(source) {
        this._clear();
        const parser = new window.AssemblyParser();
        const { nodes } = parser.parse(source);
        this.nodes = nodes;

        // Layout: assign a 3D position to every node.
        // Each section gets its own vertical band; instructions within a section
        // spiral outward along a gentle helix so nothing overlaps.
        const sectionStarts = new Map();
        let y = 0;
        let localIdx = 0;
        let currentSection = null;

        for (const node of nodes) {
            if (node.kind === 'section') {
                if (currentSection !== null) y += SEC_GAP;
                currentSection = node.section;
                sectionStarts.set(currentSection, y);
                node.pos = new THREE.Vector3(0, y, 0);
                localIdx = 0;
                y += ROW_GAP;
                continue;
            }

            if (node.kind === 'directive') {
                node.pos = new THREE.Vector3(0, y, 0);
                y += ROW_GAP * 0.7;
                localIdx++;
                continue;
            }

            const angle = localIdx * TURN;
            node.pos = new THREE.Vector3(
                Math.cos(angle) * RADIUS,
                y,
                Math.sin(angle) * RADIUS
            );
            y += ROW_GAP;
            localIdx++;
        }

        // Build meshes.
        for (const node of nodes) {
            this.meshes.push(this._buildMesh(node));
        }

        // Build jump edges — curved lines from jump instructions to their target labels.
        for (const node of nodes) {
            if (node.kind !== 'instruction' || node.targetIndex == null) continue;
            const targetNode = nodes[node.targetIndex];
            if (!targetNode || !targetNode.pos) continue;
            this.edges.push(this._buildEdge(node.pos, targetNode.pos));
        }

        // Pick a focal point to drop the user in near the interesting part of
        // the code: the first label (usually _start), or the first instruction,
        // falling back to the first node of any kind.
        const firstLabel = nodes.find(n => n.kind === 'label' && n.pos);
        const firstInsn  = nodes.find(n => n.kind === 'instruction' && n.pos);
        const anchor = firstLabel || firstInsn || nodes.find(n => n.pos) || { pos: new THREE.Vector3() };

        this.homePos.set(
            anchor.pos.x + RADIUS + 10,
            anchor.pos.y + 4,
            anchor.pos.z + RADIUS + 10
        );
        this.homeLook.set(anchor.pos.x, anchor.pos.y + 1, anchor.pos.z);
        this.camera.position.copy(this.homePos);
        this.camera.lookAt(this.homeLook);
        this.lookEuler.setFromQuaternion(this.camera.quaternion);

        this._emitStats();
    }

    _buildMesh(node) {
        let mesh;
        const color = PALETTE[node.kind === 'instruction' ? node.category : node.kind] || PALETTE.other;

        switch (node.kind) {
            case 'section': {
                const geo = new THREE.CylinderGeometry(RADIUS + 3, RADIUS + 3, 0.2, 64, 1, true);
                const mat = new THREE.MeshBasicMaterial({
                    color: PALETTE.section,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.35
                });
                mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(node.pos);
                this.scene.add(mesh);
                this._attachLabel(mesh, `[ ${node.section} ]`, PALETTE.label, 0.9, 2.5);
                return mesh;
            }
            case 'directive': {
                const geo = new THREE.TorusGeometry(0.3, 0.08, 8, 16);
                mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: PALETTE.directive }));
                mesh.position.copy(node.pos);
                this.scene.add(mesh);
                return mesh;
            }
            case 'label': {
                const geo = new THREE.ConeGeometry(0.55, 1.6, 6);
                const mat = new THREE.MeshStandardMaterial({
                    color: PALETTE.label,
                    emissive: PALETTE.label,
                    emissiveIntensity: 0.35,
                    roughness: 0.6
                });
                mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(node.pos);
                mesh.userData.node = node;
                this.scene.add(mesh);
                this._attachLabel(mesh, node.name + ':', PALETTE.label, 0.7, 1.4);
                return mesh;
            }
            case 'data': {
                const geo = new THREE.BoxGeometry(1.4, 0.5, 0.8);
                const mat = new THREE.MeshStandardMaterial({ color: PALETTE.data, roughness: 0.7 });
                mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(node.pos);
                mesh.userData.node = node;
                this.scene.add(mesh);
                this._attachLabel(mesh, node.name, 0xb0b0b0, 0.55, 1.0);
                return mesh;
            }
            case 'instruction':
            default: {
                const geo = new THREE.BoxGeometry(1.6, 0.5, 0.9);
                const mat = new THREE.MeshStandardMaterial({
                    color,
                    emissive: color,
                    emissiveIntensity: 0.18,
                    roughness: 0.5,
                    metalness: 0.05
                });
                mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(node.pos);
                mesh.userData.node = node;
                this.scene.add(mesh);
                this._attachLabel(mesh, node.raw, 0xcccccc, 0.55, 1.0);
                return mesh;
            }
        }
    }

    _attachLabel(parent, text, colorHex, scale, yOffset) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');

        // Soft pill background so the text reads against the dark scene.
        const pad = 8;
        const shown = text.length > 28 ? text.slice(0, 26) + '…' : text;
        ctx.font = '36px "JetBrains Mono", "Fira Code", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const metrics = ctx.measureText(shown);
        const boxW = Math.min(canvas.width - 4, metrics.width + pad * 2);
        const boxH = canvas.height - 16;
        const boxX = (canvas.width - boxW) / 2;
        const boxY = (canvas.height - boxH) / 2;
        ctx.fillStyle = 'rgba(12,12,12,0.72)';
        this._roundRect(ctx, boxX, boxY, boxW, boxH, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(60,60,60,0.8)';
        ctx.lineWidth = 1;
        this._roundRect(ctx, boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1, 8);
        ctx.stroke();

        ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
        ctx.fillText(shown, canvas.width / 2, canvas.height / 2 + 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthWrite: false
        }));
        sprite.scale.set(5.2 * scale, 1.0 * scale, 1);
        sprite.position.set(0, yOffset, 0);
        sprite.renderOrder = 2;
        parent.add(sprite);
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    _buildEdge(start, end) {
        const mid = new THREE.Vector3(
            (start.x + end.x) / 2,
            Math.max(start.y, end.y) + Math.abs(end.y - start.y) * 0.25 + 3,
            (start.z + end.z) / 2 + 6
        );
        const curve = new THREE.QuadraticBezierCurve3(start.clone(), mid, end.clone());
        const points = curve.getPoints(40);
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({
            color: PALETTE.jump,
            transparent: true,
            opacity: 0.4
        });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        return line;
    }

    _onPointerMove(event) {
        if (this.pointerLocked) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.meshes.filter(Boolean), false);
        const next = hits.length ? hits[0].object : null;

        if (next === this.hovered) return;
        if (this.hovered && this.hovered !== this.selected) {
            this._setEmissive(this.hovered, 0.18);
        }
        this.hovered = next;
        if (this.hovered && this.hovered !== this.selected) {
            this._setEmissive(this.hovered, 0.6);
        }
        this.renderer.domElement.style.cursor = next ? 'pointer' : 'crosshair';
    }

    _onClick(event) {
        // While pointer-locked, click = raycast from screen center (crosshair).
        // Otherwise, click at the cursor position. Either way, if we hit an
        // instruction we select it; if we hit nothing and aren't locked, lock.
        if (this.pointerLocked) {
            this.pointer.set(0, 0);
        } else {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        }

        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.meshes.filter(Boolean), false);

        if (hits.length) {
            this._select(hits[0].object);
            return;
        }

        if (!this.pointerLocked) {
            this.renderer.domElement.requestPointerLock();
        }
    }

    _select(mesh) {
        if (this.selected) this._setEmissive(this.selected, 0.18);
        this.selected = mesh;
        this._setEmissive(mesh, 0.9);
        const node = mesh.userData.node;
        if (node) this.onSelect(node);
    }

    _setEmissive(mesh, intensity) {
        if (mesh.material && 'emissiveIntensity' in mesh.material) {
            mesh.material.emissiveIntensity = intensity;
        }
    }

    _emitStats() {
        const counts = { instruction: 0, label: 0, section: 0, data: 0, directive: 0 };
        for (const n of this.nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;
        this.onStats(counts);
    }

    _clear() {
        for (const m of this.meshes) {
            if (!m) continue;
            // Sprite children hold CanvasTextures; dispose them so we don't leak.
            for (const child of m.children) {
                if (child.material && child.material.map) child.material.map.dispose();
                if (child.material) child.material.dispose();
            }
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
            this.scene.remove(m);
        }
        for (const e of this.edges) {
            if (e.geometry) e.geometry.dispose();
            if (e.material) e.material.dispose();
            this.scene.remove(e);
        }
        this.meshes = [];
        this.edges = [];
        this.selected = null;
        this.hovered = null;
    }

    _resize() {
        const w = this.host.clientWidth;
        const h = this.host.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    _flyStep(dt) {
        const speed = (this.keys.shift ? 28 : 12) * dt;

        // Horizontal movement uses a flattened forward vector so W always walks
        // along the ground regardless of where you're looking. Vertical is
        // handled separately by space / ctrl, same as the old version.
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();

        if (this.keys.w) this.camera.position.addScaledVector(forward, speed);
        if (this.keys.s) this.camera.position.addScaledVector(forward, -speed);
        if (this.keys.d) this.camera.position.addScaledVector(right, speed);
        if (this.keys.a) this.camera.position.addScaledVector(right, -speed);
        if (this.keys.space) this.camera.position.y += speed;
        if (this.keys.ctrl)  this.camera.position.y -= speed;

        // Soft floor so you can't walk below the grid.
        if (this.camera.position.y < 1.2) this.camera.position.y = 1.2;
    }

    _loop() {
        requestAnimationFrame(() => this._loop());
        const dt = Math.min(this.clock.getDelta(), 0.1);

        this._flyStep(dt);

        // Gentle wobble on the selected instruction so it's obvious.
        if (this.selected) {
            const t = performance.now() * 0.003;
            this.selected.rotation.y = Math.sin(t) * 0.25;
        }

        this.renderer.render(this.scene, this.camera);
    }
}

window.AssemblyViewer = AssemblyViewer;
