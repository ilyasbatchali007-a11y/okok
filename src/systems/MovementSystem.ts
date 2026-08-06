// SRC/systems/MovementSystem.ts

import { World } from '../ecs/World';
import { CollisionSystem } from './CollisionSystem';
import { PLAYER_ID } from '../config/Constants';

export class MovementSystem {
  private collisionSystem: CollisionSystem = new CollisionSystem();
  private gravity: number = -800; // Gravity in pixels per second squared
  private jumpForce: number = 400; // Jump velocity in pixels per second
  private groundLevel: number = 0; // Ground level (z=0)

  public update(world: World, keys: Record<string, boolean>, dt: number): void {
    const w = world as any;
    if (!w.active || !w.active[PLAYER_ID]) return;

    let dirX = 0;
    let dirY = 0;

    if (keys['w'] || keys['arrowup']) dirY -= 1;
    if (keys['s'] || keys['arrowdown']) dirY += 1;
    if (keys['a'] || keys['arrowleft']) dirX -= 1;
    if (keys['d'] || keys['arrowright']) dirX += 1;

    const length = Math.hypot(dirX, dirY);
    if (length > 0) {
      dirX /= length;
      dirY /= length;
    }

    const speed = w.speed ? w.speed[PLAYER_ID] : 200;
    const vx = dirX * speed;
    const vy = dirY * speed;

    if (w.vx) w.vx[PLAYER_ID] = vx;
    if (w.vy) w.vy[PLAYER_ID] = vy;

    // Handle jumping - only when on the ground
    const isOnGround = w.z ? w.z[PLAYER_ID] <= this.groundLevel : true;
    if ((keys[' '] || keys['space']) && isOnGround) {
      if (w.vz) w.vz[PLAYER_ID] = this.jumpForce;
    }

    // Apply gravity to vertical velocity
    if (w.vz) {
      w.vz[PLAYER_ID] += this.gravity * dt;
    }

    // Update Z position with velocity
    if (w.z !== undefined) {
      let zPos = w.z[PLAYER_ID] || 0;
      let vz = w.vz[PLAYER_ID] || 0;
      
      zPos += vz * dt;
      
      // Clamp to ground level
      if (zPos < this.groundLevel) {
        zPos = this.groundLevel;
        if (w.vz) w.vz[PLAYER_ID] = 0;
      }
      
      w.z[PLAYER_ID] = zPos;
    }

    const currentX = w.x ? w.x[PLAYER_ID] : 0;
    const currentY = w.y ? w.y[PLAYER_ID] : 0;
    const width = w.w ? w.w[PLAYER_ID] : 32;
    const height = w.h ? w.h[PLAYER_ID] : 32;

    const nextPos = (this.collisionSystem as any).moveAndSlide(
      currentX,
      currentY,
      vx,
      vy,
      width,
      height,
      dt
    );

    if (w.x) w.x[PLAYER_ID] = nextPos.x;
    if (w.y) w.y[PLAYER_ID] = nextPos.y;
  }
}
