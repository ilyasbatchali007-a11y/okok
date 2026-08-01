// 1. Ensure CELL_SIZE is exported from './config/Constants'
import { generateTestMap, MAP_DATA } from './config/MapData';
import { MapRenderer } from './render/MapRenderer';
import { MAX_ENTITIES, FIXED_DT, WORLD_WIDTH, WORLD_HEIGHT, CELL_SIZE, PLAYER_ID } from './config/Constants';
import { World } from './ecs/World';
// 2. Fixed export/import style for MovementSystem (switched to default or named depending on your file structure)
import { MovementSystem } from './systems/MovementSystem'; 
import { CollisionSystem } from './systems/CollisionSystem';
import { GLInstancedRenderer } from './render/GLInstancedRenderer';
import { AssetLoader } from './engine/AssetLoader';
import { SaveManager } from './serialization/SaveManager';
import { Camera, createPlayerCamera } from './engine/Camera';
// 💡 ADDITION: Initialize MapRenderer
const mapRenderer = new MapRenderer();

async function initEngine() {
  // 1. Setup Canvas & WebGL2 Context
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas not found');

// Set canvas to window size for proper viewport
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

  // Create a guaranteed non-null reference for TypeScript closures
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL 2 is not supported.');

  // Create a guaranteed non-null reference for TypeScript closures
  const ctx: WebGL2RenderingContext = gl as WebGL2RenderingContext;

  ctx.viewport(0, 0, canvas.width, canvas.height);
  ctx.clearColor(0.1, 0.1, 0.12, 1.0);

  // 2. Initialize Core Systems & World
  const world = new World(); 
  const movementSystem = new MovementSystem();
  // CollisionSystem does not require constructor parameters
  const collisionSystem = new CollisionSystem();
  const renderer = new GLInstancedRenderer(ctx, MAX_ENTITIES);
  
  // Generate test map BEFORE spawning player
  generateTestMap();
  console.log('[Engine] Map generated, size:', MAP_DATA.length, 'tiles');
  
  // Spawn player entity at center of map (avoiding border walls)
  const playerX = WORLD_WIDTH / 2;
  const playerY = WORLD_HEIGHT / 2;
  world.active[PLAYER_ID] = 1;
  world.x[PLAYER_ID] = playerX;
  world.y[PLAYER_ID] = playerY;
  world.w[PLAYER_ID] = 32;
  world.h[PLAYER_ID] = 32;
  world.speed[PLAYER_ID] = 200;
  world.vx[PLAYER_ID] = 0;
  world.vy[PLAYER_ID] = 0;
  
  // Update sparse set for renderer
  world.set.count = 1;
  world.set.dense[0] = PLAYER_ID;
  
  // Set up isometric projection (rotate 45 degrees, scale Y by 0.5)
  renderer.setIsometricView(Math.PI / 4, 0.5);
  
  // Create camera following the player with isometric view and offset
  // Offset positions camera to show more of the map above the player
  const camera = createPlayerCamera(
    { x: world.x[PLAYER_ID], y: world.y[PLAYER_ID] },
    canvas.width,
    canvas.height,
    0.15, // Smooth factor for camera follow
    200,    // offsetX (200 pixels right)
    300   // offsetY (300 pixels down)
  );
  
  // Initialize camera position to player position so map is visible on first frame
  camera.snapToTarget();

  // 3. Load Placeholder Texture (1x1 White Pixel fallback)
  const texture = await AssetLoader.loadTexture(
    ctx,
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  );

  // 4. Main Game Loop with Fixed Delta Time
  const inputState: Record<string, boolean> = {};
  
  // Handle keyboard input for movement
  window.addEventListener('keydown', (e) => {
    inputState[e.key] = true;
  });
  
  window.addEventListener('keyup', (e) => {
    inputState[e.key] = false;
  });
  
  let accumulator = 0;
  let lastTime = performance.now();

  function loop(now: number) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    accumulator += Math.min(dt, 0.25); // Prevent spiral of death

    // Sync camera target with player position
    camera.setTarget({ x: world.x[PLAYER_ID], y: world.y[PLAYER_ID] });
    
    // Update camera and check if it moved
    const cameraMoved = camera.update(dt * 60); // Normalize to ~60fps

    // Fixed timestep updates
    while (accumulator >= FIXED_DT) {
      movementSystem.update(world, inputState, FIXED_DT);
      collisionSystem.update(world as any, inputState, FIXED_DT);

      accumulator -= FIXED_DT;
    }

    // Render Frame
    ctx.clear(ctx.COLOR_BUFFER_BIT);

    // Get camera position for rendering
    const camX = camera.getX();
    const camY = camera.getY();

    // Always recalculate floor data on first few frames OR when camera moved
    if (cameraMoved || lastTime === now) { // First frame condition
      // 1. Get floor data and render as SINGLE quad (1 draw call instead of 1024+)
      const floorData = mapRenderer.getFloorData(
        camX, camY,
        canvas.width,
        canvas.height
      );

      // 2. Render seamless floor in ONE draw call
      renderer.renderFloor(
        floorData,
        canvas.width,
        canvas.height,
        texture,
        camX,
        camY
      );
    } else {
      // Re-render floor without recalculating data
      renderer.renderFloor(
        null,
        canvas.width,
        canvas.height,
        texture,
        camX,
        camY
      );
    }

    // 3. Draw Player Entity (red square) on Top
    renderer.renderPlayer(world, canvas.width, canvas.height, texture, camX, camY);

    requestAnimationFrame(loop);
  }

  // 6. Hook up Save/Load Keyboard Controls (S = Save, L = Load)
  let savedBuffer: ArrayBuffer | null = null;

  window.addEventListener('keydown', (e) => {
    if (e.key === 's' || e.key === 'S') {
      savedBuffer = SaveManager.saveWorld(world);
      console.log(`[Engine] World saved! Binary size: ${savedBuffer.byteLength} bytes`);
    } else if (e.key === 'l' || e.key === 'L') {
      if (savedBuffer) {
        SaveManager.loadWorld(world, savedBuffer);
        console.log('[Engine] World state restored from binary buffer!');
      } else {
        console.warn('[Engine] No save data found! Press S to save first.');
      }
    }
  });
  
  // Handle window resize
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.viewport(0, 0, canvas.width, canvas.height);
    camera.setViewport(canvas.width, canvas.height);
  });

  requestAnimationFrame(loop);
}

initEngine().catch(console.error);
