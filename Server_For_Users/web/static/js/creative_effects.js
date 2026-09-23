/**
 * Phase 8, Round 2: Creative Polish & Micro-Interactions Engine
 *
 * Includes:
 * 1. Animated On-Chain Event History Node Chain
 * 2. 3D Tilt-on-Hover for Cards
 * 3. Wallet Connect Pulse & Particle Burst
 * 4. Themed Loading State Generator
 * 5. Celebration Modal & "Ownership Transferred" Rubber Stamp
 * 6. Dynamic Day/Night Gradient Background
 * 7. Scroll-Triggered Fade/Slide Reveals
 * 8. Magnetic Button Hover Displacement
 */

(function () {
  'use strict';

  // -------------------------------------------------------------
  // 6. Dynamic Day/Night Gradient Background
  // -------------------------------------------------------------
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

  // -------------------------------------------------------------
  // 2. 3D Tilt-on-Hover for Cards
  // -------------------------------------------------------------
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

  // -------------------------------------------------------------
  // 7. Scroll-Triggered Reveal Animations
  // -------------------------------------------------------------
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

  // -------------------------------------------------------------
  // 8. Magnetic CTA Button Hover
  // -------------------------------------------------------------
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

  // -------------------------------------------------------------
  // 3. Wallet Connect Particle Burst Confirmation
  // -------------------------------------------------------------
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
    const colors = ['#38bdf8', '#818cf8', '#c084fc', '#10b981', '#fbbf24', '#ffffff'];

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
        p.vy += 0.15; // Gravity
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

  // -------------------------------------------------------------
  // 1. Animated On-Chain Event History Node Chain HTML Generator
  // -------------------------------------------------------------
  window.renderEventHistoryChain = function (state, isEncumbered, isDisputed, scheduledDate) {
    const s = parseInt(state);
    
    // States: 0: Under Verification, 1: Scheduled, 2: Verified, 3: Rejected, 4: On Sale, 5: Bought, 6: Disputed
    const node1Class = "completed"; // Registered is always completed
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
  // 5. Celebration Modal & Ownership Transferred Stamp
  // -------------------------------------------------------------
  window.triggerCelebrationModal = function (propertyId, saleId, newOwner) {
    if (document.getElementById('celebrationModalOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'celebrationModalOverlay';
    overlay.className = 'celebration-overlay';
    overlay.tabIndex = 0;

    const shortOwner = newOwner ? `${newOwner.slice(0, 6)}...${newOwner.slice(-4)}` : 'New Owner';

    overlay.innerHTML = `
      <canvas id="confetti-canvas" style="position: absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;"></canvas>
      <div class="celebration-card">
        <i class="fa-solid fa-award text-warning fs-1 mb-2"></i>
        <h3 class="fw-bold text-dark mb-1">Title Escrow Completed!</h3>
        <p class="text-muted small mb-3">On-chain checks-effects-interactions and fund settlement finalized.</p>

        <div class="stamp-badge">
          <i class="fa-solid fa-certificate me-2"></i> OWNERSHIP TRANSFERRED
        </div>

        <div class="card bg-light p-3 border text-start small mb-4">
          <div class="d-flex justify-content-between mb-1">
            <span class="text-muted">Property ID:</span>
            <span class="fw-bold">#${propertyId}</span>
          </div>
          <div class="d-flex justify-content-between mb-1">
            <span class="text-muted">Sale ID:</span>
            <span class="fw-bold">#${saleId}</span>
          </div>
          <div class="d-flex justify-content-between">
            <span class="text-muted">New Title Holder:</span>
            <code class="text-primary">${shortOwner}</code>
          </div>
        </div>

        <button class="btn btn-dapp-primary w-100 py-2" id="dismissCelebrationBtn">
          <i class="fa-solid fa-check me-1"></i> Continue to Dashboard
        </button>
      </div>
    `;

    document.body.appendChild(overlay);

    // Confetti Canvas Animation
    const cCanvas = document.getElementById('confetti-canvas');
    if (cCanvas) {
      const cCtx = cCanvas.getContext('2d');
      cCanvas.width = window.innerWidth;
      cCanvas.height = window.innerHeight;

      const flakes = [];
      const cColors = ['#10b981', '#38bdf8', '#fbbf24', '#f43f5e', '#a855f7', '#6366f1'];
      for (let i = 0; i < 90; i++) {
        flakes.push({
          x: Math.random() * cCanvas.width,
          y: Math.random() * cCanvas.height * 0.3,
          vx: (Math.random() - 0.5) * 3,
          vy: Math.random() * 4 + 2,
          size: Math.random() * 8 + 4,
          color: cColors[Math.floor(Math.random() * cColors.length)],
          rotation: Math.random() * 360,
          rotSpeed: (Math.random() - 0.5) * 6
        });
      }

      let cAnimId;
      function renderConfetti() {
        cCtx.clearRect(0, 0, cCanvas.width, cCanvas.height);
        flakes.forEach(f => {
          f.x += f.vx;
          f.y += f.vy;
          f.rotation += f.rotSpeed;

          cCtx.save();
          cCtx.translate(f.x, f.y);
          cCtx.rotate((f.rotation * Math.PI) / 180);
          cCtx.fillStyle = f.color;
          cCtx.fillRect(-f.size / 2, -f.size / 2, f.size, f.size * 0.6);
          cCtx.restore();
        });
        cAnimId = requestAnimationFrame(renderConfetti);
      }
      renderConfetti();

      overlay.cleanup = () => {
        cancelAnimationFrame(cAnimId);
      };
    }

    function dismiss() {
      if (overlay.cleanup) overlay.cleanup();
      overlay.style.opacity = '0';
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 300);
    }

    document.getElementById('dismissCelebrationBtn')?.addEventListener('click', dismiss);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); }, { once: true });

    setTimeout(dismiss, 5000);
  };

  // -------------------------------------------------------------
  // 9. Ambient 3D Three.js Holographic Background Inside Portals
  // -------------------------------------------------------------
  function initPortalAmbient3D() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (document.getElementById('ambient-portal-3d')) return;

    // Skip on login page which has its own centered 3D canvas
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

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', () => {
    applyDayNightTheme();
    init3DCardTilt();
    initScrollReveals();
    initMagneticButtons();
    initPortalAmbient3D();
  });

})();
