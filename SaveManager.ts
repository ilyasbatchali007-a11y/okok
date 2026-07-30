import { World } from '../ecs/World';

// Binary Layout Constants (Offsets in Bytes)
const HEADER_SIZE = 8;
const BYTES_PER_ENTITY = 29; // 7 Floats (28 bytes) + 1 Uint8 (1 byte)

export class SaveManager {
  public static saveWorld(world: World): ArrayBuffer {
    const worldAny = world as any;
    
    // Count active entities
    let count = 0;
    for (let i = 0; i < world.active.length; i++) {
      if (world.active[i]) count++;
    }
    
    const bufferSize = HEADER_SIZE + count * BYTES_PER_ENTITY;
    const buffer = new ArrayBuffer(bufferSize);

    const view = new DataView(buffer);

    // 1. Write Header (Entity count)
    view.setUint32(0, count, true);

    let offset = HEADER_SIZE;

    // 2. Write Component Data per Active Entity
    for (let id = 0; id < world.active.length; id++) {
      if (!world.active[id]) continue;

      view.setFloat32(offset + 0, world.px[id], true);
      view.setFloat32(offset + 4, world.py[id], true);
      view.setFloat32(offset + 8, world.vx[id], true);
      view.setFloat32(offset + 12, world.vy[id], true);
      view.setFloat32(offset + 16, world.width[id], true);
      view.setFloat32(offset + 20, world.height[id], true);
      view.setFloat32(offset + 24, world.health[id], true);
      view.setUint8(offset + 28, world.deadFlag[id]);

      offset += BYTES_PER_ENTITY;
    }

    return buffer;
  }

  public static loadWorld(world: World, buffer: ArrayBuffer): void {
    const view = new DataView(buffer);
    const count = view.getUint32(0, true);

    // Clear current active entities
    for (let i = 0; i < world.active.length; i++) {
      world.active[i] = 0;
    }

    let offset = HEADER_SIZE;

    for (let i = 0; i < count; i++) {
      const px = view.getFloat32(offset + 0, true);
      const py = view.getFloat32(offset + 4, true);
      const vx = view.getFloat32(offset + 8, true);
      const vy = view.getFloat32(offset + 12, true);
      const w = view.getFloat32(offset + 16, true);
      const h = view.getFloat32(offset + 20, true);
      const health = view.getFloat32(offset + 24, true);
      const deadFlag = view.getUint8(offset + 28);

      const id = world.createEntity();
      world.px[id] = px;
      world.py[id] = py;
      world.vx[id] = vx;
      world.vy[id] = vy;
      world.width[id] = w;
      world.height[id] = h;
      world.health[id] = health;
      world.deadFlag[id] = deadFlag;

      offset += BYTES_PER_ENTITY;
    }
  }
}
