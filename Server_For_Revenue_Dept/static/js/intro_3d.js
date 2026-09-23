/**
 * Three.js WebGL 3D Intro & Collision Animation Engine (Revenue Dept Portal)
 */

(function () {
  'use strict';

  const SESSION_FLAG = 'revenue_intro_seen';

  function shouldSkipIntro() {
    if (sessionStorage.getItem(SESSION_FLAG)) return true;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
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

  if (shouldSkipIntro()) {
    document.addEventListener('DOMContentLoaded', () => {
      dismissIntro();
    });
    return;
  }

  window.addEventListener('DOMContentLoaded', () => {
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

    if (typeof THREE === 'undefined') {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.onload = initThreeScene;
      script.onerror = () => { dismissIntro(); };
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

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(0, 20, 10);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(120, 60, 0x2dd4bf, 0x1e293b);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    createSpeedLines();

    carLeft = createCyberCar(0x14b8a6, 0x2dd4bf, true);
    carLeft.position.set(-32, 0.6, 0);
    scene.add(carLeft);

    carRight = createCyberCar(0x0284c7, 0x38bdf8, false);
    carRight.position.set(32, 0.6, 0);
    scene.add(carRight);

    const shockGeo = new THREE.RingGeometry(0.1, 0.6, 32);
    const shockMat = new THREE.MeshBasicMaterial({
      color: 0x2dd4bf,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0
    });
    shockwaveMesh = new THREE.Mesh(shockGeo, shockMat);
    shockwaveMesh.rotation.x = Math.PI / 2;
    shockwaveMesh.position.set(0, 0.2, 0);
    scene.add(shockwaveMesh);

    window.addEventListener('resize', onWindowResize);
    animate();
  }

  function createCyberCar(bodyColor, glowColor, isFacingRight) {
    const carGroup = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(4.2, 0.8, 2.0);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      metalness: 0.85,
      roughness: 0.2,
      emissive: bodyColor,
      emissiveIntensity: 0.2
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.4;
    carGroup.add(bodyMesh);

    const cabinGeo = new THREE.BoxGeometry(2.2, 0.65, 1.6);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.95,
      roughness: 0.1,
      transparent: true,
      opacity: 0.9
    });
    const cabinMesh = new THREE.Mesh(cabinGeo, cabinMat);
    cabinMesh.position.set(isFacingRight ? -0.2 : 0.2, 1.05, 0);
    carGroup.add(cabinMesh);

    const stripeGeo = new THREE.BoxGeometry(4.25, 0.1, 2.05);
    const stripeMat = new THREE.MeshBasicMaterial({ color: glowColor });
    const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
    stripeMesh.position.y = 0.4;
    carGroup.add(stripeMesh);

    const lightGeo = new THREE.BoxGeometry(0.1, 0.2, 0.5);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const frontX = isFacingRight ? 2.1 : -2.1;

    const leftLight = new THREE.Mesh(lightGeo, lightMat);
    leftLight.position.set(frontX, 0.45, 0.6);
    carGroup.add(leftLight);

    const rightLight = new THREE.Mesh(lightGeo, lightMat);
    rightLight.position.set(frontX, 0.45, -0.6);
    carGroup.add(rightLight);

    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 });
    const rimMat = new THREE.MeshBasicMaterial({ color: glowColor });

    const wheelPositions = [
      [1.3, 0.0, 1.0],
      [-1.3, 0.0, 1.0],
      [1.3, 0.0, -1.0],
      [-1.3, 0.0, -1.0]
    ];

    wheelPositions.forEach(pos => {
      const wGroup = new THREE.Group();
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wGroup.add(wheel);

      const rim = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.3, 12), rimMat);
      rim.position.z = pos[2] > 0 ? 0.18 : -0.18;
      wGroup.add(rim);

      wGroup.position.set(pos[0], pos[1], pos[2]);
      carGroup.add(wGroup);
    });

    const underLight = new THREE.PointLight(glowColor, 2.5, 6);
    underLight.position.set(0, -0.1, 0);
    carGroup.add(underLight);

    return carGroup;
  }

  function createSpeedLines() {
    const lineCount = 300;
    const lineGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(lineCount * 6);
    const colors = new Float32Array(lineCount * 6);

    for (let i = 0; i < lineCount; i++) {
      const x = (Math.random() - 0.5) * 80;
      const y = Math.random() * 8 + 0.2;
      const z = (Math.random() - 0.5) * 25;
      const length = Math.random() * 3 + 1.5;

      const idx = i * 6;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      positions[idx + 3] = x + length;
      positions[idx + 4] = y;
      positions[idx + 5] = z;

      const color = new THREE.Color(Math.random() > 0.5 ? 0x2dd4bf : 0x38bdf8);
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
    const particleCount = 600;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 1.5;
      positions[i * 3 + 1] = Math.random() * 1.5 + 0.4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 1.5;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = Math.random() * 18 + 6;

      velocities.push({
        x: Math.sin(phi) * Math.cos(theta) * speed,
        y: Math.abs(Math.cos(phi)) * speed * 1.2 + 2,
        z: Math.sin(phi) * Math.sin(theta) * speed
      });

      const colorChoice = Math.random();
      const color = new THREE.Color();
      if (colorChoice < 0.4) color.setHex(0x2dd4bf);
      else if (colorChoice < 0.75) color.setHex(0x38bdf8);
      else color.setHex(0xffffff);

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.velocities = velocities;

    const material = new THREE.PointsMaterial({
      size: 0.4,
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
      const speed = Math.min(totalElapsed * 15 + 8, 28);
      carLeft.position.x += speed * delta;
      carRight.position.x -= speed * delta;

      carLeft.position.y = 0.6 + Math.sin(totalElapsed * 24) * 0.04;
      carRight.position.y = 0.6 + Math.cos(totalElapsed * 24) * 0.04;

      camera.position.x = (carLeft.position.x + carRight.position.x) * 0.08;
      camera.position.z = Math.max(12, 22 - totalElapsed * 2.8);

      if (carLeft.position.x >= -1.8 && carRight.position.x <= 1.8) {
        triggerCollision();
      }
    } else {
      explosionTime += delta;

      if (shockwaveMesh) {
        const scale = explosionTime * 32 + 1;
        shockwaveMesh.scale.set(scale, scale, 1);
        shockwaveMesh.material.opacity = Math.max(1 - explosionTime * 0.8, 0);
      }

      if (particleSystem) {
        const positions = particleSystem.geometry.attributes.position.array;
        const velocities = particleSystem.geometry.velocities;
        for (let i = 0; i < velocities.length; i++) {
          positions[i * 3] += velocities[i].x * delta;
          positions[i * 3 + 1] += velocities[i].y * delta;
          positions[i * 3 + 2] += velocities[i].z * delta;
          velocities[i].y -= 9.8 * delta;
        }
        particleSystem.geometry.attributes.position.needsUpdate = true;
        particleSystem.material.opacity = Math.max(1 - explosionTime * 0.4, 0);
      }

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
    carLeft.visible = false;
    carRight.visible = false;
    shockwaveMesh.material.opacity = 1.0;
    createExplosionParticles();

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
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    window.removeEventListener('resize', onWindowResize);

    if (scene) {
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
    }

    if (renderer) renderer.dispose();
    dismissIntro();
  }

})();
