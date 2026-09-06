import * as THREE from "three";
import type { ConsoleContext, ConsoleGameInstance, ControllerPeer } from "@contract/gameTypes";
import { createFixedTickLoop } from "@utils/gameLoop";

export const controllerTypes = {
  phone: {},
  gamepad: {},
};

export interface TownInputState {
  x: number;
  y: number;
  jump: boolean;
}

export function gamepadStateToTownInput(msg: { buttons: number[]; axes: number[] }): TownInputState {
  let x = 0;
  let y = 0;

  const rawX = msg.axes[0] ?? 0;
  const rawY = msg.axes[1] ?? 0;
  const deadzone = 0.15;
  if (Math.abs(rawX) > deadzone) x += rawX;
  if (Math.abs(rawY) > deadzone) y += rawY;

  const buttons = msg.buttons ?? [];
  if ((buttons[12] ?? 0) > 0.5) y -= 1; // D-pad Up
  if ((buttons[13] ?? 0) > 0.5) y += 1; // D-pad Down
  if ((buttons[14] ?? 0) > 0.5) x -= 1; // D-pad Left
  if ((buttons[15] ?? 0) > 0.5) x += 1; // D-pad Right

  const mag = Math.sqrt(x * x + y * y);
  if (mag > 1.0) {
    x /= mag;
    y /= mag;
  }

  // Jump button: Face buttons (0..3) or bumpers (4..7)
  const jump = buttons.slice(0, 8).some((b) => (b ?? 0) > 0.5);

  return { x, y, jump };
}

interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

interface PlayerAvatar {
  id: string;
  name: string;
  color: string;
  mesh: THREE.Group;
  bodyMesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  facingAngle: number;
  isGrounded: boolean;
  walkTimer: number;
  nameTagEl: HTMLDivElement;
}

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  // Wrapper element
  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #87ceeb;
    user-select: none;
  `;

  // Overlay container for player name tags & UI
  const uiOverlay = document.createElement("div");
  uiOverlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10;
  `;
  wrapper.appendChild(uiOverlay);

  // Title / status banner
  const titleBanner = document.createElement("div");
  titleBanner.style.cssText = `
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(15, 23, 42, 0.75);
    backdrop-filter: blur(8px);
    color: white;
    padding: 10px 24px;
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    font-family: system-ui, -apple-system, sans-serif;
    text-align: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  titleBanner.innerHTML = `
    <h2 style="margin: 0; font-size: 18px; font-weight: 700;">🏡 3D Town Explorer</h2>
    <p style="margin: 2px 0 0 0; font-size: 12px; opacity: 0.85;">Connect phone or press buttons on gamepad to walk around</p>
  `;
  uiOverlay.appendChild(titleBanner);

  ctx.viewport.container.appendChild(wrapper);

  // Setup Three.js
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.018);

  const camera = new THREE.PerspectiveCamera(
    50,
    ctx.viewport.initialSize.width / ctx.viewport.initialSize.height || 1,
    0.1,
    100
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(ctx.viewport.initialSize.width, ctx.viewport.initialSize.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrapper.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334422, 0.4);
  hemiLight.position.set(0, 50, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(25, 40, 20);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 80;
  const d = 30;
  dirLight.shadow.camera.left = -d;
  dirLight.shadow.camera.right = d;
  dirLight.shadow.camera.top = d;
  dirLight.shadow.camera.bottom = -d;
  scene.add(dirLight);

  // Town Elements & Collision Obstacles
  const obstacles: Obstacle[] = [];

  // Ground plane (Grass)
  const townSize = 50;
  const groundGeo = new THREE.PlaneGeometry(townSize, townSize);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x55aa44, roughness: 0.9 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Roads/Paths
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c, roughness: 0.8 });
  const mainRoadV = new THREE.Mesh(new THREE.PlaneGeometry(6, townSize), pathMat);
  mainRoadV.rotation.x = -Math.PI / 2;
  mainRoadV.position.y = 0.01;
  mainRoadV.receiveShadow = true;
  scene.add(mainRoadV);

  const mainRoadH = new THREE.Mesh(new THREE.PlaneGeometry(townSize, 6), pathMat);
  mainRoadH.rotation.x = -Math.PI / 2;
  mainRoadH.position.y = 0.01;
  mainRoadH.receiveShadow = true;
  scene.add(mainRoadH);

  // Central Plaza / Fountain
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6 });
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.05, 32), plazaMat);
  plaza.position.set(0, 0.02, 0);
  plaza.receiveShadow = true;
  scene.add(plaza);

  const fountainRim = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 0.8, 16),
    new THREE.MeshStandardMaterial({ color: 0x666666 })
  );
  fountainRim.position.set(0, 0.4, 0);
  fountainRim.castShadow = true;
  scene.add(fountainRim);

  const fountainWater = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 0.7, 16),
    new THREE.MeshStandardMaterial({ color: 0x3388cc, roughness: 0.1, metalness: 0.2 })
  );
  fountainWater.position.set(0, 0.45, 0);
  scene.add(fountainWater);

  obstacles.push({ x: 0, z: 0, radius: 2.8 });

  // Town Buildings Helper
  function createHouse(x: number, z: number, color: number, width = 4, length = 4, height = 3) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // Walls
    const wallGeo = new THREE.BoxGeometry(width, height, length);
    const wallMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = height / 2;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    // Roof
    const roofGeo = new THREE.ConeGeometry(Math.max(width, length) * 0.75, 2.5, 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xb22222, roughness: 0.5 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = height + 1.25;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    // Door
    const doorGeo = new THREE.BoxGeometry(1, 1.8, 0.1);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x5c4033 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.9, length / 2 + 0.05);
    group.add(door);

    scene.add(group);
    obstacles.push({ x, z, radius: Math.max(width, length) / 2 + 0.5 });
  }

  // Spawn Houses around the town
  createHouse(-12, -12, 0xef4444, 5, 5, 3.5); // Red House
  createHouse(12, -12, 0x3b82f6, 4.5, 4.5, 3); // Blue House
  createHouse(-12, 12, 0xeab308, 5, 4, 3.2);  // Yellow House
  createHouse(12, 12, 0x8b5cf6, 4, 5, 3.5);   // Purple House
  createHouse(-16, 0, 0x10b981, 4, 4, 3);     // Green House
  createHouse(16, 0, 0xf97316, 5, 4.5, 3.2);  // Orange House

  // Trees Helper
  function createTree(x: number, z: number) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // Trunk
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.4, 2, 8),
      new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 })
    );
    trunk.position.y = 1;
    trunk.castShadow = true;
    group.add(trunk);

    // Foliage
    const foliage = new THREE.Mesh(
      new THREE.ConeGeometry(1.8, 3.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.6 })
    );
    foliage.position.y = 3.25;
    foliage.castShadow = true;
    group.add(foliage);

    scene.add(group);
    obstacles.push({ x, z, radius: 0.8 });
  }

  // Spawn Trees
  const treePositions = [
    [-6, -6], [6, -6], [-6, 6], [6, 6],
    [-18, -18], [18, -18], [-18, 18], [18, 18],
    [-8, -18], [8, -18], [-8, 18], [8, 18],
    [-20, 8], [20, 8], [-20, -8], [20, -8],
  ];
  treePositions.forEach(([tx, tz]) => createTree(tx, tz));

  // Fence along perimeter
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 });
  const fenceDist = 23.5;
  for (let i = -fenceDist; i <= fenceDist; i += 3) {
    // Top & Bottom fences
    [-fenceDist, fenceDist].forEach((z) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), fenceMat);
      post.position.set(i, 0.6, z);
      post.castShadow = true;
      scene.add(post);
    });
    // Left & Right fences
    [-fenceDist, fenceDist].forEach((x) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), fenceMat);
      post.position.set(x, 0.6, i);
      post.castShadow = true;
      scene.add(post);
    });
  }

  // Player Avatars Management
  const playerAvatars = new Map<string, PlayerAvatar>();
  const playerInputs = new Map<string, TownInputState>();

  function createPlayerAvatar(id: string, name: string, colorHex: string): PlayerAvatar {
    const group = new THREE.Group();

    // Body Capsule/Cylinder
    const color = new THREE.Color(colorHex);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 });
    const bodyGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 16);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.55;
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // Head
    const headGeo = new THREE.SphereGeometry(0.4, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffdfc4, roughness: 0.5 });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.y = 1.35;
    headMesh.castShadow = true;
    group.add(headMesh);

    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeGeo = new THREE.SphereGeometry(0.07, 8, 8);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.15, 1.4, 0.32);
    group.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.15, 1.4, 0.32);
    group.add(rightEye);

    // Cute Hat (colored cone)
    const hatGeo = new THREE.ConeGeometry(0.35, 0.6, 12);
    const hatMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
    const hatMesh = new THREE.Mesh(hatGeo, hatMat);
    hatMesh.position.y = 1.8;
    hatMesh.castShadow = true;
    group.add(hatMesh);

    scene.add(group);

    // Name tag element
    const nameTagEl = document.createElement("div");
    nameTagEl.style.cssText = `
      position: absolute;
      transform: translate(-50%, -100%);
      background: rgba(15, 23, 42, 0.85);
      border: 2px solid ${colorHex};
      color: white;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 12px;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    `;
    nameTagEl.textContent = name;
    uiOverlay.appendChild(nameTagEl);

    // Initial position in central plaza area
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnDist = 3 + Math.random() * 2;
    const spawnX = Math.cos(spawnAngle) * spawnDist;
    const spawnZ = Math.sin(spawnAngle) * spawnDist;

    group.position.set(spawnX, 0, spawnZ);

    return {
      id,
      name,
      color: colorHex,
      mesh: group,
      bodyMesh,
      x: spawnX,
      y: 0,
      z: spawnZ,
      vx: 0,
      vy: 0,
      vz: 0,
      facingAngle: 0,
      isGrounded: true,
      walkTimer: 0,
      nameTagEl,
    };
  }

  function setupPeer(peer: ControllerPeer) {
    if (!playerAvatars.has(peer.id)) {
      const avatar = createPlayerAvatar(peer.id, peer.name, peer.color);
      playerAvatars.set(peer.id, avatar);
    }

    if (peer.pc) {
      peer.pc.addInputListener((msg: unknown) => {
        const input = msg as { type?: string; state?: TownInputState; buttons?: number[]; axes?: number[] };
        if (input) {
          if (input.type === "state" && input.state) {
            playerInputs.set(peer.id, input.state);
          } else if (input.type === "gamepad-state" && Array.isArray(input.buttons) && Array.isArray(input.axes)) {
            playerInputs.set(peer.id, gamepadStateToTownInput(input as { buttons: number[]; axes: number[] }));
          }
        }
      });
    }
  }

  for (const peer of ctx.peers.values()) {
    setupPeer(peer);
  }

  const unsubReady = ctx.onPeerReady((peer) => {
    setupPeer(peer);
  });

  const unsubLeft = ctx.onPeerLeft((id) => {
    const avatar = playerAvatars.get(id);
    if (avatar) {
      scene.remove(avatar.mesh);
      avatar.nameTagEl.remove();
      playerAvatars.delete(id);
    }
    playerInputs.delete(id);
  });

  // Camera control
  const camOffset = new THREE.Vector3(0, 10, 12);
  const camTarget = new THREE.Vector3(0, 0, 0);

  // Resize Listener
  function handleResize(size: { width: number; height: number }) {
    if (size.width > 0 && size.height > 0) {
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      renderer.setSize(size.width, size.height);
    }
  }

  const unsubscribeResize = ctx.viewport.onResize(handleResize);

  // Fixed Tick Simulation (60 Hz)
  const loop = createFixedTickLoop({
    tickRate: 60,
    onTick: (dt) => {
      const speed = 7;
      const gravity = -25;
      const jumpVel = 8.5;

      // Update physics for each player avatar
      for (const [id, avatar] of playerAvatars.entries()) {
        const input = playerInputs.get(id) ?? { x: 0, y: 0, jump: false };

        // Input movement vector
        const targetVx = input.x * speed;
        const targetVz = input.y * speed;

        avatar.vx = THREE.MathUtils.lerp(avatar.vx, targetVx, 0.25);
        avatar.vz = THREE.MathUtils.lerp(avatar.vz, targetVz, 0.25);

        // Jump
        if (input.jump && avatar.isGrounded) {
          avatar.vy = jumpVel;
          avatar.isGrounded = false;
        }

        // Apply gravity
        avatar.vy += gravity * dt;
        avatar.y += avatar.vy * dt;

        if (avatar.y <= 0) {
          avatar.y = 0;
          avatar.vy = 0;
          avatar.isGrounded = true;
        }

        // Horizontal movement
        let nextX = avatar.x + avatar.vx * dt;
        let nextZ = avatar.z + avatar.vz * dt;

        // Map Boundary collision
        const bound = 22.5;
        nextX = THREE.MathUtils.clamp(nextX, -bound, bound);
        nextZ = THREE.MathUtils.clamp(nextZ, -bound, bound);

        // Obstacle collisions
        const pRadius = 0.5;
        for (const obs of obstacles) {
          const dx = nextX - obs.x;
          const dz = nextZ - obs.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const minDist = obs.radius + pRadius;

          if (dist < minDist && dist > 0) {
            const overlap = minDist - dist;
            nextX += (dx / dist) * overlap;
            nextZ += (dz / dist) * overlap;
          }
        }

        avatar.x = nextX;
        avatar.z = nextZ;

        // Facing Angle
        if (Math.abs(avatar.vx) > 0.1 || Math.abs(avatar.vz) > 0.1) {
          const targetAngle = Math.atan2(avatar.vx, avatar.vz);
          avatar.facingAngle = THREE.MathUtils.lerp(avatar.facingAngle, targetAngle, 0.2);
          avatar.walkTimer += dt * 12;
        }

        // Mesh Transform updates
        avatar.mesh.position.set(avatar.x, avatar.y, avatar.z);
        avatar.mesh.rotation.y = avatar.facingAngle;

        // Waddling animation when walking
        const isMoving = Math.hypot(avatar.vx, avatar.vz) > 0.2;
        if (isMoving && avatar.isGrounded) {
          avatar.bodyMesh.rotation.z = Math.sin(avatar.walkTimer) * 0.15;
          avatar.bodyMesh.position.y = 0.55 + Math.abs(Math.sin(avatar.walkTimer)) * 0.08;
        } else {
          avatar.bodyMesh.rotation.z = 0;
          avatar.bodyMesh.position.y = 0.55;
        }
      }

      // Camera Follow Target (Average of active player positions)
      if (playerAvatars.size > 0) {
        let avgX = 0;
        let avgZ = 0;
        for (const avatar of playerAvatars.values()) {
          avgX += avatar.x;
          avgZ += avatar.z;
        }
        avgX /= playerAvatars.size;
        avgZ /= playerAvatars.size;

        camTarget.x = THREE.MathUtils.lerp(camTarget.x, avgX, 0.08);
        camTarget.z = THREE.MathUtils.lerp(camTarget.z, avgZ, 0.08);
      } else {
        camTarget.x = THREE.MathUtils.lerp(camTarget.x, 0, 0.05);
        camTarget.z = THREE.MathUtils.lerp(camTarget.z, 0, 0.05);
      }
    },
    onRender: () => {
      // Smooth Camera Position
      camera.position.x = camTarget.x + camOffset.x;
      camera.position.y = camOffset.y;
      camera.position.z = camTarget.z + camOffset.z;
      camera.lookAt(camTarget.x, 1, camTarget.z);

      // Render Three.js Scene
      renderer.render(scene, camera);

      // Sync floating Name Tags to 3D positions projected on 2D screen
      const tempVec = new THREE.Vector3();
      const halfW = renderer.domElement.clientWidth / 2;
      const halfH = renderer.domElement.clientHeight / 2;

      for (const avatar of playerAvatars.values()) {
        tempVec.set(avatar.x, avatar.y + 2.2, avatar.z);
        tempVec.project(camera);

        // Check if behind camera
        if (tempVec.z > 1) {
          avatar.nameTagEl.style.display = "none";
        } else {
          avatar.nameTagEl.style.display = "block";
          const screenX = tempVec.x * halfW + halfW;
          const screenY = -tempVec.y * halfH + halfH;
          avatar.nameTagEl.style.left = `${screenX}px`;
          avatar.nameTagEl.style.top = `${screenY}px`;
        }
      }
    },
  });

  return {
    tick: (_dt: number) => {},
    render: (_alpha: number) => {},
    destroy: () => {
      loop.stop();
      unsubscribeResize();
      unsubReady();
      unsubLeft();

      // Clean up Name Tags
      for (const avatar of playerAvatars.values()) {
        avatar.nameTagEl.remove();
      }

      // Dispose Three.js Resources
      renderer.dispose();
      wrapper.remove();
    },
  };
}
