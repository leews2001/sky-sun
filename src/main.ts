const Renderer_Option:string = 'sky-sun';

import './style.css'
import { RenderSkySun } from './ts/renderSkySun';



async function main() {
  
  const canvas = document.getElementById('webgl') as HTMLCanvasElement;
  
  if (!canvas) {
    throw new Error('Canvas not found');
  }

  // Resize canvas to window size
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
 

  let renderer: RenderSkySun;

  if (Renderer_Option === 'sky-sun') {

    const helpMenu = document.getElementById("help-menu-sky") as HTMLElement;
    if (!helpMenu) throw new Error('helpMenu not found');

    renderer = await RenderSkySun.init(canvas, helpMenu );
  
  } else {
    throw new Error("Invalid Renderer_Option");
  }

 
  function animate() { 
    renderer.render();
    requestAnimationFrame(animate);
  }

  animate();
  
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    renderer.resize(canvas.width, canvas.height);
  });
 
} // <<-- async function main() 

main();

