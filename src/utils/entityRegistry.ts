export interface Entity {
  id: string;
}

export class EntityRegistry<T extends Entity> {
  private entities = new Map<string, T>();

  add(entity: T): void {
    this.entities.set(entity.id, entity);
  }

  remove(id: string): void {
    this.entities.delete(id);
  }

  get(id: string): T | undefined {
    return this.entities.get(id);
  }

  all(): T[] {
    return [...this.entities.values()];
  }

  query(predicate: (entity: T) => boolean): T[] {
    return this.all().filter(predicate);
  }

  /** Plugs directly into ConsoleApi.saveGameState from the resilience-primitives addendum. */
  toJSON(): T[] {
    return this.all();
  }

  static fromJSON<T extends Entity>(data: T[]): EntityRegistry<T> {
    const registry = new EntityRegistry<T>();
    for (const e of data) registry.add(e);
    return registry;
  }
}
