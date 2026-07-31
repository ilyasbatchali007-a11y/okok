// 1. Ensure CELL_SIZE is exported from './config/Constants'
import { generateTestMap } from './config/MapData';
import { MapRenderer } from './render/MapRenderer';
import { MAX_ENTITIES, FIXED_DT, WORLD_WIDTH, WORLD_HEIGHT, CELL_SIZE } from './config/Constants';
import { World } from './ecs/World';
// 2. Fixed export/import style for MovementSystem (switched to default or named depending on your file structure)
import { MovementSystem } from './systems/MovementSystem'; 
import { CollisionSystem } from './systems/CollisionSystem';
import { GLInstancedRenderer } from './render/GLInstancedRenderer';
import { AssetLoader } from './engine/AssetLoader';
import { SaveManager } from './serialization/SaveManager';
import { Camera } from './engine/Camera';
// 💡 ADDITION: Initialize MapRenderer
const mapRenderer = new MapRenderer();

async function initEngine() {
  // 1. Setup Canvas & WebGL2 Context
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas not found');

canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;

  // Create a guaranteed non-null reference for TypeScript closures
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL 2 is not supported.');

  // Create a guaranteed non-null reference for TypeScript closures
  const ctx: WebGL2RenderingContext = gl;

  ctx.viewport(0, 0, canvas.width, canvas.height);
  ctx.clearColor(0.1, 0.1, 0.12, 1.0);

  // 2. Initialize Core Systems & World
  const world = new World(); 
  const movementSystem = new MovementSystem();
  // CollisionSystem does not require constructor parameters
  const collisionSystem = new CollisionSystem();
  const renderer = new GLInstancedRenderer(ctx, MAX_ENTITIES);
  
  // Initialize camera for isometric view and player following
  const camera = new Camera();
  camera.setViewport(canvas.width, canvas.height);
  camera.setMapBounds(WORLD_WIDTH, WORLD_HEIGHT);
  
  generateTestMap();

  // 3. Load Placeholder Texture (1x1 White Pixel fallback)
  const texture = await AssetLoader.loadTexture(
    ctx,
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  );

  // 5. Main Game Loop with Fixed Delta Time
  const inputState: Record<string, boolean> = {};
  let accumulator = 0;
  let lastTime = performance.now();

  function loop(now: number) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    accumulator += Math.min(dt, 0.25); // Prevent spiral of death

    // Fixed timestep updates
    while (accumulator >= FIXED_DT) {
      movementSystem.update(world, inputState, FIXED_DT);
      collisionSystem.update(world as any, inputState, FIXED_DT);

      accumulator -= FIXED_DT;
    }

    // Update camera position (follows player if target is set)
    camera.update(dt * 60); // Normalize to ~60fps

    // Get camera position for rendering
    const cameraX = camera.getX();
    const cameraY = camera.getY();

    // Render Frame
    ctx.clear(ctx.COLOR_BUFFER_BIT);

    // 1. Get floor data and render as SINGLE quad (1 draw call instead of 1024+)
    const floorData = mapRenderer.getFloorData(
      cameraX, cameraY, // Pass camera position for isometric transform
      WORLD_WIDTH,
      WORLD_HEIGHT
    );

    // 2. Render seamless floor in ONE draw call with isometric transform
    renderer.renderFloor(
      floorData,
      WORLD_WIDTH,
      WORLD_HEIGHT,
      texture,
      cameraX,
      cameraY
    );

    // 3. Draw Entities on Top with same isometric transform
    renderer.render(world, WORLD_WIDTH, WORLD_HEIGHT, texture);

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

  requestAnimationFrame(loop);
}

initEngine().catch(console.error);
