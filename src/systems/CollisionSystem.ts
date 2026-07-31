type World = {
  active: boolean[];
  speed: number[];
  vx: number[];
  vy: number[];
  x: number[];
  y: number[];
  w: number[];
  h: number[];
};

import { WORLD_WIDTH, WORLD_HEIGHT } from '../config/Constants';
import { isTileBlocking, TILE_SIZE } from '../config/MapData';

export class CollisionSystem {
  public update(world: World, keys: Record<string, boolean>, dt: number, playerId: number = 0): void {
    if (!world.active[playerId]) return;

    let dirX = 0;
    let dirY = 0;

    if (keys['w'] || keys['W'] || keys['ArrowUp']) dirY -= 1;
    if (keys['s'] || keys['S'] || keys['ArrowDown']) dirY += 1;
    if (keys['a'] || keys['A'] || keys['ArrowLeft']) dirX -= 1;
    if (keys['d'] || keys['D'] || keys['ArrowRight']) dirX += 1;

    // Normalize diagonal movement speed
    const length = Math.hypot(dirX, dirY);
    if (length > 0) {
      dirX /= length;
      dirY /= length;
    }

    const moveSpeed = world.speed[playerId] || 200;
    const vx = dirX * moveSpeed;
    const vy = dirY * moveSpeed;

    world.vx[playerId] = vx;
    world.vy[playerId] = vy;

    // Apply collision and wall-sliding physics with floating-point precision
    const nextPos = this.moveAndSlide(
      world.x[playerId],
      world.y[playerId],
      vx,
      vy,
      world.w[playerId] || 32,
      world.h[playerId] || 32,
      dt
    );

    world.x[playerId] = nextPos.x;
    world.y[playerId] = nextPos.y;
  }

  private moveAndSlide(
    x: number,
    y: number,
    vx: number,
    vy: number,
    width: number,
    height: number,
    dt: number
  ): { x: number; y: number } {
    // Calculate next position with floating-point precision
    let nextX = x + vx * dt;
    let nextY = y + vy * dt;

    // Clamp to world bounds
    nextX = Math.max(0, Math.min(nextX, WORLD_WIDTH - width));
    nextY = Math.max(0, Math.min(nextY, WORLD_HEIGHT - height));

    // Check tile collisions at corners of the entity's bounding box
    // This enables seamless sliding along walls with floating-point positions
    const margin = 1; // Small margin to prevent sticking
    
    // Check all four corners of the entity
    const corners = [
      { x: nextX + margin, y: nextY + margin },
      { x: nextX + width - margin, y: nextY + margin },
      { x: nextX + margin, y: nextY + height - margin },
      { x: nextX + width - margin, y: nextY + height - margin }
    ];

    let hasCollision = false;
    for (const corner of corners) {
      const col = Math.floor(corner.x / TILE_SIZE);
      const row = Math.floor(corner.y / TILE_SIZE);
      if (isTileBlocking(col, row)) {
        hasCollision = true;
        break;
      }
    }

    // Simple slide: if collision detected, don't move (can be enhanced with axis-separated sliding)
    if (hasCollision) {
      // Try moving only on X axis
      let canMoveX = true;
      const xCorners = [
        { x: nextX + margin, y: y + margin },
        { x: nextX + width - margin, y: y + margin },
        { x: nextX + margin, y: y + height - margin },
        { x: nextX + width - margin, y: y + height - margin }
      ];
      for (const corner of xCorners) {
        const col = Math.floor(corner.x / TILE_SIZE);
        const row = Math.floor(corner.y / TILE_SIZE);
        if (isTileBlocking(col, row)) {
          canMoveX = false;
          break;
        }
      }
      
      if (canMoveX) {
        return { x: nextX, y };
      }

      // Try moving only on Y axis
      let canMoveY = true;
      const yCorners = [
        { x: x + margin, y: nextY + margin },
        { x: x + width - margin, y: nextY + margin },
        { x: x + margin, y: nextY + height - margin },
        { x: x + width - margin, y: nextY + height - margin }
      ];
      for (const corner of yCorners) {
        const col = Math.floor(corner.x / TILE_SIZE);
        const row = Math.floor(corner.y / TILE_SIZE);
        if (isTileBlocking(col, row)) {
          canMoveY = false;
          break;
        }
      }
      
      if (canMoveY) {
        return { x, y: nextY };
      }

      // Full collision - don't move
      return { x, y };
    }

    return { x: nextX, y: nextY };
  }
}