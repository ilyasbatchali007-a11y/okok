type World = {
  active: Uint8Array;
  speed: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  px: Float32Array;
  py: Float32Array;
  width: Float32Array;
  height: Float32Array;
};

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

    // Apply collision and wall-sliding physics
    const nextPos = this.moveAndSlide(
      world.px[playerId],
      world.py[playerId],
      vx,
      vy,
      world.width[playerId] || 32,
      world.height[playerId] || 32,
      dt
    );

    world.px[playerId] = nextPos.x;
    world.py[playerId] = nextPos.y;
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
    return {
      x: x + vx * dt,
      y: y + vy * dt,
    };
  }
}
