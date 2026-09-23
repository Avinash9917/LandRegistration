/**
 * Three.js WebGL 3D Holographic Scene for Dedicated Wallet Login Screen (Phase 9)
 *
 * Features:
 * 1. Rotating 3D Cryptographic Shield / Blockchain Node Octahedron with cyan/gold edge glow.
 * 2. Dual counter-rotating golden data rings with orbiting satellite nodes.
 * 3. 250+ floating ambient particles reacting smoothly to mouse pointer position.
 * 4. `window.triggerLoginSuccess3D(callback)`: Unlocks the 3D shield with a radial golden shockwave
 *    and particle burst before redirecting.
 * 5. Automatic graceful degradation for prefers-reduced-motion and WebGL-unsupported systems.
 */

(function () {
  'use strict';

  function isReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isWebGLAvailable() {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  if (isReducedMotion() || !isWebGLAvailable()) {
    console.log("[Login3D] Reduced motion or WebGL unavailable: running in fast static fallback mode.");
    window.triggerLoginSuccess3D = function (cb) { if (cb) cb(); };
    return;
  }

  // Lazy-load Three.js if not already present
  function ensureThreeJs(callback) {
    if (window.THREE) {
      callback();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    script.onload = callback;
    script.onerror = () => {
      console.warn("[Login3D] Could not load Three.js; falling back to CSS.");
      window.triggerLoginSuccess3D = function (cb) { if (cb) cb(); };
    };
    document.head.appendChild(script);
  }

  window.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('login-3d-canvas-container');
    if (!container) return;

    ensureThreeJs(() => {
      initLogin3DScene(container);
    });
  });

  function initLogin3DScene(container) {
    const THREE = window.THREE;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080e18, 0.025);

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 18);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Ambient & Point Lighting
    const ambientLight = new THREE.AmbientLight(0x00e5ff, 0.6);
    scene.add(ambientLight);

    const cyanLight = new THREE.PointLight(0x00e5ff, 2.5, 50);
    cyanLight.position.set(10, 10, 10);
    scene.add(cyanLight);

    const goldLight = new THREE.PointLight(0xffb703, 2.0, 50);
    goldLight.position.set(-10, -8, 8);
    scene.add(goldLight);

    // 1. Central Holographic Blockchain Shield / Octahedron
    const coreGroup = new THREE.Group();
    scene.add(coreGroup);

    const coreGeo = new THREE.OctahedronGeometry(3.5, 1);
    const coreMat = new THREE.MeshPhongMaterial({
      color: 0x00172d,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.25,
      wireframe: true,
      transparent: true,
      opacity: 0.85
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreGroup.add(coreMesh);

    // Inner Glowing Core
    const innerGeo = new THREE.IcosahedronGeometry(1.8, 0);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.4
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    coreGroup.add(innerMesh);

    // 2. Dual Orbiting Golden Data Rings
    const ring1Geo = new THREE.TorusGeometry(5.4, 0.04, 16, 100);
    const ring1Mat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.6 });
    const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1.rotation.x = Math.PI / 3;
    scene.add(ring1);

    const ring2Geo = new THREE.TorusGeometry(6.6, 0.04, 16, 100);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.5 });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.rotation.x = -Math.PI / 4;
    ring2.rotation.y = Math.PI / 6;
    scene.add(ring2);

    // 3. Orbiting Data Satellite Nodes
    const satelliteGroup = new THREE.Group();
    scene.add(satelliteGroup);
    const satCount = 6;
    for (let i = 0; i < satCount; i++) {
      const satGeo = new THREE.SphereGeometry(0.18, 12, 12);
      const satMat = new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0x00e5ff : 0xffb703 });
      const satMesh = new THREE.Mesh(satGeo, satMat);
      const angle = (i / satCount) * Math.PI * 2;
      satMesh.position.set(Math.cos(angle) * 5.4, Math.sin(angle) * 3.5, Math.sin(angle) * 2.5);
      satelliteGroup.add(satMesh);
    }

    // 4. Floating Ambient Particle Field (250+ particles)
    const particleCount = 280;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);
    const colorCyan = new THREE.Color(0x00e5ff);
    const colorGold = new THREE.Color(0xffb703);
    const colorWhite = new THREE.Color(0xffffff);

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 45;
      particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 35;
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 35;

      const chosenColor = Math.random() < 0.5 ? colorCyan : (Math.random() < 0.8 ? colorGold : colorWhite);
      particleColors[i * 3] = chosenColor.r;
      particleColors[i * 3 + 1] = chosenColor.g;
      particleColors[i * 3 + 2] = chosenColor.b;
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
    const particleSystem = new THREE.Points(particleGeo, particleMat);
    scene.add(particleSystem);

    // Mouse Tracking Parallax
    let mouseX = 0, mouseY = 0;
    let targetCameraX = 0, targetCameraY = 0;

    window.addEventListener('mousemove', (e) => {
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
      targetCameraX = mouseX * 2.5;
      targetCameraY = mouseY * 2.0;
    });

    // Resize Handler
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Animation Loop
    let isUnlocking = false;
    let unlockStartTime = 0;
    let animId;

    function animate(time) {
      animId = requestAnimationFrame(animate);

      // Smooth camera parallax
      camera.position.x += (targetCameraX - camera.position.x) * 0.04;
      camera.position.y += (targetCameraY - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      // Rotations
      if (!isUnlocking) {
        coreGroup.rotation.y += 0.008;
        coreGroup.rotation.x += 0.004;
        innerMesh.rotation.y -= 0.012;
        ring1.rotation.z += 0.006;
        ring2.rotation.z -= 0.005;
        satelliteGroup.rotation.y += 0.01;
        particleSystem.rotation.y += 0.001;
      } else {
        // Unlock Explosion / Dissolution sequence
        const elapsed = (time - unlockStartTime) / 1000;
        coreGroup.scale.multiplyScalar(1.035);
        coreMat.opacity = Math.max(0, 1 - elapsed * 1.5);
        innerMat.opacity = Math.max(0, 1 - elapsed * 1.5);
        ring1.scale.multiplyScalar(1.05);
        ring2.scale.multiplyScalar(1.05);
        cyanLight.intensity = Math.min(12, 2.5 + elapsed * 10);
        goldLight.intensity = Math.min(10, 2.0 + elapsed * 8);

        const pos = particleGeo.attributes.position.array;
        for (let i = 0; i < particleCount; i++) {
          pos[i * 3] *= 1.02;
          pos[i * 3 + 1] *= 1.02;
          pos[i * 3 + 2] *= 1.02;
        }
        particleGeo.attributes.position.needsUpdate = true;
      }

      renderer.render(scene, camera);
    }

    animId = requestAnimationFrame(animate);

    // Global Trigger Hook for successful wallet login
    window.triggerLoginSuccess3D = function (callback) {
      isUnlocking = true;
      unlockStartTime = performance.now();
      setTimeout(() => {
        cancelAnimationFrame(animId);
        if (callback) callback();
      }, 750);
    };
  }
})();
