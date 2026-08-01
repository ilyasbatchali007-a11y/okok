// SRC/engine/Camera.ts
// Player-centered camera system with smooth interpolation and viewport clamping
//
// Features:
// - Target binding to player entity
// - Smooth Lerp interpolation for camera movement
// - Viewport clamping to prevent scrolling beyond map borders
// - View-projection matrix calculation for shader integration

import { lerp, clamp } from '../utils/MathUtils';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../config/Constants';
import { TILE_SIZE } from '../config/MapData';

export interface ICameraTarget {
  x: number;      // World X position (pixels)
  y: number;      // World Y position (pixels)
}

export interface ICameraState {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export class Camera {
  private x: number = 0;
  private y: number = 0;
  private zoom: number = 1;
  private rotation: number = 0;
  
  private target: ICameraTarget | null = null;
  private smoothFactor: number = 0.1; // Lerp factor (0-1, higher = snappier)
  private lambda: number = -Math.log(1 - 0.1); // Exponential decay constant for frame-rate independence
  private readonly EPSILON: number = 0.01; // Position convergence threshold in world units
  
  private viewportWidth: number = 800;
  private viewportHeight: number = 600;
  
  private mapWidth: number = WORLD_WIDTH;
  private mapHeight: number = WORLD_HEIGHT;
  
  // For isometric projection
  private isHalfWidth: number = TILE_SIZE / 2;
  private isHalfHeight: number = TILE_SIZE / 4;
  
  // Matrix caching to avoid allocations
  private viewProjectionMatrix: Float32Array = new Float32Array(16);
  private viewMatrix: Float32Array = new Float32Array(16);
  private projectionMatrix: Float32Array = new Float32Array(16);
  private isMatrixDirty: boolean = true;

  /**
   * Set the camera target (player/entity to follow)
   */
  public setTarget(target: ICameraTarget): void {
    this.target = target;
  }

  /**
   * Clear the current target
   */
  public clearTarget(): void {
    this.target = null;
  }

  /**
   * Set smooth interpolation factor (0-1)
   * Higher values = snappier camera, lower = smoother/slower
   */
  public setSmoothFactor(factor: number): void {
    this.smoothFactor = clamp(factor, 0.01, 1.0);
    this.lambda = -Math.log(1 - this.smoothFactor);
  }

  /**
   * Get current smooth factor
   */
  public getSmoothFactor(): number {
    return this.smoothFactor;
  }

  /**
   * Set viewport dimensions
   */
  public setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.isMatrixDirty = true;
  }

  /**
   * Set map bounds for clamping
   */
  public setMapBounds(width: number, height: number): void {
    this.mapWidth = width;
    this.mapHeight = height;
    this.isMatrixDirty = true;
  }

  /**
   * Update camera position with frame-rate independent exponential decay
   * Call every frame before rendering
   * @returns true if camera moved, false otherwise
   */
  public update(deltaTime: number = 1): boolean {
    if (!this.target) return false;

    // Calculate ideal camera position (centered on target)
    let targetX = this.target.x - this.viewportWidth / 2;
    let targetY = this.target.y - this.viewportHeight / 2;

    // Clamp target to map bounds BEFORE interpolation
    // This prevents overshooting and vibration against boundaries
    const maxX = Math.max(0, this.mapWidth - this.viewportWidth);
    const maxY = Math.max(0, this.mapHeight - this.viewportHeight);
    targetX = Math.max(0, Math.min(maxX, targetX));
    targetY = Math.max(0, Math.min(maxY, targetY));

    // Check if already within epsilon threshold of target
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    
    if (Math.abs(dx) < this.EPSILON && Math.abs(dy) < this.EPSILON) {
      // Snap to target and indicate no movement
      this.x = targetX;
      this.y = targetY;
      this.isMatrixDirty = false;
      return false;
    }

    // Frame-rate independent exponential decay
    // Formula: factor = 1 - e^(-lambda * dt)
    const factor = 1 - Math.exp(-this.lambda * deltaTime);
    
    // Apply interpolation to pre-clamped targets
    this.x = lerp(this.x, targetX, factor);
    this.y = lerp(this.y, targetY, factor);
    
    // Mark matrices as dirty since position changed
    this.isMatrixDirty = true;
    return true;
  }

  /**
   * Instantly snap camera to position (no interpolation)
   */
  public snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.clampToBounds();
    this.isMatrixDirty = true;
  }

  /**
   * Snap camera to target immediately
   */
  public snapToTarget(): void {
    if (!this.target) return;
    
    this.x = this.target.x - this.viewportWidth / 2;
    this.y = this.target.y - this.viewportHeight / 2;
    this.clampToBounds();
    this.isMatrixDirty = true;
  }

  /**
   * Clamp camera position to prevent showing empty space beyond map borders
   */
  private clampToBounds(): void {
    // Calculate maximum scroll positions
    const maxX = Math.max(0, this.mapWidth - this.viewportWidth);
    const maxY = Math.max(0, this.mapHeight - this.viewportHeight);

    // Clamp camera position
    this.x = clamp(this.x, 0, maxX);
    this.y = clamp(this.y, 0, maxY);
  }

  /**
   * Manually move camera by offset
   */
  public move(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clampToBounds();
    this.isMatrixDirty = true;
  }

  /**
   * Set zoom level
   */
  public setZoom(zoom: number): void {
    this.zoom = clamp(zoom, 0.5, 3.0);
    this.isMatrixDirty = true;
  }

  /**
   * Get current zoom level
   */
  public getZoom(): number {
    return this.zoom;
  }

  /**
   * Set rotation (for isometric angle adjustments)
   */
  public setRotation(angleRadians: number): void {
    this.rotation = angleRadians;
  }

  /**
   * Get camera X position
   */
  public getX(): number {
    return this.x;
  }

  /**
   * Get camera Y position
   */
  public getY(): number {
    return this.y;
  }

  /**
   * Get full camera state
   */
  public getState(): ICameraState {
    return {
      x: this.x,
      y: this.y,
      zoom: this.zoom,
      rotation: this.rotation
    };
  }

  /**
   * Convert world coordinates to screen coordinates
   * @param out Optional output object to reuse (avoids allocation)
   */
  public worldToScreen(worldX: number, worldY: number, out?: { x: number; y: number }): { x: number; y: number } {
    const result = out || { x: 0, y: 0 };
    result.x = worldX - this.x;
    result.y = worldY - this.y;
    return result;
  }

  /**
   * Convert screen coordinates to world coordinates
   * @param out Optional output object to reuse (avoids allocation)
   */
  public screenToWorld(screenX: number, screenY: number, out?: { x: number; y: number }): { x: number; y: number } {
    const result = out || { x: 0, y: 0 };
    result.x = screenX + this.x;
    result.y = screenY + this.y;
    return result;
  }

  /**
   * Convert world tile coordinates to isometric screen position
   */
  public tileToScreen(tileCol: number, tileRow: number): { x: number; y: number } {
    const worldX = tileCol * TILE_SIZE;
    const worldY = tileRow * TILE_SIZE;
    
    // Isometric transformation
    const isoX = (tileCol - tileRow) * this.isHalfWidth;
    const isoY = (tileCol + tileRow) * this.isHalfHeight;
    
    // Apply camera offset
    const screenX = isoX - this.x + this.viewportWidth / 2;
    const screenY = isoY - this.y + 100; // Top padding
    
    return { x: screenX, y: screenY };
  }

  /**
   * Check if a world point is visible in the current viewport
   */
  public isVisible(worldX: number, worldY: number, padding: number = 0): boolean {
    return (
      worldX >= this.x - padding &&
      worldX <= this.x + this.viewportWidth + padding &&
      worldY >= this.y - padding &&
      worldY <= this.y + this.viewportHeight + padding
    );
  }

  /**
   * Check if a tile is visible in the current viewport
   */
  public isTileVisible(tileCol: number, tileRow: number): boolean {
    const worldX = tileCol * TILE_SIZE;
    const worldY = tileRow * TILE_SIZE;
    return this.isVisible(worldX, worldY, TILE_SIZE);
  }

  /**
   * Get view-projection matrix for shader uniform
   * Returns a cached 4x4 matrix as Float32Array (column-major order for WebGL)
   */
  public getViewProjectionMatrix(): Float32Array {
    if (!this.isMatrixDirty) {
      return this.viewProjectionMatrix;
    }
    
    // Simple orthographic projection matrix
    const left = this.x;
    const right = this.x + this.viewportWidth;
    const top = this.y;
    const bottom = this.y + this.viewportHeight;
    
    // Orthographic projection
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    
    this.viewProjectionMatrix[0] = 2 * lr;
    this.viewProjectionMatrix[1] = 0;
    this.viewProjectionMatrix[2] = 0;
    this.viewProjectionMatrix[3] = 0;
    this.viewProjectionMatrix[4] = 0;
    this.viewProjectionMatrix[5] = 2 * bt;
    this.viewProjectionMatrix[6] = 0;
    this.viewProjectionMatrix[7] = 0;
    this.viewProjectionMatrix[8] = 0;
    this.viewProjectionMatrix[9] = 0;
    this.viewProjectionMatrix[10] = -1;
    this.viewProjectionMatrix[11] = 0;
    this.viewProjectionMatrix[12] = (right + left) * lr;
    this.viewProjectionMatrix[13] = (top + bottom) * bt;
    this.viewProjectionMatrix[14] = 0;
    this.viewProjectionMatrix[15] = 1;
    
    this.isMatrixDirty = false;
    return this.viewProjectionMatrix;
  }

  /**
   * Get view matrix (camera transform only, without projection)
   * Returns a cached 4x4 matrix as Float32Array
   */
  public getViewMatrix(): Float32Array {
    if (!this.isMatrixDirty) {
      return this.viewMatrix;
    }
    
    this.viewMatrix[0] = 1;
    this.viewMatrix[1] = 0;
    this.viewMatrix[2] = 0;
    this.viewMatrix[3] = 0;
    this.viewMatrix[4] = 0;
    this.viewMatrix[5] = 1;
    this.viewMatrix[6] = 0;
    this.viewMatrix[7] = 0;
    this.viewMatrix[8] = 0;
    this.viewMatrix[9] = 0;
    this.viewMatrix[10] = 1;
    this.viewMatrix[11] = 0;
    this.viewMatrix[12] = -this.x;
    this.viewMatrix[13] = -this.y;
    this.viewMatrix[14] = 0;
    this.viewMatrix[15] = 1;
    
    this.isMatrixDirty = false;
    return this.viewMatrix;
  }

  /**
   * Get projection matrix for current viewport
   * Returns a cached 4x4 matrix as Float32Array
   */
  public getProjectionMatrix(): Float32Array {
    if (!this.isMatrixDirty) {
      return this.projectionMatrix;
    }
    
    const left = 0;
    const right = this.viewportWidth;
    const top = 0;
    const bottom = this.viewportHeight;
    
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    
    this.projectionMatrix[0] = 2 * lr;
    this.projectionMatrix[1] = 0;
    this.projectionMatrix[2] = 0;
    this.projectionMatrix[3] = 0;
    this.projectionMatrix[4] = 0;
    this.projectionMatrix[5] = 2 * bt;
    this.projectionMatrix[6] = 0;
    this.projectionMatrix[7] = 0;
    this.projectionMatrix[8] = 0;
    this.projectionMatrix[9] = 0;
    this.projectionMatrix[10] = -1;
    this.projectionMatrix[11] = 0;
    this.projectionMatrix[12] = (right + left) * lr;
    this.projectionMatrix[13] = (top + bottom) * bt;
    this.projectionMatrix[14] = 0;
    this.projectionMatrix[15] = 1;
    
    this.isMatrixDirty = false;
    return this.projectionMatrix;
  }

  /**
   * Get frustum bounds for culling
   */
  public getFrustumBounds(padding: number = 0): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    return {
      minX: this.x - padding,
      minY: this.y - padding,
      maxX: this.x + this.viewportWidth + padding,
      maxY: this.y + this.viewportHeight + padding
    };
  }

  /**
   * Get visible tile range for rendering optimization
   */
  public getVisibleTileRange(): {
    minCol: number;
    minRow: number;
    maxCol: number;
    maxRow: number;
  } {
    const padding = TILE_SIZE * 2;
    const frustum = this.getFrustumBounds(padding);
    
    return {
      minCol: Math.max(0, Math.floor(frustum.minX / TILE_SIZE)),
      minRow: Math.max(0, Math.floor(frustum.minY / TILE_SIZE)),
      maxCol: Math.min(Math.ceil(this.mapWidth / TILE_SIZE), Math.ceil(frustum.maxX / TILE_SIZE)),
      maxRow: Math.min(Math.ceil(this.mapHeight / TILE_SIZE), Math.ceil(frustum.maxY / TILE_SIZE))
    };
  }
}

/**
 * Create a camera bound to a player entity
 */
export function createPlayerCamera(
  player: ICameraTarget,
  viewportWidth: number,
  viewportHeight: number,
  smoothFactor: number = 0.1
): Camera {
  const camera = new Camera();
  camera.setTarget(player);
  camera.setViewport(viewportWidth, viewportHeight);
  camera.setSmoothFactor(smoothFactor);
  
  return camera;
}
