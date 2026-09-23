/**
 * Phase 8, Round 2: Creative Polish & Micro-Interactions Engine (Revenue Dept Portal)
 */

(function () {
  'use strict';

  function applyDayNightTheme() {
    const hour = new Date().getHours();
    document.body.classList.remove('theme-dawn', 'theme-day', 'theme-dusk', 'theme-night');

    if (hour >= 5 && hour < 12) {
      document.body.classList.add('theme-dawn');
    } else if (hour >= 12 && hour < 18) {
      document.body.classList.add('theme-day');
    } else if (hour >= 18 && hour < 21) {
      document.body.classList.add('theme-dusk');
    } else {
      document.body.classList.add('theme-night');
    }
  }

  function init3DCardTilt() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const cards = document.querySelectorAll('.dapp-card, .tilt-card');
    cards.forEach(card => {
      card.classList.add('tilt-card');

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const rotateX = ((y - centerY) / centerY) * -7;
        const rotateY = ((x - centerX) / centerX) * 7;

        card.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.015, 1.015, 1.015)`;
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
      });
    });
  }

  function initScrollReveals() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('.dapp-reveal').forEach(el => el.classList.add('revealed'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, idx) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.classList.add('revealed');
          }, idx * 100);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    document.querySelectorAll('.dapp-card, .dapp-reveal').forEach(el => {
      el.classList.add('dapp-reveal');
      observer.observe(el);
    });
  }

  function initMagneticButtons() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const buttons = document.querySelectorAll('.btn-dapp-primary, .btn-magnetic');
    buttons.forEach(btn => {
      btn.classList.add('btn-magnetic');

      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        btn.style.transform = `translate(${x * 0.22}px, ${y * 0.22}px)`;
      });

      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translate(0px, 0px)';
      });
    });
  }

  window.triggerParticleBurst = function (anchorEl) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'particle-burst-canvas';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let originX = window.innerWidth / 2;
    let originY = window.innerHeight / 2;

    if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
      const rect = anchorEl.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
    }

    const particles = [];
    const colors = ['#2dd4bf', '#38bdf8', '#818cf8', '#10b981', '#fbbf24', '#ffffff'];

    for (let i = 0; i < 45; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 8 + 3;
      particles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 4 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1.0,
        decay: Math.random() * 0.03 + 0.015
      });
    }

    let burstAnimId;
    function renderBurst() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15;
        p.alpha -= p.decay;

        if (p.alpha > 0) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });

      if (alive) {
        burstAnimId = requestAnimationFrame(renderBurst);
      } else {
        cancelAnimationFrame(burstAnimId);
        if (canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
      }
    }

    renderBurst();
  };

  window.renderEventHistoryChain = function (state, isEncumbered, isDisputed, scheduledDate) {
    const s = parseInt(state);
    const node1Class = "completed";
    const node2Class = (s === 6 || isDisputed) ? "disputed" : (s === 3 ? "disputed" : (s >= 2 ? "completed" : "active"));
    const node3Class = (s === 4) ? "active" : (s === 5 ? "completed" : "upcoming");
    const node4Class = (s === 5) ? "completed" : "upcoming";

    return `
      <div class="event-chain-container">
        <div class="event-node ${node1Class}">
          <div class="event-node-dot"><i class="fa-solid fa-file-circle-check"></i></div>
          <div class="event-node-title">1. Registered</div>
          <div class="event-node-desc">Deed Hash Anchored</div>
        </div>

        <div class="event-node ${node2Class}">
          <div class="event-node-dot">
            ${node2Class === 'completed' ? '<i class="fa-solid fa-shield-check"></i>' : (node2Class === 'disputed' ? '<i class="fa-solid fa-triangle-exclamation"></i>' : '<i class="fa-solid fa-hourglass-half"></i>')}
          </div>
          <div class="event-node-title">2. Officer Review</div>
          <div class="event-node-desc">${s === 1 ? `Scheduled (${scheduledDate || 'Soon'})` : (node2Class === 'completed' ? 'Title Verified' : (node2Class === 'disputed' ? 'Dispute Flagged' : 'Pending Verification'))}</div>
        </div>

        <div class="event-node ${node3Class}">
          <div class="event-node-dot">
            ${node3Class === 'completed' || node3Class === 'active' ? '<i class="fa-solid fa-tag"></i>' : '<i class="fa-solid fa-store"></i>'}
          </div>
          <div class="event-node-title">3. Escrow Listing</div>
          <div class="event-node-desc">${node3Class === 'active' ? 'Active On Sale' : (node3Class === 'completed' ? 'Offer Settled' : 'Not Listed')}</div>
        </div>

        <div class="event-node ${node4Class}">
          <div class="event-node-dot">
            ${node4Class === 'completed' ? '<i class="fa-solid fa-handshake"></i>' : '<i class="fa-solid fa-circle-check"></i>'}
          </div>
          <div class="event-node-title">4. Ownership</div>
          <div class="event-node-desc">${node4Class === 'completed' ? 'Transferred' : 'Holding'}</div>
        </div>
      </div>
    `;
  };

  // -------------------------------------------------------------
  // 9. Ambient 3D Three.js Holographic Background Inside Portals
  // -------------------------------------------------------------
  function initPortalAmbient3D() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (document.getElementById('ambient-portal-3d')) return;

    if (document.getElementById('login-3d-canvas-container')) {
      return;
    }

    function start3DScene() {
      const THREE = window.THREE;
      if (!THREE) return;

      const canvasContainer = document.createElement('div');
      canvasContainer.id = 'ambient-portal-3d';
      document.body.prepend(canvasContainer);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
      camera.position.z = 30;

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      canvasContainer.appendChild(renderer.domElement);

      const ambLight = new THREE.AmbientLight(0x38bdf8, 0.4);
      scene.add(ambLight);

      const pointLight1 = new THREE.PointLight(0x00e5ff, 1.8, 60);
      pointLight1.position.set(15, 15, 20);
      scene.add(pointLight1);

      const pointLight2 = new THREE.PointLight(0x818cf8, 1.5, 60);
      pointLight2.position.set(-15, -15, 15);
      scene.add(pointLight2);

      const crystalGroup = new THREE.Group();
      scene.add(crystalGroup);
      const crystals = [];

      const geos = [
        new THREE.OctahedronGeometry(1.4, 0),
        new THREE.IcosahedronGeometry(1.2, 0),
        new THREE.TetrahedronGeometry(1.5, 0),
        new THREE.TorusGeometry(1.1, 0.15, 8, 24)
      ];

      for (let i = 0; i < 8; i++) {
        const geo = geos[i % geos.length];
        const mat = new THREE.MeshPhongMaterial({
          color: 0x0f172a,
          emissive: i % 2 === 0 ? 0x00e5ff : 0xa855f7,
          emissiveIntensity: 0.35,
          wireframe: true,
          transparent: true,
          opacity: 0.45
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(
          (Math.random() - 0.5) * 55,
          (Math.random() - 0.5) * 35,
          (Math.random() - 0.5) * 20
        );
        mesh.rotSpeedX = (Math.random() - 0.5) * 0.015;
        mesh.rotSpeedY = (Math.random() - 0.5) * 0.015;
        mesh.floatSpeed = Math.random() * 0.002 + 0.001;
        mesh.floatOffset = Math.random() * Math.PI * 2;
        crystals.push(mesh);
        crystalGroup.add(mesh);
      }

      const pCount = 120;
      const pPositions = new Float32Array(pCount * 3);
      for (let i = 0; i < pCount; i++) {
        pPositions[i * 3] = (Math.random() - 0.5) * 70;
        pPositions[i * 3 + 1] = (Math.random() - 0.5) * 50;
        pPositions[i * 3 + 2] = (Math.random() - 0.5) * 30;
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
      const pMat = new THREE.PointsMaterial({
        color: 0x38bdf8,
        size: 0.15,
        transparent: true,
        opacity: 0.6
      });
      const pMesh = new THREE.Points(pGeo, pMat);
      scene.add(pMesh);

      let mouseX = 0, mouseY = 0;
      window.addEventListener('mousemove', (e) => {
        mouseX = (e.clientX / window.innerWidth - 0.5) * 4;
        mouseY = (e.clientY / window.innerHeight - 0.5) * 4;
      });

      window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      });

      let animId;
      function renderLoop(time) {
        animId = requestAnimationFrame(renderLoop);
        camera.position.x += (mouseX - camera.position.x) * 0.03;
        camera.position.y += (-mouseY - camera.position.y) * 0.03;
        camera.lookAt(0, 0, 0);

        crystals.forEach((c) => {
          c.rotation.x += c.rotSpeedX;
          c.rotation.y += c.rotSpeedY;
          c.position.y += Math.sin(time * 0.001 + c.floatOffset) * 0.008;
        });

        pMesh.rotation.y += 0.0006;
        renderer.render(scene, camera);
      }
      animId = requestAnimationFrame(renderLoop);
    }

    if (window.THREE) {
      start3DScene();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.onload = start3DScene;
      document.head.appendChild(script);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyDayNightTheme();
    init3DCardTilt();
    initScrollReveals();
    initMagneticButtons();
    initPortalAmbient3D();
  });

})();
