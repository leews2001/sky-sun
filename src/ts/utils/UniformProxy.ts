/**
 * A utility to bridge high-level engine settings with low-level GPU uniforms.
 * It uses a Proxy to track changes and a dirty-queue to batch updates.
 */

export class UniformProxy {
    // We store which properties changed since the last frame
    private static dirtyQueue = new Set<string>();

    /**
     * Creates a proxied version of the settings object.
     * * Note: The 'mapping' parameter is functionally "bound" to this Proxy instance. 
     * We pass it here to validate that only properties defined in the schema trigger 
     * the dirty-queue. This ensures internal flags (like _prevRoll) don't cause 
     * unnecessary shader synchronization overhead.
     */
    //noting that the mapping defines the schema for what the Proxy should track.
    static create<T extends object>(target: T, mapping: any): T {
        return new Proxy(target, {
            set: (obj, prop: string, value) => {
                if ((obj as any)[prop] !== value) {
                    (obj as any)[prop] = value;
                    // Only flag for GPU sync if the property exists in our shader mapping
                    if (prop in mapping) {
                        this.dirtyQueue.add(prop);
                    }
                }
                return true;
            }
        });
    }

    /**
     * Pull-based synchronization. Call this once per frame in the render loop.
     */
    static sync(target: any, mapping: Record<string, any[]>) {

        if (this.dirtyQueue.size === 0) return;

        this.dirtyQueue.forEach(prop => {
            const uniforms = mapping[prop];
            if (uniforms) {
                const newValue = target[prop];
                for (let i = 0; i < uniforms.length; i++) {
                    uniforms[i].value = newValue;
                }
            }
        });

        this.dirtyQueue.clear();
    }
}