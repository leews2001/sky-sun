// MovementController.ts
import * as THREE from 'three';
import { quat, mat3, vec3 } from 'gl-matrix';



function log_vector(label: string, v: vec3, precision: number = 2): void {
  console.log(
    `${label}$: (${v[0].toFixed(precision)}, ${v[1].toFixed(precision)}, ${v[2].toFixed(precision)})`
  );
}



export class MovementController {
    
    // public cameraMat3 = new THREE.Matrix3();  // Three.js Matrix3 for uniforms
    public cameraMat3  = mat3.create(); // gl-matrix mat3 for calculations
    public camYPos : number = .05; // Camera Y position for uniform updates
    public camFOV: number = 80.0; // Camera Field of View;

    private readonly _camRot = mat3.create();     // reuse mat3
    private readonly _axisRight = vec3.create();  // reuse vectors
    private readonly _axisUp = vec3.create();
    private readonly _axisForward = vec3.create();
    private readonly _qPitch = quat.create();     // reuse quats
    private readonly _qYaw = quat.create();
    private readonly _qRoll = quat.create();
    private readonly cameraQuat = quat.create(); // identity

    private _idleTime = 0;

    public applyIdleMotion(deltaTime: number) {
        this._idleTime += deltaTime;

        // 1. Breathing (Up/Down) - ~0.25Hz (1 breath every 4s)
        const breath = Math.sin(this._idleTime * 1.5) * 0.00005;

        // 2. Head Drift (Wandering)
        //const driftYaw = Math.cos(this._idleTime * 0.7) * 0.00005;
        // half of breathing pitch
        const driftPitch = Math.sin(this._idleTime * 0.4) * 0.000019;

        // 3. Natural Micro-Roll
        const microRoll = Math.cos(this._idleTime * 1.1) * 0.00013;

        // 4. Random Jitter (Muscle twitch)
        const jitter = (Math.random() - 0.5) * 0.00025;

        // Inject these into your update logic
        // You can pass these into your existing update() as deltas
        this.update(
            breath + driftPitch + jitter, // dPitch
            jitter* 1.21,//driftYaw,                     // dYaw
            jitter*1.13+ microRoll                     // dRoll
        );
    }

    public euler: { roll: number; pitch: number; yaw: number } = {
        roll: 0,
        pitch: 0,
        yaw: 0,
    };
    
    

  constructor() {
    // Initialize cameraQuat to identity
    quat.identity(this.cameraQuat);
    // Initialize cameraMat3 to identity
//    this.cameraMat3.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
    mat3.identity(this.cameraMat3);

    mat3.fromQuat(this._camRot, this.cameraQuat);

    // // Fill axis vectors from matrix (avoids vec3.fromValues allocations)
    vec3.set(this._axisRight,   this._camRot[0], this._camRot[1], this._camRot[2]);
    vec3.set(this._axisUp,      this._camRot[3], this._camRot[4], this._camRot[5]);
    vec3.set(this._axisForward, this._camRot[6], this._camRot[7], this._camRot[8]);
  }

// public update( 
//     dPitch: number, 
//     dYaw: number, 
//     dRoll: number 
// ): { roll: number; pitch: number; yaw: number } {

//     // 1. Initial basis extraction (using the previous frame's orientation)
//     // We use this to define the local axes for the current delta movement.
//     mat3.fromQuat(this._camRot, this.cameraQuat);
//     vec3.set(this._axisRight,   this._camRot[0], this._camRot[1], this._camRot[2]);
//     vec3.set(this._axisUp,      this._camRot[3], this._camRot[4], this._camRot[5]);
//     vec3.set(this._axisForward, this._camRot[6], this._camRot[7], this._camRot[8]);

//     // 2. Tally the Euler angles (Note: This is purely for your UI/Logging)
//     this.euler.pitch += dPitch;
//     this.euler.roll  += dRoll;
//     this.euler.yaw   += dYaw;

//     // 3. Build incremental rotations
//     // If your Pitch was inverted, we negate it here so +Delta = Nose Up physically.
//     quat.setAxisAngle(this._qPitch, this._axisRight,   -dPitch); 
//     quat.setAxisAngle(this._qYaw,   this._axisUp,      dYaw);
//     quat.setAxisAngle(this._qRoll,  this._axisForward, dRoll); 

//     // 4. Apply Rotations 
//     // We multiply on the RIGHT (local space) to prevent gimbal locking.
//     quat.multiply(this.cameraQuat, this.cameraQuat, this._qYaw);
//     quat.multiply(this.cameraQuat, this.cameraQuat, this._qPitch);
//     quat.multiply(this.cameraQuat, this.cameraQuat, this._qRoll);
//     quat.normalize(this.cameraQuat, this.cameraQuat);

//     // 5. THE SOURCE OF TRUTH: Update the final Camera Matrix
//     // This replaces your manual .set(...) logic which is prone to typos.
//     mat3.fromQuat(this.cameraMat3, this.cameraQuat);

//     // 6. Refresh vectors from the ACTUAL matrix being sent to the shader
//     // This ensures what you see in the logs is exactly what is on screen.
//     const rX = this.cameraMat3[0], rY = this.cameraMat3[1], rZ = this.cameraMat3[2]; // Right
//     const uX = this.cameraMat3[3], uY = this.cameraMat3[4], uZ = this.cameraMat3[5]; // Up
//     const fX = this.cameraMat3[6], fY = this.cameraMat3[7], fZ = this.cameraMat3[8]; // Forward

//     // 7. Geometric derivation of return values
//     // We pass the fresh vector components directly.
//     const pitch = this.angleToGroundPlane_v1({ x: fX, y: fY, z: fZ });
//     const yaw   = this.yawToForward({ x: fX, y: fY, z: fZ });
//     const roll  = this.rollToUp({ x: rX, y: rY, z: rZ }, { x: uX, y: uY, z: uZ });

//     return { roll, pitch, yaw };
// }

// /**
//  * PITCH: Angle to Ground Plane
//  * Use atan2(-y, horiz) because in world space, a negative Forward.y 
//  * means the camera is looking DOWN. We negate it to return +37.3 for Nose Up.
//  */
// private angleToGroundPlane_v1(fwd: {x: number, y: number, z: number}): number {
//     const horizontalLen = Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z);
//     // Negate fwd.y to match the UI expectation (Up = Positive)
//     return Math.atan2(-fwd.y, horizontalLen) * (180.0 / Math.PI);
// }

// /**
//  * ROLL: Angle relative to horizon
//  * We use both Right and Up to ensure the angle is correct past 90 degrees.
//  */
// private rollToUp(right: {x: number, y: number, z: number}, up: {x: number, y: number, z: number}): number {
//     // atan2(y, x) where y is the 'Right-wing vertical' and x is 'Up-vector vertical'
//     return Math.atan2(right.y, up.y) * (180.0 / Math.PI);
// }


  public update( 
    dPitch: number,  // delta pitch in radians
    dYaw: number,  // delta yaw in radians
    dRoll: number ) // delta roll in radians
    : { roll: number; pitch: number; yaw: number } {

        console.log(`> [MOV] rot deltas Roll: ${(dRoll*180/Math.PI).toFixed(2)}°`);
        console.log(`>  [MOV] rot deltas Pitch: ${(dPitch*180/Math.PI).toFixed(2)}°`);
        console.log(`>  [MOV] rot deltas Yaw: ${(dYaw*180/Math.PI).toFixed(2)}°`);
        // Extract camera basis from quaternion → mat3
        // mat3.fromQuat(this._camRot, this.cameraQuat);

        // // // Fill axis vectors from matrix (avoids vec3.fromValues allocations)
        // vec3.set(this._axisRight,   this._camRot[0], this._camRot[1], this._camRot[2]);
        // vec3.set(this._axisUp,      this._camRot[3], this._camRot[4], this._camRot[5]);
        // vec3.set(this._axisForward, this._camRot[6], this._camRot[7], this._camRot[8]);

        log_vector('   [MOV] 1 axisRight  ', this._axisRight, 2);
        log_vector('   [MOV] 1 axisUp     ', this._axisUp, 2);
        log_vector('   [MOV] 1 axisForward', this._axisForward, 2);

        console.log(`   [MOV] B4 euler-pitch: ${(this.euler.pitch*180/Math.PI).toFixed(2)}°`);
        console.log(`    [MOV] B4 euler-roll: ${(this.euler.roll*180/Math.PI).toFixed(2)}°`);
        console.log(`    [MOV] B4 euler-yaw: ${(this.euler.yaw*180/Math.PI).toFixed(2)}°`);

        this.euler.pitch+=dPitch;

        if ( this.euler.pitch > Math.PI) this.euler.pitch -= 2*Math.PI;
        if ( this.euler.pitch < -Math.PI) this.euler.pitch += 2*Math.PI;

        this.euler.roll+=dRoll;

        if ( this.euler.roll > Math.PI) this.euler.roll -= 2*Math.PI;
        if ( this.euler.roll < -Math.PI) this.euler.roll += 2*Math.PI;

        this.euler.yaw+=dYaw;
        if ( this.euler.yaw > Math.PI) this.euler.yaw -= 2*Math.PI;
        if ( this.euler.yaw < -Math.PI) this.euler.yaw += 2*Math.PI;
       

        console.log(`   [MOV] aft euler-pitch: ${(this.euler.pitch*180/Math.PI).toFixed(2)}`);
        console.log(`    [MOV] aft euler-roll: ${(this.euler.roll*180/Math.PI).toFixed(2)}`);
        console.log(`    [MOV] aft euler-yaw: ${(this.euler.yaw*180/Math.PI).toFixed(2)}`);

        // Build incremental rotations (in-place)
        quat.setAxisAngle(this._qPitch, this._axisRight,   dPitch);
        quat.setAxisAngle(this._qYaw,   this._axisUp,      dYaw);
        quat.setAxisAngle(this._qRoll,  this._axisForward, dRoll); 

        // 1. Update the quaternion
        // Accumulate rotations in cameraQuat (reuse memory)
        quat.multiply(this.cameraQuat, this._qYaw, this.cameraQuat);
        quat.multiply(this.cameraQuat, this._qPitch, this.cameraQuat);
        quat.multiply(this.cameraQuat, this._qRoll, this.cameraQuat);
        quat.normalize(this.cameraQuat, this.cameraQuat);

        // 2. Generate the matrix ONCE
        //mat3.fromQuat(this.cameraMat3, this.cameraQuat);
 
        // --- CRITICAL ADDITION ---
        // Refresh the axis vectors from the NEWLY UPDATED quaternion

        mat3.fromQuat(this._camRot, this.cameraQuat);

        // Fill axis vectors from matrix (avoids vec3.fromValues allocations)
        vec3.set(this._axisRight,   this._camRot[0], this._camRot[1], this._camRot[2]);
        vec3.set(this._axisUp,      this._camRot[3], this._camRot[4], this._camRot[5]);
        vec3.set(this._axisForward, this._camRot[6], this._camRot[7], this._camRot[8]);

        log_vector('   [MOV] 2 axisRight  ', this._axisRight, 2);
        log_vector('   [MOV] 2axisUp     ', this._axisUp, 2);
        log_vector('   [MOV] 2 axisForward', this._axisForward, 2);


        // mat3.fromQuat(this._camRot, this.cameraQuat);
        
 
        // vec3.set(this._axisRight,   
        //     this._camRot[0], 
        //     this._camRot[1], 
        //     this._camRot[2]);

      //  console.log('   [MOV] axisRight  : ' + this._axisRight.map(v => v.toFixed(4)).join(', '));
        // log_vector('   [MOV] axisRight  ', this._axisRight, 2);

        // vec3.set(this._axisUp,     
        //      this._camRot[3], this._camRot[4], this._camRot[5]);
        
        // log_vector('   [MOV] axisUp     ', this._axisUp, 2);

        // vec3.set(this._axisForward, 
        //     this._camRot[6], this._camRot[7], this._camRot[8]);

        // log_vector('   [MOV] axisForward', this._axisForward, 2);

      
        // -------------------------
        
    
        // const [x, y, z, w] = this.cameraQuat;
     
        // this.cameraMat3.set(
        //     1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w,     2*x*z + 2*y*w,
        //     2*x*y + 2*z*w,     1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w,
        //     2*x*z - 2*y*w,     2*y*z + 2*x*w,     1 - 2*x*x - 2*y*y
        // );
         // Update the output matrix for the shader

         
        mat3.fromQuat(this.cameraMat3, this.cameraQuat);
       // return { roll: this.euler.roll*180/Math.PI, pitch: this.euler.pitch*180/Math.PI, yaw: this.euler.yaw*180/Math.PI};
        // const pitch = this.angleToGroundPlane( 
        //     { x: this._axisForward[0], y: this._axisForward[1], z: this._axisForward[2]},
        //     { x: this._axisUp[0], y: this._axisUp[1], z: this._axisUp[2]}
        // );

        const pitch = this.angleToGroundPlane_v1( 
            { x: this._axisForward[0], y: this._axisForward[1], z: this._axisForward[2]}, 
        );


        const yaw = this.yawToForward( 
            { x: this._axisForward[0], y: this._axisForward[1], z: this._axisForward[2]} );

        // const roll = this.rollToUp( 
        //     { x: this._axisRight[0], y: this._axisRight[1], z: this._axisRight[2]} );
   
      
        const roll = this.rollToUp(
            { x: this._axisRight[0], y: this._axisRight[1], z: this._axisRight[2] }, // Right
            { x: this._axisUp[0], y: this._axisUp[1], z: this._axisUp[2] }  // Up
        );
        
        this.euler.pitch = pitch * Math.PI/180.0;
        this.euler.yaw = yaw * Math.PI/180.0;
        this.euler.roll = roll * Math.PI/180.0;

        console.log(`< [MOV] ret Roll: ${roll.toFixed(2)}`);
        console.log(`< [MOV] ret Pitch: ${pitch.toFixed(2)}`);
        console.log(`< [MOV] ret Yaw: ${yaw.toFixed(2)}`);

        return {roll, pitch, yaw};
    }

    // Returns angle (in radians) between vector v and the ground plane (XZ plane)

    private angleToGroundPlane_v1(fwd: {x: number, y: number, z: number}): number {
        // 1. Calculate the horizontal length of the forward vector (projection on XZ plane)
        const horizontalLen = Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z);

        // 2. Pitch is the angle between the vertical (y) and the horizontal length
        // atan2(vertical, horizontal)
        const angleRad = Math.atan2(fwd.y, horizontalLen);

        return angleRad * (180.0 / Math.PI);
    }

    private angleToGroundPlane(
        fwd: {x: number, y: number, z: number},
        up: {x: number, y: number, z: number}): number {

        const angleRad = Math.atan2(fwd.y, up.y);
    
        return angleRad * (180.0 / Math.PI);
    }

    private yawToForward(v: {x: number, y: number, z: number}): number {
        // Project to ground (XZ) plane
        const px = v.x;
        const pz = v.z;

        // Handle zero-length projection
        if (px === 0 && pz === 0) return 0;

        // atan2 returns angle in radians
        return Math.atan2(px, pz)* (180. / Math.PI); // angle in deg
        }

        private rollToUp(
            right: {x: number, y: number, z: number}, 
            up: {x: number, y: number, z: number}): number {
            // // The 'Roll' is the angle of the Right vector relative to the Horizon.
            // // In a zero-roll state, v.y (vertical component) is 0.
            // // The horizontal magnitude is sqrt(v.x^2 + v.z^2).
            
            // const horizontalMag = Math.sqrt(v.x * v.x + v.z * v.z);
            // console.log(`   [MOV] rollToUp - v.y: ${v.y.toFixed(4)}, horizontalMag: ${horizontalMag.toFixed(4)}`);
            // // atan2(vertical, horizontal)
            // // If v.y is positive (Right wing up), this returns a positive angle.
            // // If v.y is negative (Right wing down), this returns a negative angle.
            // return Math.atan2(v.y, horizontalMag) * (180.0 / Math.PI);

            const angleRad = Math.atan2(right.y, up.y);
    
            return angleRad * (180.0 / Math.PI);

        }

        private rollToUp_v0(v: {x: number, y: number, z: number}): number {
        // Project onto up axis
    
        const sign = (v.y >= 0) ? -1 : 1;
        const s = (v.x* v.x + v.z*v.z);

        // Handle zero-length projection
        //if (px === 0 && py === 0) return 0;

        // atan2 returns signed angle in radians
        return sign*Math.acos(s/ (s+ v.y*v.y))* (180. / Math.PI); // angle in deg
        }
}

 