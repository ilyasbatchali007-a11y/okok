// SRC/ecs/World.ts

import { MAX_ENTITIES } from "../config/Constants";

export class World {
  public maxEntities: number;

  // SoA Component Arrays - Standardized names for consistency
  public active: Uint8Array;
  public px: Float32Array;      // Position X
  public py: Float32Array;      // Position Y
  public vx: Float32Array;      // Velocity X
  public vy: Float32Array;      // Velocity Y
  public width: Float32Array;   // Width
  public height: Float32Array;  // Height
  public speed: Float32Array;   // Movement Speed
  public health: Float32Array;  // Health
  public deadFlag: Uint8Array;  // Death Flag

  constructor(maxEntities: number = MAX_ENTITIES) {
    this.maxEntities = maxEntities;
    this.active = new Uint8Array(maxEntities);
    this.px = new Float32Array(maxEntities);
    this.py = new Float32Array(maxEntities);
    this.vx = new Float32Array(maxEntities);
    this.vy = new Float32Array(maxEntities);
    this.width = new Float32Array(maxEntities);
    this.height = new Float32Array(maxEntities);
    this.speed = new Float32Array(maxEntities);
    this.health = new Float32Array(maxEntities);
    this.deadFlag = new Uint8Array(maxEntities);
  }

  createEntity(): number {
    if (this.maxEntities <= 0) {
      throw new Error("Entity capacity reached");
    }
    // Find first inactive slot or append
    let id = -1;
    for (let i = 0; i < this.active.length; i++) {
      if (this.active[i] === 0) {
        id = i;
        break;
      }
    }
    
    if (id === -1) {
      throw new Error("No available entity slots");
    }

    this.active[id] = 1;
    this.deadFlag[id] = 0;
    return id;
  }

  destroyEntity(id: number) {
    if (id >= 0 && id < this.active.length) {
      this.active[id] = 0;
      this.deadFlag[id] = 1;
    }
  }

  isActive(id: number): boolean {
    return id >= 0 && id < this.active.length && this.active[id] === 1;
  }
}
