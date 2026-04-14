/**
 * A utility to bridge high-level engine settings with low-level GPU uniforms.
 * It uses a Proxy to track changes and a dirty-queue to batch updates.
 */

export class UniformProxy {
    // We store which properties changed since the last frame
    private static dirtyProps = new Set<string>();

    //noting that the mapping defines the schema for what the Proxy should track.
    static create<T extends object>(target: T, mapping: any): T {
        return new Proxy(target, {
            set: (obj, prop: string, value) => {
                if ((obj as any)[prop] !== value) {
                    (obj as any)[prop] = value;
                    this.dirtyProps.add(prop); // Mark as dirty
                }
                return true;
            }
        });
    }

    // Called ONCE per frame in your render loop
    static sync(target: any, mapping: any) {
        if (this.dirtyProps.size === 0) return;

        this.dirtyProps.forEach(prop => {
            if (mapping[prop]) {
                const val = target[prop];
                mapping[prop].forEach((u: any) => u.value = val);
            }
        });
        
        this.dirtyProps.clear(); // Reset for next frame
    }
}