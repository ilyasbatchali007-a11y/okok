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
  
  private viewportWidth: number = 800;
  private viewportHeight: number = 600;
  
  private mapWidth: number = WORLD_WIDTH;
  private mapHeight: number = WORLD_HEIGHT;
  
  // For isometric projection
  private isHalfWidth: number = TILE_SIZE / 2;
  private isHalfHeight: number = TILE_SIZE / 4;

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
  }

  /**
   * Set map bounds for clamping
   */
  public setMapBounds(width: number, height: number): void {
    this.mapWidth = width;
    this.mapHeight = height;
  }

  /**
   * Update camera position with lerp towards target
   * Call every frame before rendering
   */
  public update(deltaTime: number = 1): void {
    if (!this.target) return;

    // Calculate ideal camera position (centered on target)
    const targetX = this.target.x - this.viewportWidth / 2;
    const targetY = this.target.y - this.viewportHeight / 2;

    // Smooth interpolation (Lerp)
    // Formula: CamPos = CamPos + (TargetPos - CamPos) * smoothFactor
    this.x = lerp(this.x, targetX, this.smoothFactor * deltaTime);
    this.y = lerp(this.y, targetY, this.smoothFactor * deltaTime);

    // Clamp to map bounds
    this.clampToBounds();
  }

  /**
   * Instantly snap camera to position (no interpolation)
   */
  public snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.clampToBounds();
  }

  /**
   * Snap camera to target immediately
   */
  public snapToTarget(): void {
    if (!this.target) return;
    
    this.x = this.target.x - this.viewportWidth / 2;
    this.y = this.target.y - this.viewportHeight / 2;
    this.clampToBounds();
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
  }

  /**
   * Set zoom level
   */
  public setZoom(zoom: number): void {
    this.zoom = clamp(zoom, 0.5, 3.0);
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
   */
  public worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: worldX - this.x,
      y: worldY - this.y
    };
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  public screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: screenX + this.x,
      y: screenY + this.y
    };
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
   * Returns a 4x4 matrix as Float32Array (column-major order for WebGL)
   */
  public getViewProjectionMatrix(): Float32Array {
    // Simple orthographic projection matrix
    const left = this.x;
    const right = this.x + this.viewportWidth;
    const top = this.y;
    const bottom = this.y + this.viewportHeight;
    
    // Orthographic projection
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    
    return new Float32Array([
      2 * lr, 0, 0, 0,
      0, 2 * bt, 0, 0,
      0, 0, -1, 0,
      (right + left) * lr, (top + bottom) * bt, 0, 1
    ]);
  }

  /**
   * Get view matrix (camera transform only, without projection)
   */
  public getViewMatrix(): Float32Array {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -this.x, -this.y, 0, 1
    ]);
  }

  /**
   * Get projection matrix for current viewport
   */
  public getProjectionMatrix(): Float32Array {
    const left = 0;
    const right = this.viewportWidth;
    const top = 0;
    const bottom = this.viewportHeight;
    
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    
    return new Float32Array([
      2 * lr, 0, 0, 0,
      0, 2 * bt, 0, 0,
      0, 0, -1, 0,
      (right + left) * lr, (top + bottom) * bt, 0, 1
    ]);
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
