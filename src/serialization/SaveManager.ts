import { World } from '../ecs/World';

// Binary Layout Constants (Offsets in Bytes)
const HEADER_SIZE = 8;
const BYTES_PER_ENTITY = 29; // 7 Floats (28 bytes) + 1 Uint8 (1 byte)

export class SaveManager {
  public static saveWorld(world: World): ArrayBuffer {
    const worldAny = world as any;
    const count = worldAny.set.count;
    const bufferSize = HEADER_SIZE + count * BYTES_PER_ENTITY;
    const buffer = new ArrayBuffer(bufferSize);

    const view = new DataView(buffer);

    // 1. Write Header (Entity count)
    view.setUint32(0, count, true);

    let offset = HEADER_SIZE;
    const { dense } = worldAny.set;

    // 2. Write Component Data per Active Entity
    for (let i = 0; i < count; i++) {
      const id = dense[i];

      view.setFloat32(offset + 0, worldAny.px[id], true);
      view.setFloat32(offset + 4, worldAny.py[id], true);
      view.setFloat32(offset + 8, worldAny.vx[id], true);
      view.setFloat32(offset + 12, worldAny.vy[id], true);
      view.setFloat32(offset + 16, worldAny.width[id], true);
      view.setFloat32(offset + 20, worldAny.height[id], true);
      view.setFloat32(offset + 24, worldAny.health[id], true);
      view.setUint8(offset + 28, worldAny.deadFlag[id]);

      offset += BYTES_PER_ENTITY;
    }

    return buffer;
  }

  public static loadWorld(world: World, buffer: ArrayBuffer): void {
    const view = new DataView(buffer);
    const count = view.getUint32(0, true);

    // Clear current active entities
    const worldAny = world as any;
    worldAny.set.count = 0;

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

      const id = worldAny.addEntity(px, py, w, h, health);
      worldAny.vx[id] = vx;
      worldAny.vy[id] = vy;
      worldAny.deadFlag[id] = deadFlag;

      offset += BYTES_PER_ENTITY;
    }
  }
}
