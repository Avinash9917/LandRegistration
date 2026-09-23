/**
 * Three.js WebGL 3D Intro & Collision Animation Engine (Phase 8, Round 1)
 *
 * Timeline:
 * 1. Two stylized 3D cyber cars race from opposite edges (-32 & +32).
 * 2. High-speed collision at center with dynamic camera shake & shockwave.
 * 3. 500+ glowing shard particles explode and morph into the glowing DApp logo.
 * 4. Smooth cinematic fade-out to live homepage content.
 *
 * Features:
 * - Immediate keyboard-accessible "Skip Intro" control.
 * - Session storage auto-skip for repeat visits.
 * - Reduced-motion media query automatic skip.
 * - WebGL fallback gracefully bypassing animation without blocking UI.
 * - Memory cleanup: fully disposes geometries, materials, and renderer on complete.
 */

(function () {
  'use strict';

  const SESSION_FLAG = 'landreg_intro_seen';

  function shouldSkipIntro() {
    // 1. Repeat visit in session
    if (sessionStorage.getItem(SESSION_FLAG)) {
      return true;
    }
    // 2. User prefers reduced motion
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return true;
    }
    // 3. WebGL support check
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return true;
    } catch (e) {
      return true;
    }
    return false;
  }

  function dismissIntro() {
    sessionStorage.setItem(SESSION_FLAG, 'true');
    const overlay = document.getElementById('intro-overlay');
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }, 850);
    }
  }

  // If already seen or reduced motion, dismiss immediately
  if (shouldSkipIntro()) {
    document.addEventListener('DOMContentLoaded', () => {
      dismissIntro();
    });
    return;
  }

  window.addEventListener('DOMContentLoaded', () => {
    // Setup Skip Button
    const skipBtn = document.getElementById('skipIntroBtn');
    if (skipBtn) {
      skipBtn.addEventListener('click', (e) => {
        e.preventDefault();
        cleanupAndExit();
      });
      skipBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cleanupAndExit();
        }
      });
    }

    // Lazy load Three.js if not already present
    if (typeof THREE === 'undefined') {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.onload = initThreeScene;
      script.onerror = () => {
        dismissIntro();
      };
      document.head.appendChild(script);
    } else {
      initThreeScene();
    }
  });

  let scene, camera, renderer, animationFrameId;
  let carLeft, carRight;
  let shockwaveMesh, particleSystem, speedLines;
  let isExploded = false;
  let explosionTime = 0;
  let clock;
  let container;

  function initThreeScene() {
    container = document.getElementById('intro-canvas-container');
    if (!container || typeof THREE === 'undefined') {
      dismissIntro();
      return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;

    clock = new THREE.Clock();
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020617, 0.025);

    camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 200);
    camera.position.set(0, 4.5, 20);
    camera.lookAt(0, 1.2, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(0, 20, 10);
    scene.add(dirLight);

    // Cyber Grid Floor
    const gridHelper = new THREE.GridHelper(120, 60, 0x38bdf8, 0x1e293b);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    // Speed streaks / horizontal warp lines
    createSpeedLines();

    // Create 3D Procedural Cars
    carLeft = createCyberCar(0x00f0ff, 0x38bdf8, true); // Cyan Car
    carLeft.position.set(-48, 0.6, 0);
    scene.add(carLeft);

    carRight = createCyberCar(0xff007f, 0xc084fc, false); // Magenta Car
    carRight.position.set(48, 0.6, 0);
    scene.add(carRight);

    // Create Shockwave Geometry (Hidden initially)
    const shockGeo = new THREE.RingGeometry(0.1, 0.6, 32);
    const shockMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0
    });
    shockwaveMesh = new THREE.Mesh(shockGeo, shockMat);
    shockwaveMesh.rotation.x = Math.PI / 2;
    shockwaveMesh.position.set(0, 0.2, 0);
    scene.add(shockwaveMesh);

    window.addEventListener('resize', onWindowResize);

    // Start Animation Loop
    animate();
  }

  function createCyberCar(bodyColor, glowColor, isFacingRight) {
    const carGroup = new THREE.Group();

    // Main Chassis
    const bodyGeo = new THREE.BoxGeometry(4.2, 0.8, 2.0);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      metalness: 0.85,
      roughness: 0.2,
      emissive: bodyColor,
      emissiveIntensity: 0.2
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.5;
    carGroup.add(bodyMesh);

    // Aerodynamic Cabin / Windshield
    const cabinGeo = new THREE.BoxGeometry(2.2, 0.6, 1.6);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.85
    });
    const cabinMesh = new THREE.Mesh(cabinGeo, cabinMat);
    cabinMesh.position.set(isFacingRight ? -0.3 : 0.3, 1.0, 0);
    carGroup.add(cabinMesh);

    // Glowing Neon Headlights / Taillights
    const lightGeo = new THREE.BoxGeometry(0.1, 0.2, 0.6);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });

    const frontLight = new THREE.Mesh(lightGeo, headMat);
    frontLight.position.set(isFacingRight ? 2.1 : -2.1, 0.5, 0.6);
    carGroup.add(frontLight);

    const frontLight2 = frontLight.clone();
    frontLight2.position.z = -0.6;
    carGroup.add(frontLight2);

    const backLight = new THREE.Mesh(lightGeo, tailMat);
    backLight.position.set(isFacingRight ? -2.1 : 2.1, 0.5, 0.6);
    carGroup.add(backLight);

    const backLight2 = backLight.clone();
    backLight2.position.z = -0.6;
    carGroup.add(backLight2);

    // Wheels (4 Glowing Rims)
    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.9 });
    const rimMat = new THREE.MeshBasicMaterial({ color: glowColor });

    const wheelPositions = [
      [1.4, 0.45, 1.05],
      [-1.4, 0.45, 1.05],
      [1.4, 0.45, -1.05],
      [-1.4, 0.45, -1.05]
    ];

    wheelPositions.forEach((pos) => {
      const wGroup = new THREE.Group();
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wGroup.add(wheel);

      const rim = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.35, 16), rimMat);
      rim.rotation.y = pos[2] > 0 ? 0 : Math.PI;
      rim.position.z = pos[2] > 0 ? 0.21 : -0.21;
      wGroup.add(rim);

      wGroup.position.set(pos[0], pos[1], pos[2]);
      carGroup.add(wGroup);
    });

    // Neon Underglow Point Light
    const underLight = new THREE.PointLight(glowColor, 2.5, 6);
    underLight.position.set(0, -0.1, 0);
    carGroup.add(underLight);

    return carGroup;
  }

  function createSpeedLines() {
    const lineCount = 350;
    const lineGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(lineCount * 6);
    const colors = new Float32Array(lineCount * 6);

    for (let i = 0; i < lineCount; i++) {
      const x = (Math.random() - 0.5) * 110;
      const y = Math.random() * 9 + 0.2;
      const z = (Math.random() - 0.5) * 30;
      const length = Math.random() * 4 + 2.0;

      const idx = i * 6;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      positions[idx + 3] = x + length;
      positions[idx + 4] = y;
      positions[idx + 5] = z;

      const color = new THREE.Color(Math.random() > 0.5 ? 0x38bdf8 : 0xc084fc);
      colors[idx] = color.r;
      colors[idx + 1] = color.g;
      colors[idx + 2] = color.b;
      colors[idx + 3] = color.r * 0.2;
      colors[idx + 4] = color.g * 0.2;
      colors[idx + 5] = color.b * 0.2;
    }

    lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    });

    speedLines = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(speedLines);
  }

  function createExplosionParticles() {
    const particleCount = 750;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 1.5;
      positions[i * 3 + 1] = Math.random() * 1.5 + 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 1.5;

      // Spherical & radial velocity burst
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = Math.random() * 22 + 6;

      velocities.push({
        x: Math.sin(phi) * Math.cos(theta) * speed,
        y: Math.abs(Math.cos(phi) * speed * 1.2) + 4,
        z: Math.sin(phi) * Math.sin(theta) * speed
      });

      const colorChoice = Math.random();
      const color = new THREE.Color();
      if (colorChoice < 0.4) color.setHex(0x38bdf8); // Cyan
      else if (colorChoice < 0.75) color.setHex(0xc084fc); // Purple
      else color.setHex(0xffffff); // Core White

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.velocities = velocities;

    const material = new THREE.PointsMaterial({
      size: 0.45,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });

    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
  }

  let totalElapsed = 0;

  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    totalElapsed += delta;

    if (!isExploded) {
      // Accelerating race toward center
      const speed = Math.min(totalElapsed * 15 + 8, 28);
      carLeft.position.x += speed * delta;
      carRight.position.x -= speed * delta;

      // Slight wheel spin & chassis suspension bobbing
      carLeft.position.y = 0.6 + Math.sin(totalElapsed * 24) * 0.04;
      carRight.position.y = 0.6 + Math.cos(totalElapsed * 24) * 0.04;

      // Dynamic cinematic camera tracking
      camera.position.x = (carLeft.position.x + carRight.position.x) * 0.08;
      camera.position.z = Math.max(12, 22 - totalElapsed * 2.8);

      // Collision trigger when cars reach center (x ~ 0)
      if (carLeft.position.x >= -1.8 && carRight.position.x <= 1.8) {
        triggerCollision();
      }
    } else {
      // Explosion & Particle expansion
      explosionTime += delta;

      // Shockwave Ring expansion
      if (shockwaveMesh) {
        const scale = explosionTime * 32 + 1;
        shockwaveMesh.scale.set(scale, scale, 1);
        shockwaveMesh.material.opacity = Math.max(1 - explosionTime * 0.8, 0);
      }

      // Particle physics
      if (particleSystem) {
        const positions = particleSystem.geometry.attributes.position.array;
        const velocities = particleSystem.geometry.velocities;
        for (let i = 0; i < velocities.length; i++) {
          positions[i * 3] += velocities[i].x * delta;
          positions[i * 3 + 1] += velocities[i].y * delta;
          positions[i * 3 + 2] += velocities[i].z * delta;
          velocities[i].y -= 9.8 * delta; // Gravity
        }
        particleSystem.geometry.attributes.position.needsUpdate = true;
        particleSystem.material.opacity = Math.max(1 - explosionTime * 0.4, 0);
      }

      // Camera Shake Effect
      if (explosionTime < 0.6) {
        const shake = (0.6 - explosionTime) * 1.5;
        camera.position.x = (Math.random() - 0.5) * shake;
        camera.position.y = 4.5 + (Math.random() - 0.5) * shake;
      }

      // Extended duration: Transition to portal at T = 6.5s (+3.3 seconds longer)
      if (totalElapsed >= 6.5) {
        cleanupAndExit();
      }
    }

    renderer.render(scene, camera);
  }

  function triggerCollision() {
    isExploded = true;

    // Hide cars
    carLeft.visible = false;
    carRight.visible = false;

    // Trigger Shockwave & Particles
    shockwaveMesh.material.opacity = 1.0;
    createExplosionParticles();

    // Reveal 3D Typography / Logo
    const titleOverlay = document.getElementById('introTitleReveal');
    if (titleOverlay) {
      titleOverlay.classList.add('active');
    }
  }

  function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function cleanupAndExit() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    window.removeEventListener('resize', onWindowResize);

    // Dispose Three.js objects
    if (scene) {
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }

    if (renderer) {
      renderer.dispose();
    }

    dismissIntro();
  }

})();
