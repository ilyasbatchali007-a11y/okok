// SRC/utils/EventBus.ts
// Lightweight publish-subscribe event bus for decoupling game systems
//
// Purpose: Keep WebGL render calls completely separated from keyboard inputs
// and game state changes.

export type EventCallback<T = any> = (data: T) => void;

export interface IEventMap {
  [eventName: string]: any;
}

export class EventBus {
  private events: Map<string, Set<EventCallback>> = new Map();

  /**
   * Subscribe to an event
   * @param eventName - Name of the event to listen for
   * @param callback - Function to call when event is emitted
   * @returns Unsubscribe function
   */
  public on<T = any>(eventName: string, callback: EventCallback<T>): () => void {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }

    const callbacks = this.events.get(eventName)!;
    callbacks.add(callback as EventCallback);

    // Return unsubscribe function
    return () => {
      this.off(eventName, callback);
    };
  }

  /**
   * Subscribe to an event once (auto-unsubscribe after first trigger)
   */
  public once<T = any>(eventName: string, callback: EventCallback<T>): () => void {
    const wrappedCallback: EventCallback<T> = (data) => {
      this.off(eventName, wrappedCallback);
      callback(data);
    };

    return this.on(eventName, wrappedCallback);
  }

  /**
   * Unsubscribe from an event
   */
  public off<T = any>(eventName: string, callback: EventCallback<T>): void {
    const callbacks = this.events.get(eventName);
    if (callbacks) {
      callbacks.delete(callback as EventCallback);
      
      // Clean up empty sets
      if (callbacks.size === 0) {
        this.events.delete(eventName);
      }
    }
  }

  /**
   * Emit/fire an event with optional data
   */
  public emit<T = any>(eventName: string, data?: T): void {
    const callbacks = this.events.get(eventName);
    if (callbacks) {
      // Copy to array to prevent issues if callbacks modify subscriptions
      const callbacksArray = Array.from(callbacks);
      for (const callback of callbacksArray) {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event handler for "${eventName}":`, error);
        }
      }
    }
  }

  /**
   * Check if an event has any subscribers
   */
  public hasListeners(eventName: string): boolean {
    const callbacks = this.events.get(eventName);
    return callbacks ? callbacks.size > 0 : false;
  }

  /**
   * Get the number of subscribers for an event
   */
  public getListenerCount(eventName: string): number {
    const callbacks = this.events.get(eventName);
    return callbacks ? callbacks.size : 0;
  }

  /**
   * Remove all listeners for an event
   */
  public removeAllListeners(eventName?: string): void {
    if (eventName) {
      this.events.delete(eventName);
    } else {
      this.events.clear();
    }
  }

  /**
   * Clear all events and reset the bus
   */
  public clear(): void {
    this.events.clear();
  }

  /**
   * Get all registered event names
   */
  public getEventNames(): string[] {
    return Array.from(this.events.keys());
  }

  /**
   * Get statistics about the event bus
   */
  public getStats(): { totalEvents: number; totalListeners: number } {
    let totalListeners = 0;
    for (const callbacks of this.events.values()) {
      totalListeners += callbacks.size;
    }

    return {
      totalEvents: this.events.size,
      totalListeners
    };
  }
}

/**
 * Pre-defined game event types for type safety
 */
export const GameEvents = {
  // Player events
  PLAYER_MOVED: 'player:moved',
  PLAYER_ACTION: 'player:action',
  PLAYER_DAMAGED: 'player:damaged',
  PLAYER_DIED: 'player:died',
  
  // Input events
  KEY_PRESSED: 'input:key_pressed',
  KEY_RELEASED: 'input:key_released',
  MOUSE_CLICKED: 'input:mouse_clicked',
  MOUSE_MOVED: 'input:mouse_moved',
  
  // Render events
  RENDER_START: 'render:start',
  RENDER_END: 'render:end',
  TILE_DIRTY: 'render:tile_dirty',
  
  // Game state events
  GAME_PAUSE: 'game:pause',
  GAME_RESUME: 'game:resume',
  GAME_OVER: 'game:over',
  GAME_SAVE: 'game:save',
  GAME_LOAD: 'game:load',
  
  // Entity events
  ENTITY_SPAWNED: 'entity:spawned',
  ENTITY_DESPAWNED: 'entity:despawned',
  ENTITY_UPDATED: 'entity:updated',
  
  // Map events
  MAP_LOADED: 'map:loaded',
  MAP_CHUNK_LOADED: 'map:chunk_loaded',
  MAP_TILE_CHANGED: 'map:tile_changed'
} as const;

/**
 * Type-safe event emitter helper
 */
export interface ITypedEventBus<TEventMap extends IEventMap> {
  on<K extends keyof TEventMap>(event: K, callback: EventCallback<TEventMap[K]>): () => void;
  off<K extends keyof TEventMap>(event: K, callback: EventCallback<TEventMap[K]>): void;
  emit<K extends keyof TEventMap>(event: K, data?: TEventMap[K]): void;
}

/**
 * Create a typed event bus wrapper
 */
export function createTypedEventBus<TEventMap extends IEventMap>(
  bus: EventBus
): ITypedEventBus<TEventMap> {
  return {
    on: (event, callback) => bus.on(event as string, callback as EventCallback),
    off: (event, callback) => bus.off(event as string, callback as EventCallback),
    emit: (event, data) => bus.emit(event as string, data)
  };
}

// Export a global singleton instance for convenience
export const globalEventBus = new EventBus();

/**
 * Example usage:
 * 
 * // Subscribe to player movement
 * const unsubscribe = globalEventBus.on(GameEvents.PLAYER_MOVED, (data) => {
 *   console.log(`Player moved to ${data.x}, ${data.y}`);
 * });
 * 
 * // Emit player movement event
 * globalEventBus.emit(GameEvents.PLAYER_MOVED, { x: 100, y: 200 });
 * 
 * // Unsubscribe
 * unsubscribe();
 */
