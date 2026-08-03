// SRC/systems/MovementSystem.ts

import { World } from '../ecs/World';
import { CollisionSystem } from './CollisionSystem';
import { PLAYER_ID, WORLD_HEIGHT } from '../config/Constants';

export class MovementSystem {
  private collisionSystem: CollisionSystem = new CollisionSystem();
  private jumpVelocity: number = 0;
  private isGrounded: boolean = true;
  private gravity: number = 800; // pixels/s^2
  private jumpStrength: number = 300; // pixels/s
  private lastDirection: number = 1; // 0=up, 1=right, 2=down, 3=left (default right)

  public update(world: World, keys: Record<string, boolean>, dt: number): void {
    const w = world as any;
    if (!w.active || !w.active[PLAYER_ID]) return;

    let dirX = 0;
    let dirY = 0;

    if (keys['w'] || keys['W'] || keys['ArrowUp'] || keys['arrowup']) dirY -= 1;
    if (keys['s'] || keys['S'] || keys['ArrowDown'] || keys['arrowdown']) dirY += 1;
    if (keys['a'] || keys['A'] || keys['ArrowLeft'] || keys['arrowleft']) dirX -= 1;
    if (keys['d'] || keys['D'] || keys['ArrowRight'] || keys['arrowright']) dirX += 1;

    // Update last direction for facing
    if (dirX !== 0 || dirY !== 0) {
      if (Math.abs(dirX) > Math.abs(dirY)) {
        this.lastDirection = dirX > 0 ? 1 : 3; // right or left
      } else {
        this.lastDirection = dirY > 0 ? 2 : 0; // down or up
      }
    }

    const length = Math.hypot(dirX, dirY);
    if (length > 0) {
      dirX /= length;
      dirY /= length;
    }

    // Handle jumping - use Space key or W/Up when grounded
    if ((keys[' '] || keys['Space']) && this.isGrounded) {
      this.jumpVelocity = -this.jumpStrength;
      this.isGrounded = false;
    }

    // Apply gravity
    if (!this.isGrounded) {
      this.jumpVelocity += this.gravity * dt;
    } else {
      this.jumpVelocity = 0;
    }

    const speed = w.speed ? w.speed[PLAYER_ID] : 200;
    const vx = dirX * speed;
    const vy = dirY * speed;

    if (w.vx) w.vx[PLAYER_ID] = vx;
    if (w.vy) w.vy[PLAYER_ID] = vy;
    
    // Store jump velocity and facing direction in world arrays
    if (!w.jumpVel) w.jumpVel = new Float32Array(1024);
    if (!w.facing) w.facing = new Int32Array(1024);
    w.jumpVel[PLAYER_ID] = this.jumpVelocity;
    w.facing[PLAYER_ID] = this.lastDirection;

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
    
    // Simple ground check (assuming ground is at bottom of world)
    // In a real implementation, you'd check against actual floor tiles
    if (nextPos.y >= WORLD_HEIGHT - height - 1) {
      this.isGrounded = true;
      this.jumpVelocity = 0;
    }
  }
  
  public getFacing(): number {
    return this.lastDirection;
  }
  
  public getJumpVelocity(): number {
    return this.jumpVelocity;
  }
}
