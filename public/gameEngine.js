class AssemblyGameEngine {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.instructions = [];
        this.meshes = [];
        this.selectedObject = null;
        this.parser = new AssemblyParser();
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.animationMixer = null;
        this.clock = new THREE.Clock();
        
        // Multiplayer properties
        this.socket = null;
        this.currentUser = null;
        this.otherUsers = new Map();
        this.userAvatars = new Map();
        this.myAvatar = null;
        
        // Movement properties
        this.moveSpeed = 0.5;
        this.flySpeed = 0.3;
        this.cameraOffset = new THREE.Vector3(0, 5, 8);
        this.keys = {
            w: false,
            a: false,
            s: false,
            d: false,
            space: false,
            shift: false,
            r: false,
            cmd: false
        };
        
        // Mouse look properties
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.PI_2 = Math.PI / 2;
        this.mouseSensitivity = 0.002;
        this.pointerLocked = false;
        
        // Shooting properties
        this.ammo = 10;
        this.maxAmmo = 50;
        this.projectiles = [];
        this.projectileSpeed = 2;
        this.lastShot = 0;
        this.shotCooldown = 200; // milliseconds
        
        // Health properties
        this.health = 100;
        this.maxHealth = 100;
        this.isDead = false;
        this.respawnTime = 5000; // 5 seconds
        
        this.init();
    }
    
    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 10, 20);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.getElementById('gameContainer').appendChild(this.renderer.domElement);
        
        this.setupLighting();
        this.setupControls();
        this.setupEventListeners();
        this.createEnvironment();
        this.initMultiplayer();
        
        this.animate();
    }
    
    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
        
        const spotLight = new THREE.SpotLight(0x00ff00, 0.5);
        spotLight.position.set(0, 30, 0);
        spotLight.castShadow = true;
        this.scene.add(spotLight);
    }
    
    setupControls() {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.enableZoom = true;
        this.controls.autoRotate = false;
        
        // Disable controls initially for character movement
        this.controls.enabled = false;
    }
    
    setupEventListeners() {
        window.addEventListener('resize', () => this.onWindowResize());
        this.renderer.domElement.addEventListener('click', (event) => this.onMouseClick(event));
        this.renderer.domElement.addEventListener('mousemove', (event) => this.onMouseMove(event));
        
        // Pointer lock for mouse look
        this.renderer.domElement.addEventListener('click', () => {
            if (!this.pointerLocked) {
                this.renderer.domElement.requestPointerLock();
            }
        });
        
        document.addEventListener('pointerlockchange', () => {
            this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
            const crosshair = document.getElementById('crosshair');
            if (crosshair) {
                crosshair.style.display = this.pointerLocked ? 'block' : 'none';
            }
        });
        
        document.addEventListener('mousemove', (event) => {
            if (this.pointerLocked) {
                this.onMouseLook(event);
            }
        });
        
        document.addEventListener('keydown', (event) => {
            switch(event.code) {
                case 'KeyW':
                    this.keys.w = true;
                    break;
                case 'KeyS':
                    this.keys.s = true;
                    break;
                case 'KeyA':
                    this.keys.a = true;
                    break;
                case 'KeyD':
                    this.keys.d = true;
                    break;
                case 'Space':
                    event.preventDefault();
                    this.keys.space = true;
                    break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    event.preventDefault();
                    this.keys.shift = true;
                    this.shoot();
                    break;
                case 'KeyR':
                    event.preventDefault();
                    this.keys.r = true;
                    this.reload();
                    break;
                case 'Escape':
                    if (this.pointerLocked) {
                        document.exitPointerLock();
                    }
                    break;
                case 'MetaLeft':
                case 'MetaRight':
                    event.preventDefault();
                    this.keys.cmd = true;
                    break;
            }
        });
        
        document.addEventListener('keyup', (event) => {
            switch(event.code) {
                case 'KeyW':
                    this.keys.w = false;
                    break;
                case 'KeyS':
                    this.keys.s = false;
                    break;
                case 'KeyA':
                    this.keys.a = false;
                    break;
                case 'KeyD':
                    this.keys.d = false;
                    break;
                case 'Space':
                    this.keys.space = false;
                    break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.keys.shift = false;
                    break;
                case 'KeyR':
                    this.keys.r = false;
                    break;
                case 'MetaLeft':
                case 'MetaRight':
                    this.keys.cmd = false;
                    break;
            }
        });
    }
    
    createEnvironment() {
        const gridHelper = new THREE.GridHelper(100, 50, 0x444444, 0x222222);
        this.scene.add(gridHelper);
        
        const axesHelper = new THREE.AxesHelper(10);
        this.scene.add(axesHelper);
        
        const geometry = new THREE.PlaneGeometry(100, 100);
        const material = new THREE.MeshLambertMaterial({ color: 0x111111, transparent: true, opacity: 0.3 });
        const plane = new THREE.Mesh(geometry, material);
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        this.scene.add(plane);
    }
    
    loadAssemblyCode(asmCode) {
        this.clearScene();
        const parsed = this.parser.parse(asmCode);
        this.instructions = parsed.instructions;
        
        this.instructions.forEach((instruction, index) => {
            this.createInstructionMesh(instruction, index);
        });
        
        this.createDataFlow();
    }
    
    createInstructionMesh(instruction, index) {
        let geometry, material, mesh;
        
        switch(instruction.type) {
            case 'instruction':
                geometry = new THREE.BoxGeometry(2, 0.5, 1);
                break;
            case 'label':
                geometry = new THREE.ConeGeometry(0.5, 2, 8);
                break;
            case 'section':
                geometry = new THREE.CylinderGeometry(1, 1, 0.3, 16);
                break;
            default:
                geometry = new THREE.SphereGeometry(0.5, 8, 6);
        }
        
        const color = this.parser.getInstructionColor(instruction.type);
        material = new THREE.MeshPhongMaterial({ 
            color: color,
            transparent: true,
            opacity: 0.8
        });
        
        mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
            instruction.position.x,
            instruction.position.y,
            instruction.position.z
        );
        
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { instruction: instruction, index: index };
        
        this.scene.add(mesh);
        this.meshes.push(mesh);
        
        this.addInstructionText(mesh, instruction);
        this.addGlowEffect(mesh);
    }
    
    addInstructionText(mesh, instruction) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 512;
        canvas.height = 128;
        
        context.fillStyle = 'rgba(0, 0, 0, 0.8)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        context.fillStyle = 'white';
        context.font = '24px Arial';
        context.textAlign = 'center';
        context.fillText(instruction.original, canvas.width / 2, canvas.height / 2);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        
        sprite.position.set(0, 1.5, 0);
        sprite.scale.set(4, 1, 1);
        mesh.add(sprite);
    }
    
    addGlowEffect(mesh) {
        const glowGeometry = mesh.geometry.clone();
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: mesh.material.color,
            transparent: true,
            opacity: 0.2,
            side: THREE.BackSide
        });
        
        const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        glowMesh.scale.set(1.2, 1.2, 1.2);
        mesh.add(glowMesh);
    }
    
    createDataFlow() {
        for (let i = 0; i < this.meshes.length - 1; i++) {
            const startPos = this.meshes[i].position;
            const endPos = this.meshes[i + 1].position;
            
            const curve = new THREE.QuadraticBezierCurve3(
                startPos,
                new THREE.Vector3(
                    (startPos.x + endPos.x) / 2,
                    Math.max(startPos.y, endPos.y) + 2,
                    (startPos.z + endPos.z) / 2
                ),
                endPos
            );
            
            const points = curve.getPoints(50);
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ 
                color: 0x00ffff, 
                transparent: true, 
                opacity: 0.6 
            });
            
            const line = new THREE.Line(geometry, material);
            this.scene.add(line);
        }
    }
    
    onMouseClick(event) {
        // Only handle clicks when pointer is locked for ammo collection
        if (!this.pointerLocked) return;
        
        // Check if clicking on assembly instruction for ammo
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera); // Use center of screen
        const intersects = this.raycaster.intersectObjects(this.meshes);
        
        if (intersects.length > 0) {
            if (this.selectedObject) {
                this.selectedObject.material.emissive.setHex(0x000000);
            }
            
            this.selectedObject = intersects[0].object;
            this.selectedObject.material.emissive.setHex(0x555555);
            
            const instruction = this.selectedObject.userData.instruction;
            this.collectAmmo(instruction);
            this.showInstructionDetails(instruction);
            this.animateToInstruction(this.selectedObject);
        }
    }
    
    onMouseLook(event) {
        if (!this.pointerLocked) return;
        
        const movementX = event.movementX || 0;
        const movementY = event.movementY || 0;
        
        this.euler.setFromQuaternion(this.camera.quaternion);
        this.euler.y -= movementX * this.mouseSensitivity;
        this.euler.x -= movementY * this.mouseSensitivity;
        this.euler.x = Math.max(-this.PI_2, Math.min(this.PI_2, this.euler.x));
        
        this.camera.quaternion.setFromEuler(this.euler);
    }
    
    shoot() {
        const now = Date.now();
        if (now - this.lastShot < this.shotCooldown || this.ammo <= 0 || !this.pointerLocked) {
            return;
        }
        
        this.lastShot = now;
        this.ammo--;
        this.updateAmmoDisplay();
        
        // Shoot from center of screen (crosshair position)
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const direction = this.raycaster.ray.direction.clone();
        
        // Create projectile
        const projectile = this.createProjectile(this.camera.position.clone(), direction);
        this.projectiles.push(projectile);
        
        // Send shot to server
        if (this.socket) {
            this.socket.emit('playerShot', {
                position: this.camera.position,
                direction: direction,
                shooter: this.currentUser.id
            });
        }
        
        // Play shoot sound effect (visual feedback)
        this.createMuzzleFlash();
    }
    
    reload() {
        if (this.ammo < this.maxAmmo) {
            this.ammo = this.maxAmmo;
            this.updateAmmoDisplay();
            
            // Visual feedback
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 40%;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(255, 255, 0, 0.9);
                color: black;
                padding: 5px 15px;
                border-radius: 5px;
                z-index: 9999;
                font-weight: bold;
                font-size: 16px;
            `;
            notification.textContent = 'RELOADED!';
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 1000);
        }
    }
    
    collectAmmo(instruction) {
        if (instruction && this.ammo < this.maxAmmo) {
            const ammoGain = Math.floor(Math.random() * 3) + 1; // 1-3 ammo
            this.ammo = Math.min(this.ammo + ammoGain, this.maxAmmo);
            this.updateAmmoDisplay();
            
            // Visual feedback
            this.showAmmoPickup(ammoGain);
        }
    }
    
    onMouseMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.meshes);
        
        this.meshes.forEach(mesh => {
            if (mesh !== this.selectedObject) {
                mesh.material.emissive.setHex(0x000000);
            }
        });
        
        if (intersects.length > 0 && intersects[0].object !== this.selectedObject) {
            intersects[0].object.material.emissive.setHex(0x333333);
        }
    }
    
    showInstructionDetails(instruction) {
        const detailsDiv = document.getElementById('instructionDetails');
        detailsDiv.innerHTML = `
            <h3>${instruction.original}</h3>
            <p><strong>Type:</strong> ${instruction.type}</p>
            <p><strong>Line:</strong> ${instruction.line + 1}</p>
            ${instruction.opcode ? `<p><strong>Opcode:</strong> ${instruction.opcode}</p>` : ''}
            ${instruction.operands ? `<p><strong>Operands:</strong> ${instruction.operands.join(', ')}</p>` : ''}
            ${instruction.section ? `<p><strong>Section:</strong> ${instruction.section}</p>` : ''}
            <p><strong>Instruction Type:</strong> ${instruction.instructionType || 'N/A'}</p>
        `;
        detailsDiv.style.display = 'block';
    }
    
    animateToInstruction(mesh) {
        const targetPosition = mesh.position.clone();
        targetPosition.add(new THREE.Vector3(5, 5, 5));
        
        const tween = new TWEEN.Tween(this.camera.position)
            .to(targetPosition, 1000)
            .easing(TWEEN.Easing.Quadratic.Out)
            .start();
        
        mesh.rotation.y += Math.PI * 2;
    }
    
    toggleAnimation() {
        this.meshes.forEach((mesh, index) => {
            const tween = new TWEEN.Tween(mesh.rotation)
                .to({ y: mesh.rotation.y + Math.PI * 2 }, 2000)
                .delay(index * 100)
                .easing(TWEEN.Easing.Elastic.Out)
                .start();
        });
    }
    
    clearScene() {
        this.meshes.forEach(mesh => {
            this.scene.remove(mesh);
        });
        this.meshes = [];
        this.selectedObject = null;
    }
    
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (typeof TWEEN !== 'undefined') {
            TWEEN.update();
        }
        
        // Only update controls if they're enabled
        if (this.controls.enabled) {
            this.controls.update();
        }
        
        this.meshes.forEach((mesh, index) => {
            mesh.rotation.y += 0.005;
            mesh.position.y += Math.sin(Date.now() * 0.001 + index) * 0.01;
        });
        
        this.updateUserPositions();
        this.updateProjectiles();
        this.renderer.render(this.scene, this.camera);
    }
    
    createProjectile(position, direction) {
        const geometry = new THREE.SphereGeometry(0.05, 8, 8);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0x00ffff,
            emissive: 0x004444
        });
        
        const projectile = new THREE.Mesh(geometry, material);
        projectile.position.copy(position);
        
        // Add trail effect
        const trailGeometry = new THREE.CylinderGeometry(0.02, 0.08, 0.3, 8);
        const trailMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.6
        });
        const trail = new THREE.Mesh(trailGeometry, trailMaterial);
        trail.position.set(0, 0, 0);
        projectile.add(trail);
        
        projectile.userData = {
            direction: direction,
            speed: this.projectileSpeed,
            life: 100, // frames
            shooter: this.currentUser?.id
        };
        
        this.scene.add(projectile);
        return projectile;
    }
    
    updateProjectiles() {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const projectile = this.projectiles[i];
            const userData = projectile.userData;
            
            // Move projectile
            projectile.position.add(
                userData.direction.clone().multiplyScalar(userData.speed)
            );
            
            // Check collision with avatars
            this.checkProjectileCollisions(projectile);
            
            // Remove if life expired
            userData.life--;
            if (userData.life <= 0) {
                this.scene.remove(projectile);
                this.projectiles.splice(i, 1);
            }
        }
    }
    
    checkProjectileCollisions(projectile) {
        const projectilePos = projectile.position;
        
        // Check collision with other players
        this.userAvatars.forEach((avatar, userId) => {
            if (userId !== projectile.userData.shooter) {
                const distance = projectilePos.distanceTo(avatar.position);
                if (distance < 1) {
                    // Hit!
                    this.createHitEffect(avatar.position);
                    
                    // Send hit to server
                    if (this.socket) {
                        this.socket.emit('playerHit', {
                            target: userId,
                            shooter: projectile.userData.shooter,
                            position: avatar.position
                        });
                    }
                    
                    // Remove projectile
                    this.scene.remove(projectile);
                    const index = this.projectiles.indexOf(projectile);
                    if (index > -1) {
                        this.projectiles.splice(index, 1);
                    }
                }
            }
        });
    }
    
    createMuzzleFlash() {
        if (!this.myAvatar) return;
        
        const flashGeometry = new THREE.SphereGeometry(0.3, 8, 8);
        const flashMaterial = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.8
        });
        
        const flash = new THREE.Mesh(flashGeometry, flashMaterial);
        flash.position.copy(this.myAvatar.position);
        flash.position.add(new THREE.Vector3(0.5, 0.5, 0));
        
        this.scene.add(flash);
        
        // Remove after short time
        setTimeout(() => {
            this.scene.remove(flash);
        }, 100);
    }
    
    createHitEffect(position) {
        const particles = [];
        
        for (let i = 0; i < 8; i++) {
            const particleGeometry = new THREE.SphereGeometry(0.05, 4, 4);
            const particleMaterial = new THREE.MeshBasicMaterial({
                color: 0xff4444,
                transparent: true,
                opacity: 0.8
            });
            
            const particle = new THREE.Mesh(particleGeometry, particleMaterial);
            particle.position.copy(position);
            
            const direction = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize();
            
            particle.userData = {
                direction: direction,
                speed: Math.random() * 0.5 + 0.2,
                life: 30
            };
            
            this.scene.add(particle);
            particles.push(particle);
        }
        
        // Animate particles
        const animateParticles = () => {
            for (let i = particles.length - 1; i >= 0; i--) {
                const particle = particles[i];
                const userData = particle.userData;
                
                particle.position.add(
                    userData.direction.clone().multiplyScalar(userData.speed)
                );
                
                userData.life--;
                particle.material.opacity = userData.life / 30;
                
                if (userData.life <= 0) {
                    this.scene.remove(particle);
                    particles.splice(i, 1);
                }
            }
            
            if (particles.length > 0) {
                requestAnimationFrame(animateParticles);
            }
        };
        
        animateParticles();
    }
    
    updateAmmoDisplay() {
        const ammoElement = document.getElementById('ammoCount');
        if (ammoElement) {
            ammoElement.textContent = `${this.ammo}/${this.maxAmmo}`;
        }
    }
    
    updateHealthDisplay() {
        const healthFill = document.getElementById('healthFill');
        const healthText = document.getElementById('healthText');
        
        if (healthFill && healthText) {
            const healthPercent = (this.health / this.maxHealth) * 100;
            healthFill.style.width = `${healthPercent}%`;
            healthText.textContent = `${this.health}/${this.maxHealth}`;
            
            // Change color based on health
            if (healthPercent > 60) {
                healthFill.style.background = '#00ff00';
            } else if (healthPercent > 30) {
                healthFill.style.background = '#ffff00';
            } else {
                healthFill.style.background = '#ff0000';
            }
        }
    }
    
    takeDamage(damage) {
        if (this.isDead) return;
        
        this.health -= damage;
        if (this.health <= 0) {
            this.health = 0;
            this.die();
        }
        
        this.updateHealthDisplay();
        
        // Visual damage feedback
        this.createDamageEffect();
    }
    
    heal(amount) {
        if (this.isDead) return;
        
        this.health = Math.min(this.health + amount, this.maxHealth);
        this.updateHealthDisplay();
    }
    
    die() {
        this.isDead = true;
        this.health = 0;
        this.updateHealthDisplay();
        
        // Death animation
        this.createDeathAnimation();
        
        // Respawn after delay
        setTimeout(() => {
            this.respawn();
        }, this.respawnTime);
        
        // Show death message
        this.showDeathMessage();
    }
    
    respawn() {
        this.isDead = false;
        this.health = this.maxHealth;
        this.ammo = 10;
        
        // Reset position
        this.currentUser.position.x = Math.random() * 20 - 10;
        this.currentUser.position.y = 10;
        this.currentUser.position.z = Math.random() * 20 - 10;
        
        if (this.myAvatar) {
            this.myAvatar.position.copy(this.currentUser.position);
            this.myAvatar.visible = true;
        }
        
        this.updateHealthDisplay();
        this.updateAmmoDisplay();
        
        // Show respawn message
        this.showRespawnMessage();
    }
    
    createDamageEffect() {
        // Red screen flash
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 0, 0, 0.3);
            z-index: 999;
            pointer-events: none;
        `;
        document.body.appendChild(overlay);
        
        setTimeout(() => {
            if (overlay.parentNode) {
                document.body.removeChild(overlay);
            }
        }, 200);
    }
    
    createDeathAnimation() {
        if (!this.myAvatar) return;
        
        // Death animation - avatar falls and fades
        if (typeof TWEEN !== 'undefined') {
            const deathTween = new TWEEN.Tween(this.myAvatar.position)
                .to({ y: this.myAvatar.position.y - 5 }, 2000)
                .easing(TWEEN.Easing.Quadratic.In)
                .start();
                
            // Fade all children of the avatar group
            this.myAvatar.children.forEach(child => {
                if (child.material) {
                    new TWEEN.Tween(child.material)
                        .to({ opacity: 0 }, 2000)
                        .easing(TWEEN.Easing.Quadratic.Out)
                        .start();
                }
            });
            
            setTimeout(() => {
                this.myAvatar.visible = false;
            }, 2000);
        } else {
            // Fallback without TWEEN
            this.myAvatar.visible = false;
        }
    }
    
    showDeathMessage() {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255, 0, 0, 0.9);
            color: white;
            padding: 20px 40px;
            border-radius: 10px;
            z-index: 9999;
            font-weight: bold;
            font-size: 24px;
            text-align: center;
        `;
        notification.textContent = 'YOU DIED!\nRespawning in 5 seconds...';
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, this.respawnTime);
    }
    
    showRespawnMessage() {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 255, 0, 0.9);
            color: black;
            padding: 15px 30px;
            border-radius: 8px;
            z-index: 9999;
            font-weight: bold;
            font-size: 18px;
        `;
        notification.textContent = 'RESPAWNED!';
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 2000);
    }
    
    showAmmoPickup(amount) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 30%;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 255, 255, 0.9);
            color: black;
            padding: 5px 15px;
            border-radius: 5px;
            z-index: 9999;
            font-weight: bold;
            font-size: 14px;
        `;
        notification.textContent = `+${amount} Ammo!`;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 1500);
    }
    
    // Multiplayer methods
    initMultiplayer() {
        try {
            this.socket = io();
            
            this.socket.on('userAssigned', (userData) => {
                this.currentUser = userData;
                this.createMyAvatar(userData);
                console.log('Assigned user:', userData);
            });
            
            this.socket.on('usersList', (users) => {
                console.log('Received usersList:', users, 'currentUser:', this.currentUser);
                users.forEach(user => {
                    // Only exclude if currentUser exists and IDs match
                    if (!this.currentUser || user.id !== this.currentUser.id) {
                        this.otherUsers.set(user.id, user);
                        this.createUserAvatar(user);
                        console.log('Created avatar for user:', user.name, 'at position:', user.position);
                    }
                });
                this.updateUsersList();
            });
            
            this.socket.on('userJoined', (userData) => {
                if (userData.id !== this.currentUser?.id) {
                    this.otherUsers.set(userData.id, userData);
                    this.createUserAvatar(userData);
                    this.updateUsersList();
                    console.log('User joined:', userData.name);
                }
            });
            
            this.socket.on('userLeft', (userId) => {
                this.otherUsers.delete(userId);
                this.removeUserAvatar(userId);
                this.updateUsersList();
            });
            
            this.socket.on('userUpdated', (userData) => {
                if (userData.id === this.currentUser?.id) {
                    // Update current user data
                    this.currentUser = userData;
                    this.updateMyAvatarName(userData.name, userData.color);
                } else {
                    // Update other user data
                    this.otherUsers.set(userData.id, userData);
                    this.updateUserNameLabel(userData.id, userData.name, userData.color);
                }
                this.updateUsersList();
                console.log('User updated:', userData.name);
            });
            
            this.socket.on('userMoved', (data) => {
                console.log('User moved:', data.id, 'to position:', data.position);
                if (this.otherUsers.has(data.id)) {
                    this.otherUsers.get(data.id).position = data.position;
                    this.updateUserAvatar(data.id, data.position);
                } else {
                    console.warn('Received movement for unknown user:', data.id);
                }
            });
            
            this.socket.on('codeShared', (data) => {
                this.showCodeShareNotification(data);
            });
            
            this.socket.on('userInteracted', (data) => {
                this.showUserInteraction(data);
            });
            
            this.socket.on('playerShotReceived', (data) => {
                this.createOtherPlayerProjectile(data);
            });
            
            this.socket.on('playerHitReceived', (data) => {
                this.showHitNotification(data);
                if (data.target === this.currentUser?.id) {
                    this.createHitEffect(this.myAvatar.position);
                }
            });
            
            this.socket.on('sharedCodeLoaded', (data) => {
                if (data.loader !== this.currentUser?.id) {
                    this.loadSharedCode(data);
                }
            });
            
            // Position updates are now sent from updateUserPositions when movement occurs
            
        } catch (error) {
            console.warn('Socket.IO not available, running in single-player mode');
        }
    }
    
    createUserAvatar(userData) {
        console.log('Creating avatar for user:', userData.name, 'at position:', userData.position);
        
        // Remove existing avatar if it exists
        if (this.userAvatars.has(userData.id)) {
            this.removeUserAvatar(userData.id);
        }
        
        // Create human-like flying avatar
        const avatarGroup = new THREE.Group();
        
        // Body (capsule shape)
        const bodyGeometry = new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);
        const bodyMaterial = new THREE.MeshPhongMaterial({ 
            color: userData.color,
            transparent: true,
            opacity: 0.8
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.rotation.x = Math.PI / 2; // Make it upright
        avatarGroup.add(body);
        
        // Head
        const headGeometry = new THREE.SphereGeometry(0.25, 8, 8);
        const headMaterial = new THREE.MeshPhongMaterial({ 
            color: new THREE.Color(userData.color).multiplyScalar(1.2),
            transparent: true,
            opacity: 0.9
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.set(0, 0.8, 0);
        avatarGroup.add(head);
        
        // Arms (flying position)
        const armGeometry = new THREE.CapsuleGeometry(0.1, 0.6, 4, 8);
        const armMaterial = new THREE.MeshPhongMaterial({ color: userData.color });
        
        const leftArm = new THREE.Mesh(armGeometry, armMaterial);
        leftArm.position.set(-0.5, 0.3, 0);
        leftArm.rotation.z = Math.PI / 4; // Extended flying pose
        avatarGroup.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeometry, armMaterial);
        rightArm.position.set(0.5, 0.3, 0);
        rightArm.rotation.z = -Math.PI / 4; // Extended flying pose
        avatarGroup.add(rightArm);
        
        // Legs (flying position)
        const legGeometry = new THREE.CapsuleGeometry(0.12, 0.8, 4, 8);
        const legMaterial = new THREE.MeshPhongMaterial({ color: userData.color });
        
        const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
        leftLeg.position.set(-0.2, -0.8, 0);
        leftLeg.rotation.x = Math.PI / 6; // Slight bend for flying
        avatarGroup.add(leftLeg);
        
        const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
        rightLeg.position.set(0.2, -0.8, 0);
        rightLeg.rotation.x = Math.PI / 6; // Slight bend for flying
        avatarGroup.add(rightLeg);
        
        // Ensure position is valid, use defaults if not
        const posX = userData.position?.x || 0;
        const posY = userData.position?.y || 5;
        const posZ = userData.position?.z || 0;
        
        avatarGroup.position.set(posX, posY, posZ);
        
        // Ensure avatar is visible
        avatarGroup.visible = true;
        
        // Make sure avatar is within reasonable bounds
        if (Math.abs(posX) > 1000 || Math.abs(posZ) > 1000) {
            console.warn('Avatar position seems out of bounds:', posX, posY, posZ);
        }
        
        // Add glow effect
        const glowGeometry = new THREE.SphereGeometry(1, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: userData.color,
            transparent: true,
            opacity: 0.2,
            side: THREE.BackSide
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        avatarGroup.add(glow);
        
        // Add name label
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;
        
        context.fillStyle = 'rgba(0, 0, 0, 0.8)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        context.fillStyle = userData.color;
        context.font = '16px Arial';
        context.textAlign = 'center';
        context.fillText(userData.name, canvas.width / 2, canvas.height / 2);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        
        sprite.position.set(0, 2, 0);
        sprite.scale.set(2, 0.5, 1);
        avatarGroup.add(sprite);
        
        this.scene.add(avatarGroup);
        this.userAvatars.set(userData.id, avatarGroup);
        
        console.log('Avatar added to scene for user:', userData.name, 'Total avatars:', this.userAvatars.size);
        console.log('Avatar position:', avatarGroup.position.x, avatarGroup.position.y, avatarGroup.position.z);
    }
    
    createMyAvatar(userData) {
        // Create enhanced human-like flying avatar for self
        this.myAvatar = new THREE.Group();
        
        // Body (larger and more detailed)
        const bodyGeometry = new THREE.CapsuleGeometry(0.4, 1.5, 6, 12);
        const bodyMaterial = new THREE.MeshPhongMaterial({ 
            color: userData.color,
            transparent: true,
            opacity: 0.9,
            emissive: new THREE.Color(userData.color).multiplyScalar(0.3)
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.rotation.x = Math.PI / 2;
        this.myAvatar.add(body);
        
        // Head (slightly larger)
        const headGeometry = new THREE.SphereGeometry(0.3, 12, 12);
        const headMaterial = new THREE.MeshPhongMaterial({ 
            color: new THREE.Color(userData.color).multiplyScalar(1.3),
            transparent: true,
            opacity: 0.95,
            emissive: new THREE.Color(userData.color).multiplyScalar(0.2)
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.set(0, 1, 0);
        this.myAvatar.add(head);
        
        // Arms with weapon glow
        const armGeometry = new THREE.CapsuleGeometry(0.12, 0.7, 6, 8);
        const armMaterial = new THREE.MeshPhongMaterial({ 
            color: userData.color,
            emissive: new THREE.Color(userData.color).multiplyScalar(0.1)
        });
        
        const leftArm = new THREE.Mesh(armGeometry, armMaterial);
        leftArm.position.set(-0.6, 0.4, 0);
        leftArm.rotation.z = Math.PI / 3;
        this.myAvatar.add(leftArm);
        
        const rightArm = new THREE.Mesh(armGeometry, armMaterial);
        rightArm.position.set(0.6, 0.4, 0);
        rightArm.rotation.z = -Math.PI / 3;
        this.myAvatar.add(rightArm);
        
        // Legs
        const legGeometry = new THREE.CapsuleGeometry(0.15, 0.9, 6, 8);
        const legMaterial = new THREE.MeshPhongMaterial({ color: userData.color });
        
        const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
        leftLeg.position.set(-0.25, -0.9, 0);
        leftLeg.rotation.x = Math.PI / 6;
        this.myAvatar.add(leftLeg);
        
        const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
        rightLeg.position.set(0.25, -0.9, 0);
        rightLeg.rotation.x = Math.PI / 6;
        this.myAvatar.add(rightLeg);
        
        this.myAvatar.position.set(
            userData.position.x,
            userData.position.y,
            userData.position.z
        );
        
        // Enhanced glow effect
        const glowGeometry = new THREE.SphereGeometry(1.2, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: userData.color,
            transparent: true,
            opacity: 0.4,
            side: THREE.BackSide
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.myAvatar.add(glow);
        
        // Add name label with special styling for self
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;
        
        context.fillStyle = 'rgba(0, 0, 0, 0.9)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        context.fillStyle = userData.color;
        context.font = 'bold 18px Arial';
        context.textAlign = 'center';
        context.fillText(`${userData.name} (You)`, canvas.width / 2, canvas.height / 2);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        
        sprite.position.set(0, 2.5, 0);
        sprite.scale.set(3, 0.7, 1);
        this.myAvatar.add(sprite);
        
        this.scene.add(this.myAvatar);
    }
    
    updateUserAvatar(userId, position) {
        const avatar = this.userAvatars.get(userId);
        if (avatar) {
            console.log('Updating avatar position for user:', userId, 'to:', position);
            avatar.position.set(position.x, position.y, position.z);
        } else {
            console.warn('Avatar not found for user:', userId, 'available avatars:', Array.from(this.userAvatars.keys()));
        }
    }
    
    updateUserNameLabel(userId, newName, color) {
        const avatar = this.userAvatars.get(userId);
        if (avatar && avatar.children.length > 0) {
            // Find and update the sprite (name label)
            const sprite = avatar.children.find(child => child.type === 'Sprite');
            if (sprite) {
                // Create new canvas with updated name
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = 256;
                canvas.height = 64;
                
                context.fillStyle = 'rgba(0, 0, 0, 0.8)';
                context.fillRect(0, 0, canvas.width, canvas.height);
                
                context.fillStyle = color;
                context.font = '16px Arial';
                context.textAlign = 'center';
                context.fillText(newName, canvas.width / 2, canvas.height / 2);
                
                const texture = new THREE.CanvasTexture(canvas);
                sprite.material.map = texture;
                sprite.material.needsUpdate = true;
            }
        }
    }
    
    updateMyAvatarName(newName, color) {
        if (this.myAvatar && this.myAvatar.children.length > 0) {
            // Find and update the sprite (name label)
            const sprite = this.myAvatar.children.find(child => child.type === 'Sprite');
            if (sprite) {
                // Create new canvas with updated name
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = 256;
                canvas.height = 64;
                
                context.fillStyle = 'rgba(0, 0, 0, 0.9)';
                context.fillRect(0, 0, canvas.width, canvas.height);
                
                context.fillStyle = color;
                context.font = 'bold 18px Arial';
                context.textAlign = 'center';
                context.fillText(`${newName} (You)`, canvas.width / 2, canvas.height / 2);
                
                const texture = new THREE.CanvasTexture(canvas);
                sprite.material.map = texture;
                sprite.material.needsUpdate = true;
            }
        }
    }
    
    removeUserAvatar(userId) {
        const avatar = this.userAvatars.get(userId);
        if (avatar) {
            this.scene.remove(avatar);
            this.userAvatars.delete(userId);
        }
    }
    
    updateUserPositions() {
        // Handle my avatar movement
        if (this.myAvatar && this.currentUser && !this.isDead) {
            let moved = false;
            const oldPosition = { ...this.currentUser.position };
            
            // Get camera direction for relative movement
            const direction = new THREE.Vector3();
            this.camera.getWorldDirection(direction);
            
            // Get right vector (perpendicular to direction)
            const right = new THREE.Vector3();
            right.crossVectors(direction, this.camera.up);
            
            // Camera-relative movement
            if (this.keys.w) {
                // Move forward relative to camera
                this.currentUser.position.x += direction.x * this.moveSpeed;
                this.currentUser.position.z += direction.z * this.moveSpeed;
                moved = true;
            }
            if (this.keys.s) {
                // Move backward relative to camera
                this.currentUser.position.x -= direction.x * this.moveSpeed;
                this.currentUser.position.z -= direction.z * this.moveSpeed;
                moved = true;
            }
            if (this.keys.a) {
                // Move left relative to camera
                this.currentUser.position.x -= right.x * this.moveSpeed;
                this.currentUser.position.z -= right.z * this.moveSpeed;
                moved = true;
            }
            if (this.keys.d) {
                // Move right relative to camera
                this.currentUser.position.x += right.x * this.moveSpeed;
                this.currentUser.position.z += right.z * this.moveSpeed;
                moved = true;
            }
            
            // Vertical movement (flying)
            if (this.keys.space) {
                this.currentUser.position.y += this.flySpeed;
                moved = true;
            }
            if (this.keys.cmd) {
                this.currentUser.position.y -= this.flySpeed;
                moved = true;
            }
            
            if (moved) {
                // Prevent going below ground
                if (this.currentUser.position.y < 1) {
                    this.currentUser.position.y = 1;
                }
                
                // Update avatar position (without the bobbing animation offset)
                this.myAvatar.position.set(
                    this.currentUser.position.x,
                    this.currentUser.position.y,
                    this.currentUser.position.z
                );
                
                // Update camera to follow avatar
                this.updateCameraPosition();
                
                // Send position update to server
                if (this.socket) {
                    this.socket.emit('cameraMove', this.currentUser.position);
                }
            }
        }
        
        // Animate other users' avatars (reduced bobbing)
        this.userAvatars.forEach((avatar, userId) => {
            const userData = this.otherUsers.get(userId);
            if (userData && userData.position) {
                // Update all positions, not just Y
                avatar.position.x = userData.position.x;
                avatar.position.z = userData.position.z;
                avatar.position.y = userData.position.y + Math.sin(Date.now() * 0.001) * 0.03;
                avatar.rotation.y += 0.01;
            }
        });
        
        // Animate my avatar (reduced bobbing)
        if (this.myAvatar && this.currentUser) {
            this.myAvatar.rotation.y += 0.01;
            const baseY = this.currentUser.position.y;
            this.myAvatar.position.y = baseY + Math.sin(Date.now() * 0.001) * 0.03;
        }
    }
    
    updateCameraPosition() {
        if (this.myAvatar && this.currentUser && !this.pointerLocked) {
            // Only use follow cam when not in pointer lock mode
            const targetPosition = new THREE.Vector3(
                this.currentUser.position.x + this.cameraOffset.x,
                this.currentUser.position.y + this.cameraOffset.y,
                this.currentUser.position.z + this.cameraOffset.z
            );
            
            this.camera.position.lerp(targetPosition, 0.1);
            
            this.camera.lookAt(
                this.currentUser.position.x,
                this.currentUser.position.y + 1,
                this.currentUser.position.z
            );
        } else if (this.pointerLocked && this.myAvatar && this.currentUser) {
            // FPS mode - camera is at avatar position
            this.camera.position.copy(this.currentUser.position);
            this.camera.position.y += 1.5; // Eye level
        }
    }
    
    updateUsersList() {
        const userListElement = document.getElementById('userList');
        const userCountElement = document.getElementById('userCount');
        
        if (userListElement && userCountElement) {
            const totalUsers = this.otherUsers.size + (this.currentUser ? 1 : 0);
            userCountElement.textContent = totalUsers;
            
            let html = '';
            if (this.currentUser) {
                html += `<div style="color: ${this.currentUser.color}; margin: 5px 0; padding: 5px; background: rgba(255,255,255,0.1); border-radius: 3px;">
                    👤 ${this.currentUser.name} (You)
                </div>`;
            }
            
            this.otherUsers.forEach(user => {
                html += `<div style="color: ${user.color}; margin: 5px 0; padding: 5px; background: rgba(255,255,255,0.1); border-radius: 3px;">
                    👤 ${user.name}
                </div>`;
            });
            
            userListElement.innerHTML = html;
        }
    }
    
    shareCode(code) {
        if (this.socket) {
            this.socket.emit('shareCode', { code: code });
        }
    }
    
    sendInteraction(interactionType, data) {
        if (this.socket) {
            this.socket.emit('userInteraction', {
                type: interactionType,
                data: data
            });
        }
    }
    
    showCodeShareNotification(data) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 255, 0, 0.9);
            color: black;
            padding: 10px 20px;
            border-radius: 5px;
            z-index: 9999;
            font-weight: bold;
        `;
        notification.textContent = `${data.userName} shared code!`;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 3000);
    }
    
    showUserInteraction(data) {
        console.log(`${data.userName} ${data.interaction.type}:`, data.interaction.data);
    }
    
    createOtherPlayerProjectile(data) {
        const position = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
        const direction = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z);
        
        const projectile = this.createProjectile(position, direction);
        projectile.userData.shooter = data.shooter;
        projectile.material.color.setHex(0xff4444); // Different color for other players' shots
        
        this.projectiles.push(projectile);
    }
    
    showHitNotification(data) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 70px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(255, 68, 68, 0.9);
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            z-index: 9999;
            font-weight: bold;
        `;
        
        if (data.target === this.currentUser?.id) {
            notification.textContent = `You were hit by ${data.shooterName}! -25 HP`;
            notification.style.background = 'rgba(255, 0, 0, 0.9)';
            // Take damage when hit
            this.takeDamage(25);
        } else {
            notification.textContent = `${data.shooterName} hit ${data.targetName}!`;
        }
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 3000);
    }
    
    loadSharedCode(data) {
        document.getElementById('codeTextarea').value = data.code;
        this.loadAssemblyCode(data.code);
        this.updateStats();
        
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(255, 255, 0, 0.9);
            color: black;
            padding: 10px 20px;
            border-radius: 5px;
            z-index: 9999;
            font-weight: bold;
        `;
        notification.textContent = `${data.loaderName} loaded: ${data.filename || 'assembly code'}`;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 4000);
    }
    
    updateStats() {
        if (typeof updateStats === 'function') {
            updateStats();
        }
    }
}

window.AssemblyGameEngine = AssemblyGameEngine;