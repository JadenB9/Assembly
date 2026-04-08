// First-person 3D viewer for parsed assembly, with light combat and
// multiplayer when a server is reachable. The viewer falls back to a clean
// single-player experience if the websocket can't connect (e.g. on
// j4den.com where the page is served statically).
//
// Layout: each section becomes a vertical band. Instructions inside a
// section spiral around a column so you can walk between them. Jump
// instructions draw arcs to their label targets so control flow is visible.

const PALETTE = {
    section:  0x3a3a3a,
    label:    0xd4a050,
    move:     0x6a9955,
    arith:    0xd4a050,
    cmp:      0x569cd6,
    logic:    0x4ec9b0,
    jump:     0xd16969,
    sys:      0xc586c0,
    strop:    0xdcdcaa,
    data:     0x808080,
    directive:0x404040,
    other:    0x666666
};

// Layout tuning
const ROW_GAP = 1.5;
const SEC_GAP = 4.0;
const RADIUS  = 11;
const TURN    = 0.48;

// Combat tuning
const MAX_HEALTH       = 100;
const MAX_AMMO         = 50;
const START_AMMO       = 10;
const SHOT_COOLDOWN_MS = 180;
const RESPAWN_MS       = 5000;
const PROJECTILE_SPEED = 0.9;        // world units per simulation step
const PROJECTILE_LIFE  = 180;        // frames
const HIT_RADIUS       = 1.4;
const DAMAGE_PER_HIT   = 25;
const MOVE_TICK_MS     = 60;         // throttle cameraMove emissions

// Named socket hex colors we'll actually rely on for client palette
const AVATAR_COLORS = ['#d4a050', '#6a9955', '#569cd6', '#d16969', '#c586c0', '#4ec9b0', '#dcdcaa', '#9cdcfe'];

class AssemblyViewer {
    constructor(host) {
        this.host = host;
        this.nodes = [];
        this.meshes = [];
        this.edges = [];
        this.selected = null;
        this.hovered = null;

        // --- Scene ---
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);
        this.scene.fog = new THREE.Fog(0x0a0a0a, 40, 180);

        const w = host.clientWidth;
        const h = host.clientHeight;
        this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1200);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(w, h);
        host.appendChild(this.renderer.domElement);

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.clock = new THREE.Clock();

        // --- Input state ---
        this.keys = { w:false, a:false, s:false, d:false, space:false, ctrl:false, shift:false };
        this.lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.pointerLocked = false;
        this.homePos = new THREE.Vector3(25, 6, 25);
        this.homeLook = new THREE.Vector3(0, 2, 0);

        // --- Combat state ---
        this.health = MAX_HEALTH;
        this.ammo = START_AMMO;
        this.isDead = false;
        this.lastShotAt = 0;
        this.projectiles = [];
        this.respawnTimer = null;

        // --- Multiplayer state ---
        this.socket = null;
        this.self = null;
        this.multiplayerOnline = false;
        this.remote = new Map();           // id -> { data, group, label }
        this._lastMoveEmit = 0;

        // --- Callbacks for the host HTML to wire up ---
        this.onSelect = () => {};
        this.onStats = () => {};
        this.onHealth = () => {};
        this.onAmmo = () => {};
        this.onRoster = () => {};
        this.onStatus = () => {};
        this.onNotice = () => {};
        this.onShared = () => {};

        this._setupLights();
        this._setupGround();
        this._bindEvents();
        this._initMultiplayer();

        // Kick off render loop and seed UI
        this._loop();
    }

    // ===== Scene setup =====

    _setupLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
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

    // ===== Input / movement =====

    _bindEvents() {
        window.addEventListener('resize', () => this._resize());

        const dom = this.renderer.domElement;
        dom.addEventListener('pointermove', (e) => this._onPointerMove(e));
        dom.addEventListener('click', (e) => this._onClick(e));
        dom.addEventListener('contextmenu', (e) => e.preventDefault());

        document.addEventListener('pointerlockchange', () => {
            this.pointerLocked = document.pointerLockElement === dom;
            this._setCrosshair(this.pointerLocked);
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.pointerLocked || this.isDead) return;
            this.lookEuler.setFromQuaternion(this.camera.quaternion);
            this.lookEuler.y -= e.movementX * 0.0022;
            this.lookEuler.x -= e.movementY * 0.0022;
            this.lookEuler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.lookEuler.x));
            this.camera.quaternion.setFromEuler(this.lookEuler);
        });

        // Shooting also binds to the left mouse button when pointer-locked.
        document.addEventListener('mousedown', (e) => {
            if (!this.pointerLocked) return;
            if (e.button === 0) this.shoot();
        });

        const kd = (e) => this._onKey(e, true);
        const ku = (e) => this._onKey(e, false);
        document.addEventListener('keydown', kd);
        document.addEventListener('keyup', ku);
    }

    _onKey(e, down) {
        // Ignore key input while typing in form controls so the name input doesn't
        // accidentally fire shots or reload.
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

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
            case 'ShiftRight':
                this.keys.shift = down;
                break;
            case 'KeyR':
                if (down) this.reload();
                break;
            case 'KeyF':
                if (down) this.shoot();
                break;
            case 'Escape':
                if (down && this.pointerLocked) document.exitPointerLock();
                break;
        }
    }

    _setCrosshair(on) {
        const el = document.getElementById('crosshair');
        if (el) el.style.opacity = on ? '1' : '0';
    }

    _flyStep(dt) {
        if (this.isDead) return;

        const speed = (this.keys.shift ? 28 : 12) * dt;

        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();

        let moved = false;
        if (this.keys.w) { this.camera.position.addScaledVector(forward, speed); moved = true; }
        if (this.keys.s) { this.camera.position.addScaledVector(forward, -speed); moved = true; }
        if (this.keys.d) { this.camera.position.addScaledVector(right, speed); moved = true; }
        if (this.keys.a) { this.camera.position.addScaledVector(right, -speed); moved = true; }
        if (this.keys.space) { this.camera.position.y += speed; moved = true; }
        if (this.keys.ctrl)  { this.camera.position.y -= speed; moved = true; }

        if (this.camera.position.y < 1.2) this.camera.position.y = 1.2;

        if (moved && this.multiplayerOnline && this.self) {
            const now = performance.now();
            if (now - this._lastMoveEmit >= MOVE_TICK_MS) {
                this._lastMoveEmit = now;
                const p = this.camera.position;
                this.self.position = { x: p.x, y: p.y, z: p.z };
                this.socket.emit('move', this.self.position);
            }
        }
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
        if (this.pointerLocked) {
            // Crosshair raycast. If it hits an instruction, select it; if it
            // hits nothing, that's a fired shot.
            this.pointer.set(0, 0);
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const hits = this.raycaster.intersectObjects(this.meshes.filter(Boolean), false);
            if (hits.length) {
                this._select(hits[0].object);
            } else {
                this.shoot();
            }
            return;
        }

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.meshes.filter(Boolean), false);

        if (hits.length) {
            this._select(hits[0].object);
            return;
        }

        // Clicking empty space requests pointer lock AND fires a shot. Some
        // browsers (notably Brave with strict shields) refuse pointer lock —
        // firing on the same click ensures the user can still shoot.
        this.shoot();
        try { this.renderer.domElement.requestPointerLock(); } catch (_) {}
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

    resetView() {
        if (this.pointerLocked) document.exitPointerLock();
        this.camera.position.copy(this.homePos);
        const look = this.homeLook.clone();
        this.camera.lookAt(look);
        this.lookEuler.setFromQuaternion(this.camera.quaternion);
    }

    // ===== Load + layout =====

    load(source) {
        this._clear();
        const parser = new window.AssemblyParser();
        const { nodes } = parser.parse(source);
        this.nodes = nodes;

        let y = 0;
        let localIdx = 0;
        let currentSection = null;

        for (const node of nodes) {
            if (node.kind === 'section') {
                if (currentSection !== null) y += SEC_GAP;
                currentSection = node.section;
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

        for (const node of nodes) this.meshes.push(this._buildMesh(node));

        for (const node of nodes) {
            if (node.kind !== 'instruction' || node.targetIndex == null) continue;
            const t = nodes[node.targetIndex];
            if (!t || !t.pos) continue;
            this.edges.push(this._buildEdge(node.pos, t.pos));
        }

        // Drop the camera in near the first interesting node.
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

        // Sync position to server after a reload.
        if (this.multiplayerOnline && this.self) {
            const p = this.camera.position;
            this.self.position = { x: p.x, y: p.y, z: p.z };
            this.socket.emit('move', this.self.position);
        }

        this._emitStats();
    }

    _buildMesh(node) {
        const color = PALETTE[node.kind === 'instruction' ? node.category : node.kind] || PALETTE.other;
        let mesh;
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

    _clear() {
        for (const m of this.meshes) {
            if (!m) continue;
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

    _emitStats() {
        const counts = { instruction: 0, label: 0, section: 0, data: 0, directive: 0 };
        for (const n of this.nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;
        this.onStats(counts);
    }

    // ===== Combat =====

    shoot() {
        if (this.isDead) return;
        const now = performance.now();
        if (now - this.lastShotAt < SHOT_COOLDOWN_MS) return;
        if (this.ammo <= 0) return;
        this.lastShotAt = now;
        this.ammo--;
        this.onAmmo(this.ammo, MAX_AMMO);

        // Direction is whatever the camera is currently looking at.
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        // Spawn a bit in front so you don't see the origin point inside the camera.
        const origin = this.camera.position.clone().addScaledVector(dir, 0.6);

        this._spawnProjectile(origin, dir, true);
        this._muzzleFlash();

        if (this.multiplayerOnline && this.self) {
            this.socket.emit('shot', {
                origin: { x: origin.x, y: origin.y, z: origin.z },
                direction: { x: dir.x, y: dir.y, z: dir.z }
            });
        }
    }

    reload() {
        if (this.isDead) return;
        if (this.ammo >= MAX_AMMO) return;
        this.ammo = MAX_AMMO;
        this.onAmmo(this.ammo, MAX_AMMO);
        this.onNotice('reloaded', 800);
    }

    _spawnProjectile(origin, direction, isMine) {
        const geo = new THREE.SphereGeometry(0.1, 8, 8);
        const mat = new THREE.MeshBasicMaterial({
            color: isMine ? 0xd4a050 : 0xd16969
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(origin);

        const trailGeo = new THREE.CylinderGeometry(0.04, 0.16, 0.8, 8);
        const trailMat = new THREE.MeshBasicMaterial({
            color: isMine ? 0xd4a050 : 0xd16969,
            transparent: true,
            opacity: 0.35
        });
        const trail = new THREE.Mesh(trailGeo, trailMat);
        trail.rotation.x = Math.PI / 2;
        trail.position.z = 0.4;
        mesh.add(trail);
        mesh.lookAt(origin.clone().add(direction));

        mesh.userData = {
            dir: direction.clone().normalize(),
            life: PROJECTILE_LIFE,
            mine: !!isMine
        };

        this.scene.add(mesh);
        this.projectiles.push(mesh);
    }

    _updateProjectiles() {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.position.addScaledVector(p.userData.dir, PROJECTILE_SPEED);
            p.userData.life--;

            // Orient trail to direction of travel
            p.lookAt(p.position.clone().add(p.userData.dir));

            let consumed = false;

            // Only our own shots can score hits — the server is authoritative
            // for damage so remote projectiles are visual only.
            if (p.userData.mine) {
                for (const [id, entry] of this.remote) {
                    if (p.position.distanceTo(entry.group.position) < HIT_RADIUS) {
                        this._hitBurst(entry.group.position, 0xd4a050);
                        if (this.multiplayerOnline) {
                            this.socket.emit('hit', { target: id });
                        }
                        consumed = true;
                        break;
                    }
                }
            } else if (!this.isDead && p.position.distanceTo(this.camera.position) < HIT_RADIUS) {
                // Visual hit burst for incoming shots — damage comes from the
                // server's broadcast 'hit' event so we don't double-count.
                this._hitBurst(this.camera.position, 0xd16969);
                consumed = true;
            }

            if (consumed || p.userData.life <= 0) {
                if (p.geometry) p.geometry.dispose();
                if (p.material) p.material.dispose();
                this.scene.remove(p);
                this.projectiles.splice(i, 1);
            }
        }
    }

    _muzzleFlash() {
        const flashGeo = new THREE.SphereGeometry(0.25, 8, 8);
        const flashMat = new THREE.MeshBasicMaterial({
            color: 0xffd68a,
            transparent: true,
            opacity: 0.9
        });
        const flash = new THREE.Mesh(flashGeo, flashMat);

        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        flash.position.copy(this.camera.position).addScaledVector(dir, 0.8);
        this.scene.add(flash);

        let frames = 6;
        const tick = () => {
            frames--;
            flash.material.opacity *= 0.6;
            if (frames > 0) {
                requestAnimationFrame(tick);
            } else {
                flash.geometry.dispose();
                flash.material.dispose();
                this.scene.remove(flash);
            }
        };
        tick();
    }

    _hitBurst(position, colorHex) {
        const count = 10;
        const particles = [];
        for (let i = 0; i < count; i++) {
            const g = new THREE.SphereGeometry(0.06, 4, 4);
            const m = new THREE.MeshBasicMaterial({
                color: colorHex,
                transparent: true,
                opacity: 0.9
            });
            const mesh = new THREE.Mesh(g, m);
            mesh.position.copy(position);
            mesh.userData.dir = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize().multiplyScalar(0.15 + Math.random() * 0.2);
            mesh.userData.life = 25;
            this.scene.add(mesh);
            particles.push(mesh);
        }

        const step = () => {
            let alive = 0;
            for (const p of particles) {
                if (p.userData.life <= 0) continue;
                p.position.add(p.userData.dir);
                p.userData.life--;
                p.material.opacity = Math.max(0, p.userData.life / 25);
                if (p.userData.life <= 0) {
                    p.geometry.dispose();
                    p.material.dispose();
                    this.scene.remove(p);
                } else {
                    alive++;
                }
            }
            if (alive > 0) requestAnimationFrame(step);
        };
        step();
    }

    takeDamage(amount) {
        if (this.isDead) return;
        this.health = Math.max(0, this.health - amount);
        this.onHealth(this.health, MAX_HEALTH);
        this._damageFlash();
        if (this.health <= 0) this._die();
    }

    heal(amount) {
        if (this.isDead) return;
        this.health = Math.min(MAX_HEALTH, this.health + amount);
        this.onHealth(this.health, MAX_HEALTH);
    }

    _damageFlash() {
        let el = document.getElementById('damageOverlay');
        if (!el) return;
        el.style.opacity = '1';
        // Fade out via CSS transition
        requestAnimationFrame(() => { el.style.opacity = '0'; });
    }

    _die() {
        if (this.isDead) return;
        this.isDead = true;
        this.onHealth(0, MAX_HEALTH);
        this.onNotice('you died — respawn in 5s', RESPAWN_MS);
        if (this.pointerLocked) document.exitPointerLock();

        if (this.respawnTimer) clearTimeout(this.respawnTimer);
        this.respawnTimer = setTimeout(() => this._respawn(), RESPAWN_MS);
    }

    _respawn() {
        this.isDead = false;
        this.health = MAX_HEALTH;
        this.ammo = START_AMMO;
        this.onHealth(this.health, MAX_HEALTH);
        this.onAmmo(this.ammo, MAX_AMMO);

        // Nudge to a fresh spawn point near home.
        const jitter = (n) => (Math.random() - 0.5) * n;
        this.camera.position.set(
            this.homePos.x + jitter(6),
            this.homePos.y,
            this.homePos.z + jitter(6)
        );
        this.camera.lookAt(this.homeLook);
        this.lookEuler.setFromQuaternion(this.camera.quaternion);

        if (this.multiplayerOnline && this.self) {
            const p = this.camera.position;
            this.self.position = { x: p.x, y: p.y, z: p.z };
            this.socket.emit('move', this.self.position);
        }

        this.onNotice('respawned', 800);
    }

    // ===== Multiplayer =====

    _initMultiplayer() {
        // Always seed a local self so the roster has an entry even when there's
        // no server. This makes the player list show "(you)" instead of an
        // empty "single-player" placeholder.
        this._seedLocalSelf();

        if (typeof io !== 'function') {
            this.onStatus('single-player');
            this.onRoster(this._rosterSnapshot());
            return;
        }

        let socket;
        try {
            socket = io({
                reconnection: true,
                reconnectionAttempts: 3,
                reconnectionDelay: 1500,
                timeout: 4000,
                transports: ['websocket', 'polling']
            });
        } catch (err) {
            this.onStatus('single-player');
            this.onRoster(this._rosterSnapshot());
            return;
        }
        this.socket = socket;

        socket.on('connect', () => {
            this.multiplayerOnline = true;
            this.onStatus('online');
        });

        socket.on('connect_error', () => {
            // Fail silent — static hosts (j4den.com) expect this.
            this.multiplayerOnline = false;
            this.onStatus('single-player');
            this.onRoster(this._rosterSnapshot());
        });

        socket.on('disconnect', () => {
            this.multiplayerOnline = false;
            this.onStatus('disconnected');
        });

        socket.on('self', (user) => {
            // Keep the camera where the viewer already framed it — tell the
            // server our real position instead of teleporting to its spawn.
            this.self = user;
            const p = this.camera.position;
            this.self.position = { x: p.x, y: p.y, z: p.z };
            this.socket.emit('move', this.self.position);
            this.onRoster(this._rosterSnapshot());
        });

        socket.on('roster', (list) => {
            if (!Array.isArray(list)) return;
            for (const u of list) {
                try { this._addRemote(u); }
                catch (err) { console.error('addRemote failed', err); }
            }
            this.onRoster(this._rosterSnapshot());
        });

        socket.on('joined', (user) => {
            try { this._addRemote(user); }
            catch (err) { console.error('addRemote failed', err); }
            this.onRoster(this._rosterSnapshot());
            this.onNotice(`${user.name} joined`, 2000);
        });

        socket.on('left', (id) => {
            this._removeRemote(id);
            this.onRoster(this._rosterSnapshot());
        });

        socket.on('updated', (u) => {
            if (this.self && u.id === this.self.id) {
                this.self.name = u.name;
                this.self.color = u.color;
            }
            const entry = this.remote.get(u.id);
            if (entry) {
                entry.data.name = u.name;
                entry.data.color = u.color;
                this._relabelAvatar(entry);
            }
            this.onRoster(this._rosterSnapshot());
        });

        socket.on('moved', (data) => {
            const entry = this.remote.get(data.id);
            if (!entry) return;
            entry.data.position = data.position;
            entry.group.position.set(data.position.x, data.position.y, data.position.z);
        });

        socket.on('shot', (data) => {
            // A remote player fired. Spawn an enemy projectile locally.
            if (!data || !data.origin || !data.direction) return;
            const origin = new THREE.Vector3(data.origin.x, data.origin.y, data.origin.z);
            const dir = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z);
            this._spawnProjectile(origin, dir, false);
        });

        socket.on('hit', (data) => {
            if (!data) return;
            if (this.self && data.target === this.self.id) {
                // We got hit — server's hit event is authoritative for damage.
                this.takeDamage(DAMAGE_PER_HIT);
                this.onNotice(`hit by ${data.shooterName}`, 1500);
            } else {
                this.onNotice(`${data.shooterName} hit ${data.targetName}`, 1500);
            }
        });

        socket.on('code', (data) => {
            if (!data || typeof data.source !== 'string') return;
            if (this.self && data.by === this.self.id) return;
            this.onShared({ source: data.source, filename: data.filename, by: data.byName });
        });
    }

    _addRemote(user) {
        if (this.self && user.id === this.self.id) return;
        if (this.remote.has(user.id)) this._removeRemote(user.id);

        const group = new THREE.Group();
        const color = new THREE.Color(user.color || '#d4a050');

        const bodyMat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.5,
            metalness: 0.05,
            emissive: color.clone().multiplyScalar(0.2)
        });

        // Body: a cylinder torso with spherical caps so it reads clearly.
        // (Three.js r128 doesn't have CapsuleGeometry, so we compose one.)
        const torsoGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.4, 12);
        const torso = new THREE.Mesh(torsoGeo, bodyMat);
        torso.position.y = 0.2;
        group.add(torso);

        const capGeo = new THREE.SphereGeometry(0.45, 12, 10);
        const topCap = new THREE.Mesh(capGeo, bodyMat);
        topCap.position.y = 0.9;
        group.add(topCap);
        const bottomCap = new THREE.Mesh(capGeo, bodyMat);
        bottomCap.position.y = -0.5;
        group.add(bottomCap);

        // Head: small sphere on top.
        const headGeo = new THREE.SphereGeometry(0.32, 12, 12);
        const headMat = new THREE.MeshStandardMaterial({
            color: color.clone().multiplyScalar(1.15),
            roughness: 0.5,
            emissive: color.clone().multiplyScalar(0.25)
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.35;
        group.add(head);

        // Direction indicator — a thin prism pointing forward.
        const frontGeo = new THREE.BoxGeometry(0.2, 0.2, 0.5);
        const front = new THREE.Mesh(frontGeo, bodyMat);
        front.position.set(0, 1.35, 0.4);
        group.add(front);

        // Soft halo so the avatar stays visible against the dark scene.
        const glowGeo = new THREE.SphereGeometry(1.4, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.12,
            side: THREE.BackSide
        });
        group.add(new THREE.Mesh(glowGeo, glowMat));

        const p = user.position || { x: 0, y: 4, z: 0 };
        group.position.set(p.x, p.y, p.z);
        this.scene.add(group);

        const entry = { data: user, group, label: null };
        this._relabelAvatar(entry);
        this.remote.set(user.id, entry);
    }

    _relabelAvatar(entry) {
        // Remove existing label sprite so we don't leak.
        if (entry.label) {
            if (entry.label.material && entry.label.material.map) entry.label.material.map.dispose();
            if (entry.label.material) entry.label.material.dispose();
            entry.group.remove(entry.label);
            entry.label = null;
        }

        const canvas = document.createElement('canvas');
        canvas.width = 384;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');

        const text = entry.data.name || 'anon';
        const color = entry.data.color || '#d4a050';
        ctx.font = '40px "JetBrains Mono", "Fira Code", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const metrics = ctx.measureText(text);
        const boxW = Math.min(canvas.width - 4, metrics.width + 18);
        const boxH = 60;
        const boxX = (canvas.width - boxW) / 2;
        const boxY = (canvas.height - boxH) / 2;

        ctx.fillStyle = 'rgba(12,12,12,0.82)';
        this._roundRect(ctx, boxX, boxY, boxW, boxH, 8);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        this._roundRect(ctx, boxX + 1, boxY + 1, boxW - 2, boxH - 2, 8);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthWrite: false
        }));
        sprite.scale.set(3.5, 0.88, 1);
        sprite.position.set(0, 2.2, 0);
        sprite.renderOrder = 3;
        entry.group.add(sprite);
        entry.label = sprite;
    }

    _removeRemote(id) {
        const entry = this.remote.get(id);
        if (!entry) return;
        entry.group.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (obj.material.map) obj.material.map.dispose();
                obj.material.dispose();
            }
        });
        this.scene.remove(entry.group);
        this.remote.delete(id);
    }

    _rosterSnapshot() {
        const list = [];
        if (this.self) list.push({ ...this.self, self: true });
        for (const [, entry] of this.remote) list.push({ ...entry.data, self: false });
        return list;
    }

    _seedLocalSelf() {
        if (this.self) return;
        const palette = AVATAR_COLORS;
        this.self = {
            id: 'local',
            name: 'you',
            color: palette[Math.floor(Math.random() * palette.length)],
            position: { x: 0, y: 0, z: 0 }
        };
    }

    setName(newName) {
        const clean = (newName || '').trim().slice(0, 24);
        if (!clean) return;

        if (this.multiplayerOnline && this.socket) {
            // Multiplayer: server is authoritative — it'll echo back via 'updated'.
            this.socket.emit('rename', clean);
            return;
        }

        // Single-player: keep the name purely local for the roster UI.
        if (!this.self) {
            this.self = { id: 'local', name: clean, color: '#d4a050', position: { x: 0, y: 0, z: 0 } };
        } else {
            this.self.name = clean;
        }
        this.onRoster(this._rosterSnapshot());
    }

    shareCode(source, filename) {
        if (!this.multiplayerOnline || !this.socket) return;
        this.socket.emit('code', { source, filename: filename || 'shared.asm' });
    }

    // ===== Loop =====

    _resize() {
        const w = this.host.clientWidth;
        const h = this.host.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    _loop() {
        requestAnimationFrame(() => this._loop());
        const dt = Math.min(this.clock.getDelta(), 0.1);

        this._flyStep(dt);
        this._updateProjectiles();

        // Selected instruction wobble
        if (this.selected) {
            const t = performance.now() * 0.003;
            this.selected.rotation.y = Math.sin(t) * 0.25;
        }

        // Avatars slowly rotate so you can tell they're alive.
        for (const [, entry] of this.remote) {
            entry.group.rotation.y += 0.008;
        }

        this.renderer.render(this.scene, this.camera);
    }
}

window.AssemblyViewer = AssemblyViewer;
