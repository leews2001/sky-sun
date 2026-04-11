

vec3 getTronGridPattern( vec3 position, vec3 rayDir, vec3 viewPos, vec3 surfaceNormal, float fCheckerboardScale) 
{

    // world → grid space
    //vec2 uv = position.xz * .25; // scale (adjust density)
    vec2 uv = 0.1*position.xz  / (fCheckerboardScale); // scale (adjust density)
    // === Anti-aliased grid ===
    vec2 d = fwidth(uv);

    vec2 grid = abs(fract(uv - 0.5) - 0.5) / d;

    // line intensity
    float line = min(grid.x, grid.y);
    float minorLine  = 1.0 - clamp(line, 0.0, 1.0);
        
    // === Major lines (every N cells) ===
    float majorScale = 20.0;
    vec2 majorUV = uv / majorScale;

    vec2 d2 = fwidth(majorUV);
    
    vec2 majorGrid = abs(fract(majorUV - 0.5) - 0.5) / d2;

    float majorLine = 1.0 - clamp(min(majorGrid.x, majorGrid.y), 0.0, 1.0);


    
    // === Distance fade ===
    float dist = length(position.xz);

    float fade= abs(dot(normalize(rayDir), surfaceNormal));
    fade = smoothstep(-.33, .7, fade);

    //float fade =  1.0;//exp(-dist * 0.0001); // Exponential fade for a more gradual effect
    // === Axis highlight (optional) ===
    float axisWidth = 1.2+ 10.* (viewPos.y - EARTH_RADIUS); // Adjust based on scale and distance

    float axisX = 1.0 - smoothstep(axisWidth, axisWidth + fwidth(position.x), abs(position.x));
    float axisZ = 1.0 - smoothstep(axisWidth, axisWidth + fwidth(position.z), abs(position.z));

    // === Colors ===
    vec3 baseColor  = vec3(0.08,0.01, 0.08);            // background
    vec3 gridColor  = vec3(0.0, 0.8, 0.0);  // green grid
    vec3 axisColorX = vec3(1.0, 0.2, 0.2);  // red X axis
    vec3 axisColorZ = vec3(0.2, 0.2, 1.0);  // blue Z axis
    vec3 minorColor  = vec3(0.2);          // grey
    vec3 majorColor  = vec3(1.0, 0.5, 0.0); // orange

    vec3 color = baseColor;

    minorLine *= (1.0 - majorLine); 
    // minor grid first
    color = mix(color, minorColor, minorLine * fade);

    // major grid overrides minor
    color = mix(color, majorColor, majorLine * fade);

    color = mix(color, axisColorX, axisX);
    color = mix(color, axisColorZ, axisZ);
    return color;
}