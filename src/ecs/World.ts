// SRC/ecs/World.ts

import { MAX_ENTITIES } from "../config/Constants";

export class World {
  public maxEntities: number;
  
  // Legacy array names for compatibility
  public active: Uint8Array;
  public x: Float32Array;
  public y: Float32Array;
  public z: Float32Array;  // Height/Z position for 3D
  public vx: Float32Array;
  public vy: Float32Array;
  public w: Float32Array;
  public h: Float32Array;
  public d: Float32Array;  // Depth for 3D boxes
  public speed: Float32Array;
  
  // Aliases for renderer compatibility
  public px: Float32Array;
  public py: Float32Array;
  public pz: Float32Array;  // Alias for z
  public width: Float32Array;
  public height: Float32Array;
  public depth: Float32Array;  // Alias for d
  public set: { count: number; dense: number[] };

  constructor(maxEntities: number = MAX_ENTITIES) {
    this.maxEntities = maxEntities;
    this.active = new Uint8Array(maxEntities);
    this.x = new Float32Array(maxEntities);
    this.y = new Float32Array(maxEntities);
    this.z = new Float32Array(maxEntities);  // Height/Z position
    this.vx = new Float32Array(maxEntities);
    this.vy = new Float32Array(maxEntities);
    this.w = new Float32Array(maxEntities);
    this.h = new Float32Array(maxEntities);
    this.d = new Float32Array(maxEntities);  // Depth for 3D
    this.speed = new Float32Array(maxEntities);
    
    // Create aliases pointing to same buffers
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.width = this.w;
    this.height = this.h;
    this.depth = this.d;
    
    // Simple sparse set implementation
    this.set = {
      count: 0,
      dense: [] as number[]
    };
  }
}