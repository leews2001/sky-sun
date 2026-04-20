uniform int iFrame;
uniform vec3 iResolution;
uniform sampler2D iChannel0;
uniform sampler2D uBlueNoiseTex; // 256x256 Blue Noise from Dupuy or the Paper

uniform bool bEnableDither; // Toggle for dithering effect
uniform bool bEnableGrain; // Toggle for film grain effect
uniform float fGrainWeight;

 

void main() {

    vec2 I = gl_FragCoord.xy;
    vec2 r = iResolution.xy;

    vec4 col4 = vec4(0.0);

    // Initial sample position
    // vec2(1, -5) is an approximation of the golden angle, which gives a good distribution for bokeh sampling.
    // "magic weights." They ensure the gradient isn't just perfectly horizontal or vertical, but slanted.
    // the scaling factor (1/5000) controls the overall size of the bokeh effect. 
    // Adjusting this changes how far the samples spread out from the center.
    // This is a massive divisor used to shrink the screen coordinates down to a very tiny starting offset. 
    // If the starting vector p were too large, the first "jump" in the blur spiral 
    // would be miles away from the original pixel, making the image disappear. 
    // This scale keeps the blur kernel tightly contained around the center.

    // vec2 p = vec2( dot(I + I - r, vec2(3.5,0)*0.0002),0.0);

    vec2 p = vec2( dot(I + I - r, vec2(1,-5)*0.00002),0.0);

    //: Iterative sampling, 4 samples
    
    for (float i = 1.0; i <  4.; i += 1.0 / i) {

        // Golden angle rotation matrix approximation
        p *= mat2(
            0.0, 0.061,
            1.413, 0.0
        ) - 0.737;

        // Accumulate texture samples
        col4 += texture(iChannel0, I / r + p * i / r);
    }

    //: early return for performance: if both grain and dither are disabled,
    //: we can skip the noise calculations entirely and just output the averaged color.

    if ( bEnableGrain == false && bEnableDither == false) {
        gl_FragColor = col4 * 0.125; // Average the samples and half
        return;
    }

    //--------- noise
    vec3 color = col4.rgb * 0.125 ; // Average the samples and half
   
    // 1. Get the Blue Noise value
    // We animate the lookup using the paper's logic: 
    // Shift the coordinates by a Golden Ratio sequence to maximize "freshness"
    vec2 size = vec2(379.0);  // magic choice for aesthetic grain pattern. The paper suggests using a prime number or the texture size to ensure a good distribution of noise samples. 379 is a prime number close to 512, which helps to avoid repeating patterns in the noise.
    // A better way to jitter the lookup:
    // We use a high-frequency jump so the grain "boils"
    float goldenRatio = 1.61803398875;
    float frame = float(iFrame % 8192); // Use a larger window than 64
   // frame = float(iFrame); // For testing, use the raw frame count to see the noise pattern evolve more clearly. In production, you might want to wrap this to avoid precision issues.

    // We multiply the frame by a large prime or the size of the texture
    // This ensures the offset "teleports" to a new random-ish spot
    vec2 offset = fract(vec2(frame * goldenRatio, frame * goldenRatio * goldenRatio)) * size;

    vec3 noise_rgb = texture(uBlueNoiseTex, (I + offset) / size).rgb; // Get RGB noise for potential color dithering
    float noise = texture(uBlueNoiseTex, (gl_FragCoord.xy + offset) / size).r;
    noise =  dot(noise_rgb, vec3(0.299, 0.587, 0.114));

    // 2. Dithering (Removing Banding)
    // We shift the color slightly based on noise BEFORE the 8-bit conversion
    // 1.0/255.0 is the width of one 8-bit color step

    if ( bEnableDither == true) {
        color += ((noise - 0.5) * (6.0 / 255.0));
    }

    if ( bEnableGrain == true){ 
        // 3. Film Grain (Visual Texture)
        // We use the same noise but with a larger multiplier and luma masking
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        float grainWeight = pow(luma, 0.5) * (1.0 - luma); 
        color += (noise - 0.5) * fGrainWeight * grainWeight; // 0.04 is the max grain intensity, modulated by brightness
    }


    gl_FragColor = vec4(color, 1.0);

    return;
}

