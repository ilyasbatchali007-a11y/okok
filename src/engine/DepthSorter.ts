// SRC/engine/DepthSorter.ts
// Depth sorting for isometric rendering with pipeline split
// 
// Static Pipeline: Flat ground tiles (no depth sorting needed, drawn first)
// Dynamic Pipeline: Tall structures, trees, entities (sorted back-to-front)
//
// Depth formula: Depth = X + Y + 2*Z (isometric depth key)

export interface ISortableObject {
  x: number;      // World X position (tile coordinates or pixel)
  y: number;      // World Y position (tile coordinates or pixel)
  z: number;      // Elevation/Z height (for multi-level structures)
  tileId?: number;
  elevation?: number;
  rotation?: number;
  collisionFlags?: number;
  animationFrame?: number;
  entityType?: 'ground' | 'structure' | 'entity' | 'tree';
}

export interface SortedRenderItem extends ISortableObject {
  depthKey: number;
}

export class DepthSorter {
  // Static pipeline buffer (ground tiles - no sorting needed)
  private staticBuffer: SortedRenderItem[] = [];
  
  // Dynamic pipeline buffer (tall objects - sorted every frame)
  private dynamicBuffer: SortedRenderItem[] = [];
  
  // Combined sorted output
  private sortedOutput: SortedRenderItem[] = [];

  /**
   * Calculate isometric depth key
   * Formula: Depth = X + Y + 2*Z
   * Higher values = further back in isometric view
   */
  public calculateDepthKey(x: number, y: number, z: number = 0): number {
    return x + y + 2 * z;
  }

  /**
   * Add object to appropriate pipeline
   */
  public addObject(obj: ISortableObject): void {
    const itemType = obj.entityType || 'ground';
    
    const renderItem: SortedRenderItem = {
      ...obj,
      depthKey: this.calculateDepthKey(obj.x, obj.y, obj.z || 0)
    };

    if (itemType === 'ground') {
      this.staticBuffer.push(renderItem);
    } else {
      this.dynamicBuffer.push(renderItem);
    }
  }

  /**
   * Clear all buffers
   */
  public clear(): void {
    this.staticBuffer.length = 0;
    this.dynamicBuffer.length = 0;
    this.sortedOutput.length = 0;
  }

  /**
   * Sort dynamic objects and combine with static objects
   * Returns items in render order (front-to-back for proper alpha blending,
   * or back-to-front for opaque objects with depth testing)
   */
  public sort(): SortedRenderItem[] {
    // Static objects are already in optimal order (typically row-major)
    // Dynamic objects need depth sorting
    
    // Sort dynamic buffer by depth key (back-to-front: higher depth first)
    this.dynamicBuffer.sort((a, b) => b.depthKey - a.depthKey);
    
    // Combine: static first (ground), then dynamic sorted (tall objects/entities)
    this.sortedOutput = [...this.staticBuffer, ...this.dynamicBuffer];
    
    return this.sortedOutput;
  }

  /**
   * Get only dynamic objects (for separate render pass)
   */
  public getDynamicObjects(): SortedRenderItem[] {
    return [...this.dynamicBuffer].sort((a, b) => b.depthKey - a.depthKey);
  }

  /**
   * Get only static objects (ground tiles)
   */
  public getStaticObjects(): SortedRenderItem[] {
    return [...this.staticBuffer];
  }

  /**
   * Batch process: add multiple objects and sort in one call
   */
  public processAndSort(objects: ISortableObject[]): SortedRenderItem[] {
    this.clear();
    
    for (const obj of objects) {
      this.addObject(obj);
    }
    
    return this.sort();
  }

  /**
   * Update dynamic objects only (for entity movement without re-sorting ground)
   */
  public updateDynamicObjects(objects: ISortableObject[]): SortedRenderItem[] {
    this.dynamicBuffer.length = 0;
    
    for (const obj of objects) {
      this.addObject(obj);
    }
    
    // Re-sort only dynamic objects
    this.dynamicBuffer.sort((a, b) => b.depthKey - a.depthKey);
    
    // Recombine
    this.sortedOutput = [...this.staticBuffer, ...this.dynamicBuffer];
    
    return this.sortedOutput;
  }

  /**
   * Get render count for statistics
   */
  public getStats(): { staticCount: number; dynamicCount: number; totalCount: number } {
    return {
      staticCount: this.staticBuffer.length,
      dynamicCount: this.dynamicBuffer.length,
      totalCount: this.staticBuffer.length + this.dynamicBuffer.length
    };
  }
}

/**
 * Entity wrapper for depth sorting
 * Used for players, NPCs, and other moving entities
 */
export interface IEntity {
  id: number;
  worldX: number;     // Pixel or tile X
  worldY: number;     // Pixel or tile Y
  height: number;     // Entity height for Z calculation
  sprite?: string;
}

export function createEntityRenderData(entity: IEntity): ISortableObject {
  // Convert pixel position to approximate tile position for depth
  const tileX = Math.floor(entity.worldX / 64);
  const tileY = Math.floor(entity.worldY / 64);
  
  return {
    x: tileX,
    y: tileY,
    z: 0, // Entities are on ground level
    entityType: 'entity'
  };
}

/**
 * Structure wrapper for depth sorting (trees, buildings, etc.)
 */
export interface IStructure {
  tileX: number;
  tileY: number;
  baseElevation: number;
  structureHeight: number;
  tileId: number;
}

export function createStructureRenderData(structure: IStructure): ISortableObject {
  return {
    x: structure.tileX,
    y: structure.tileY,
    z: structure.baseElevation + Math.floor(structure.structureHeight / 2),
    tileId: structure.tileId,
    elevation: structure.baseElevation,
    entityType: 'structure'
  };
}
