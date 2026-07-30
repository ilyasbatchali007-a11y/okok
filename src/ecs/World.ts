// SRC/ecs/World.ts

import { MAX_ENTITIES } from "../config/Constants";

export class World {
  public maxEntities: number;
  
  public active: Uint8Array;
  public x: Float32Array;
  public y: Float32Array;
  public vx: Float32Array;
  public vy: Float32Array;
  public w: Float32Array;
  public h: Float32Array;
  public speed: Float32Array;

  constructor(maxEntities: number = MAX_ENTITIES) {
    this.maxEntities = maxEntities;
    this.active = new Uint8Array(maxEntities);
    this.x = new Float32Array(maxEntities);
    this.y = new Float32Array(maxEntities);
    this.vx = new Float32Array(maxEntities);
    this.vy = new Float32Array(maxEntities);
    this.w = new Float32Array(maxEntities);
    this.h = new Float32Array(maxEntities);
    this.speed = new Float32Array(maxEntities);
  }
}