
// NOISE functions


// A simple, smooth 3D Value Noise
float smoothNoise(vec3 p) {
 
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f* f;
    //f = f * f * (3.0 - 2.0 * f); // Hermite interpolation (removes "sand" look)

    // Hash function to get random values at grid corners
    #define hash(p) fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123)
    
    float n000 = hash(i + vec3(0, 0, 0));
    float n100 = hash(i + vec3(1, 0, 0));
    float n010 = hash(i + vec3(0, 1, 0));
    float n110 = hash(i + vec3(1, 1, 0));
    float n001 = hash(i + vec3(0, 0, 1));
    float n101 = hash(i + vec3(1, 0, 1));
    float n011 = hash(i + vec3(0, 1, 1));
    float n111 = hash(i + vec3(1, 1, 1));

    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 1.85;
    float frequency = 1.73; // Base frequency
    
    for (int i = 0; i < 3; i++) { // 3 octaves is usually enough for "detail"
        value += amplitude * smoothNoise(p * frequency);
        p *= 2.02;      // Increase frequency for the next octave
        amplitude *= 0.5; // Decrease influence of finer ripples
    }
    return value;
}