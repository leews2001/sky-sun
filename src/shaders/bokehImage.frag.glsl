
//#version 300 es
//precision highp float;

uniform vec3 iResolution;
uniform sampler2D iChannel0;
 
void main() {

    vec2 I = gl_FragCoord.xy;
    vec2 r = iResolution.xy;

    vec4 O4 = vec4(0.0);

    // Initial sample position
    // vec2(1, -5) is an approximation of the golden angle, which gives a good distribution for bokeh sampling.
    // "magic weights." They ensure the gradient isn't just perfectly horizontal or vertical, but slanted.
    // the scaling factor (1/5000) controls the overall size of the bokeh effect. Adjusting this changes how far the samples spread out from the center.
    // This is a massive divisor used to shrink the screen coordinates down to a very tiny starting offset. 
    // If the starting vector p were too large, the first "jump" in the blur spiral 
    // would be miles away from the original pixel, making the image disappear. 
    // This scale keeps the blur kernel tightly contained around the center.

    vec2 p = vec2(
        dot(I + I - r, vec2(3.5,0)*0.0002),0.0);

    // Iterative sampling
    for (float i = 1.0; i < 4.0; i += 1.0 / i) {

        // Golden angle rotation matrix approximation
        p *= mat2(
            0.0, 0.061,
            1.413, 0.0
        ) - 0.737;

        // Accumulate texture samples
        O4 += texture(iChannel0, I / r + p * i / r);
    }

    gl_FragColor = O4 * 0.125; // Average the samples
    return;
}

