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
    return {
      x: x + vx * dt,
      y: y + vy * dt,
    };
  }
}