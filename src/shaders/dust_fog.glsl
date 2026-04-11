 
//------------------------------------------------------------------------------
// NOISE functions
float tri(in float x){return abs(fract(x)-.5);}
vec3 tri3(in vec3 p){return vec3( tri(p.z+tri(p.y*1.)), tri(p.z+tri(p.x*1.)), tri(p.y+tri(p.x*1.)));}
                            
float triNoise3d(in vec3 p, in float spd, in float time)
{
    float z=1.4;
	float rz = 0.;
    vec3 bp = p;
	for (float i=0.; i<=7.; i++ )
	{
        vec3 dg = tri3(bp*2.);
        p += (dg+time*spd);

        bp *= 1.8;
		z *= 1.5;
		p *= 1.2; 
        
        //rz+= (tri(p.z+tri(p.x+tri(p.y))))/z;

        rz+= (tri(p.x+tri(p.y+tri(p.z))))/z;

        bp += 0.14;
	}
	return rz;
}

//------------------------------------------------------------------------------
float x_fogmap(in vec3 p, in float d)
{
    // -- Scale time based on eye altitude for better aesthetics. Higher altitude = slower fog movement.
    // float t0 = iTime/ (1.+ 1.0* fEyeAttitude); 

    // -- Scale time based on wind intensity for better aesthetics. More wind = faster fog movement.
    float t0 = iTime * (0.13+ smoothstep(0., 1.0, fWindIntensity)); 

    p.y += t0*0.55;
    p.z += cos(p.z*.17)+ sin( p.x* .01133);

    //-- Add a base density based on wind intensity to ensure some fog even when noise is low
    float density = triNoise3d(p*1.41/(d+23.),.17, t0) * (1.-smoothstep(0.15,3.5,p.z))* (1.+ 0.33*fWindIntensity); 

    return density; 
}

vec3 dust_fog(
    in vec3 ambient_color, 
    in vec3 ro, 
    in vec3 rd, 
    in float mt, 
    in vec3 sunDir_)
{

    ro.y = ro.y- EARTH_RADIUS; 
    
    float d = 0.15; // Start distance
    
    vec3 lightCol = vec3(0.85, 0.6, 0.3)*.1; 
 
    for(int i=0; i<24; i++)
    {
        vec3  pos = ro + rd*d;
        pos = pos.zxy;
        float rz = x_fogmap(pos, d) *.33;
        
        if (rz > .01)
        {
            float grd =  clamp((rz - x_fogmap(pos+.8-float(i)*0.1,d))*3., 0.1, 1. );
            vec3 col2 = (lightCol*.5 + .9*lightCol*(1.7-grd))*0.955;
            ambient_color = 
                mix( ambient_color,
                    col2,
                    clamp(rz*smoothstep(d-0.,d+2.+d*.75, 25.), 0., 1.) 
                );
        } 
        d *= 1.5+0.3;
        if (d>mt)break;
        
    }
    return ambient_color;
}

//------------------------------------------------------------------------------