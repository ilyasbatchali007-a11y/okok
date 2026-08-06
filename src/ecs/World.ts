// SRC/ecs/World.ts

import { MAX_ENTITIES } from "../config/Constants";

export class World {
  public maxEntities: number;
  
  // Legacy array names for compatibility
  public active: Uint8Array;
  public x: Float32Array;
  public y: Float32Array;
  public z: Float32Array;
  public vx: Float32Array;
  public vy: Float32Array;
  public vz: Float32Array;
  public w: Float32Array;
  public h: Float32Array;
  public speed: Float32Array;
  public health: Float32Array;
  public deadFlag: Uint8Array;
  
  // Aliases for renderer compatibility
  public px: Float32Array;
  public py: Float32Array;
  public width: Float32Array;
  public height: Float32Array;
  public set: { count: number; dense: number[] };

  constructor(maxEntities: number = MAX_ENTITIES) {
    this.maxEntities = maxEntities;
    this.active = new Uint8Array(maxEntities);
    this.x = new Float32Array(maxEntities);
    this.y = new Float32Array(maxEntities);
    this.z = new Float32Array(maxEntities);
    this.vx = new Float32Array(maxEntities);
    this.vy = new Float32Array(maxEntities);
    this.vz = new Float32Array(maxEntities);
    this.w = new Float32Array(maxEntities);
    this.h = new Float32Array(maxEntities);
    this.speed = new Float32Array(maxEntities);
    this.health = new Float32Array(maxEntities);
    this.deadFlag = new Uint8Array(maxEntities);
    
    // Create aliases pointing to same buffers
    this.px = this.x;
    this.py = this.y;
    this.width = this.w;
    this.height = this.h;
    
    // Simple sparse set implementation
    this.set = {
      count: 0,
      dense: [] as number[]
    };
  }
}